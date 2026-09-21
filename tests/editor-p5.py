"""Native round trips for repaired fonts, owned layers, rotation and sparse grids."""
from pathlib import Path
import sys,io,json,base64,copy,subprocess,hashlib
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz,worker
from fontTools.ttLib import TTFont
from fontTools import subset
from pypdf import PdfWriter,PdfReader
from pypdf.generic import DictionaryObject as D,NameObject as N,NumberObject as I,ArrayObject as A,DecodedStreamObject,FloatObject as F
from story import layout
from font_match import load_font,spaced_font
from font_sfnt import normalize
from generated_cmaps import repair_map
OUT=ROOT/'tests/output';OUT.mkdir(exist_ok=True);checks=[]

def models(raw,page=1):
    r=worker.run({'command':'inspect','bytes':base64.b64encode(raw).decode(),'page':page})
    path=OUT/'p5-current.json';path.write_text(json.dumps(r))
    code="import fs from 'node:fs';import{pageCandidates}from './src/flow-page-model.mjs';const r=JSON.parse(fs.readFileSync('tests/output/p5-current.json'));console.log(JSON.stringify(pageCandidates(r.objects,...r.size,[],r.tables).map(c=>c.model)));"
    return r,json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT))

def paint(raw,m,color,page=1):
    m=copy.deepcopy(m);m['color']=color
    for run in m.get('runs',[]):run['color']=color
    result=layout(m)
    assert result['mappingComplete'] and not result['overflow'],{k:result.get(k)for k in ['layoutMode','overflow','mappingComplete']}
    out=worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),'edits':[{'type':'flow','page':page,'sources':m['sources'],'model':m,'fragment':result['fragment']}]})
    return base64.b64decode(out['bytes'])

# Non-identity CFF charset catches CID/GID confusion and cold runtime imports.
import runpy
runpy.run_path(str(ROOT/'tests/fixture-cid-p5.py'))
r,ms=models((OUT/'p5-cid.pdf').read_bytes());assert ms[0]['text']=='中文'
assert all(f['fontResolution']=='embedded' for f in r['fonts'].values())
font=TTFont(load_font(ms[0]['fontKey'])['path']);assert font.getBestCmap()[0x4e2d]=='cid00020' and font.getBestCmap()[0x6587]=='cid00005'
checks.append('Non-identity CFF charset maps CID 20/5 to GID 1/2 without replacing the embedded font')

# PDF-style subset omits both cmap and post; its PDF ToUnicode remains intact.
font=TTFont(ROOT/'native/fonts/NotoSansSC.ttf');sub=subset.Subsetter();sub.populate(text='字体测试原文编辑中文');sub.subset(font)
buf=io.BytesIO();font.save(buf);d=fitz.open();p=d.new_page(width=600,height=800);p.insert_font(fontname='CJK',fontbuffer=buf.getvalue())
for y in [90,108,126]:p.insert_text((50,y),'字体测试原文编辑',fontname='CJK',fontsize=12)
fref=p.get_fonts()[0][0];_,_,_,embedded=d.extract_font(fref);f=TTFont(io.BytesIO(embedded));del f['cmap'];del f['post'];del f['OS/2'];b=io.BytesIO();f.save(b)
desc=int(d.xref_get_key(fref,'DescendantFonts')[1].split('[')[1].split()[0]);descriptor=int(d.xref_get_key(desc,'FontDescriptor')[1].split()[0]);stream=int(d.xref_get_key(descriptor,'FontFile2')[1].split()[0]);d.update_stream(stream,b.getvalue())
raw=d.tobytes();(OUT/'p5-missing-post.pdf').write_bytes(raw);r,ms=models(raw);assert ms and all(f['fontResolution']=='embedded' for f in r['fonts'].values())
face=load_font(ms[0]['fontKey']);fixed=TTFont(face['path']);assert all(t in fixed for t in ['cmap','post','OS/2'])
assert f.getTableData('glyf')==fixed.getTableData('glyf') and f.getTableData('hmtx')==fixed.getTableData('hmtx')
checks.append('PDF subset without cmap/post/OS2 gains browser tables while preserving outlines and advances')
(OUT/'p5-font.json').write_text(json.dumps(worker.run({'command':'font-fast','fontKey':ms[0]['fontKey']})))

# Save/reopen/edit three times. Searchable text alone would not catch the P4 bug.
for i,color in enumerate(['#173ea8','#7d2450','#245930']):
    r,ms=models(raw);m=next(m for m in ms if '字体测试' in m['text']);raw=paint(raw,m,color)
    r,ms=models(raw);assert any('字体测试' in m['text'] for m in ms)
    doc=fitz.open(stream=raw,filetype='pdf');assert doc[0].get_text().count('字体测试')==3
(OUT/'p5-repeat-saved.pdf').write_bytes(raw)
checks.append('Three color/save/reopen cycles retain editable paragraphs and do not duplicate text')

# Empty f/S operators must not shift the native object map.
d=fitz.open();p=d.new_page();p.insert_text((50,70),'Mapping test',fontsize=12);raw=d.tobytes();w=PdfWriter(clone_from=PdfReader(io.BytesIO(raw)));p=w.pages[0]
stream=DecodedStreamObject();stream.set_data(b'f S f\n'+p.get_contents().get_data()+b'\nf S');p[N('/Contents')]=w._add_object(stream);buf=io.BytesIO();w.write(buf)
r,ms=models(buf.getvalue());assert len(ms)==1 and ms[0]['text']=='Mapping test'
checks.append('Empty paint operators do not disable following text objects')

# Actual /Rotate, not just rotated glyph matrices.
for angle in [0,90,180,270]:
    d=fitz.open();p=d.new_page(width=612,height=792);p.insert_text((60,100),'Rotate test',fontsize=18);p.set_rotation(angle);raw=d.tobytes()
    r,ms=models(raw);assert r['size']==[612,792] and r['pageRotation']==angle
    if angle==90:(OUT/'p5-rotated.pdf').write_bytes(raw)
    saved=paint(raw,ms[0],'#173ea8');again=fitz.open(stream=saved,filetype='pdf');assert again[0].rotation==angle and 'Rotate test'in again[0].get_text()
    _,reopened=models(saved);assert reopened and reopened[0]['text']=='Rotate test'
checks.append('All four page rotations retain original page boxes and remain editable after saving')

# Segmented horizontal rules, with white cell borders from HTML exporters.
d=fitz.open();p=d.new_page(width=600,height=800);xs=[40,190,300,530];ys=[60,85,110,135,160]
for y in ys:
    for a,b in zip(xs,xs[1:]):p.draw_line((a,y),(b,y),color=(0,0,0),width=.4)
for ri in range(4):
    for ci in range(3):p.insert_text((xs[ci]+5,ys[ri]+17),f'Cell {ri},{ci}',fontsize=10)
(OUT/'p5-sparse.pdf').write_bytes(d.tobytes());r,ms=models(d.tobytes());assert any(t['rows']==4 and t['columns']==3 for t in r['tables'])
assert len([m for m in ms if m.get('cell')])==12
checks.append('Horizontal segmented rules recover cells without absorbing surrounding prose')

# Fix a browser clipping trap: expanded hmtx must agree with hhea.advanceWidthMax.
scaled=TTFont(io.BytesIO(spaced_font(str(ROOT/'native/fonts/DejaVuSans.ttf'),20,0,12)))
assert scaled['hhea'].advanceWidthMax>=max(v[0]for v in scaled['hmtx'].metrics.values())
assert repair_map(b'<0001> <0002> <1f600>')==b'<0001> <0002> [<d83dde00> <d83dde01>]'
checks.append('Expanded metrics and supplementary ToUnicode destinations remain standards-compatible')

# Native Story must keep the same offsets while merging physical line wraps.
m=dict(text='ab\ncd\nef',softBreaks=[2],pageWidth=600,pageHeight=800,frame=dict(x=40,y=50,width=300,height=200),size=12,lineHeight=1.4,color='#000000',align='left',layoutMode='reflow',fontName='内置替代字体')
r=layout(m);assert r['mappingComplete'] and not r['overflow'];gs=r['glyphs']
assert gs[0]['baseline']==gs[2]['baseline'] and gs[4]['baseline']>gs[0]['baseline']
assert [g['start'] for g in gs]==[0,1,3,4,6,7]
checks.append('Native Story merges soft wraps while retaining UTF-16 glyph offsets and hard paragraphs')

(OUT/'p5-native-report.json').write_text(json.dumps({'platform':sys.platform,'pymupdf':fitz.VersionBind,'checks':checks,'errors':[]},ensure_ascii=False,indent=2))
print(json.dumps({'checks':checks,'errors':[]},ensure_ascii=False))

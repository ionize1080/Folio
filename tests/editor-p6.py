"""Independent native round trips for page boxes, semantic text and font repair."""
from pathlib import Path
import sys,io,json,base64,copy,subprocess,hashlib
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz,worker,pypdfium2 as pdfium
from fontTools.ttLib import TTFont
from pypdf import PdfReader,PdfWriter
from pypdf.generic import DictionaryObject as D,NameObject as N,NumberObject as I
from story import layout
from font_match import load_font
from font_sfnt import normalize,tables,build
from pdf_writer import clone_document
OUT=ROOT/'tests/output';OUT.mkdir(exist_ok=True);checks=[]

def models(raw):
 r=worker.run({'command':'inspect','bytes':base64.b64encode(raw).decode(),'page':1})
 p=OUT/'p6-current.json';p.write_text(json.dumps(r))
 code="import fs from 'node:fs';import{pageCandidates}from './src/flow-page-model.mjs';const r=JSON.parse(fs.readFileSync('tests/output/p6-current.json'));console.log(JSON.stringify(pageCandidates(r.objects,...r.size,[],r.tables).map(c=>c.model)));"
 return r,json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT))

def save(raw,m,result):
 out=worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),'edits':[{'page':1,'type':'flow','sources':m.get('sources',[]),'model':m,'fragment':result['fragment']}]})
 return base64.b64decode(out['bytes'])

# Missing name is browser metadata, not a missing outline. Preserve real metrics.
f=TTFont(ROOT/'native/fonts/DejaVuSans.ttf');before=f.getTableData('glyf');widths=f.getTableData('hmtx');del f['name'];buf=io.BytesIO();f.save(buf)
fixed=normalize(buf.getvalue());after=TTFont(io.BytesIO(fixed));assert after.getTableData('glyf')==before and after.getTableData('hmtx')==widths
assert after['name'].getDebugName(1).startswith('Folio Embedded')
(OUT/'p6-missing-name.ttf').write_bytes(fixed)
checks.append('Missing name metadata repaired without changing glyf/hmtx')

# RFC 9110 subsets carry a present but zero-length OS/2 table. Treat empty
# optional metadata like missing metadata while retaining every glyph metric.
parts=tables(fixed);parts[b'OS/2']=b'';empty=build(fixed[:4],parts)
repaired=normalize(empty);after=TTFont(io.BytesIO(repaired))
assert after.getTableData('glyf')==before and after.getTableData('hmtx')==widths
assert after['OS/2'].usWeightClass==400
(OUT/'p6-empty-os2.ttf').write_bytes(repaired)
checks.append('Zero-length OS/2 metadata repaired without changing outlines or advances')

# Nonzero CropBox + all four rotations: replace with the same text in color and
# compare character origins, page boxes, other page pixels, and reopenability.
for angle in [0,90,180,270]:
 d=fitz.open();p=d.new_page(width=700,height=900);p.insert_text((180,240),'Crop 2026 test',fontsize=12);p.set_cropbox(fitz.Rect(150,100,650,800));p.set_rotation(angle)
 d.new_page().insert_text((50,80),'Untouched second page');raw=d.tobytes();r,ms=models(raw);assert r['size']==[500,700],r['size'];m=ms[0]
 assert abs(m['originalLayout']['glyphs'][0]['originX']-30)<.01
 m['color']='#173ea8'
 for run in m['runs']:run['color']='#173ea8'
 result=layout(m);assert result['mappingComplete'] and not result['overflow'];saved=save(raw,m,result)
 a=fitz.open(stream=raw,filetype='pdf');b=fitz.open(stream=saved,filetype='pdf');assert list(a[0].cropbox)==list(b[0].cropbox) and b[0].rotation==angle
 assert a[1].get_pixmap().samples==b[1].get_pixmap().samples
 r2,ms2=models(saved);assert any('Crop 2026 test' in m['text'] for m in ms2)
 original=[g for g in r['objects'] if g.get('text')=='Crop 2026 test'][0]['glyphs']
 new=[g for o in r2['objects'] if o['type']=='text' for g in o.get('glyphs',[])]
 original=[g for g in original if g['text'].strip()];new=[g for g in new if g['text'].strip()]
 assert len(original)==len(new),(angle,[(g['text'],g['originX'],g['baseline']) for g in original],[(g['text'],g['originX'],g['baseline']) for g in new])
 assert all(abs(x['originX']-y['originX'])<.05 and abs(x['baseline']-y['baseline'])<.05 for x,y in zip(original,new))
 if not angle:(OUT/'p6-crop.pdf').write_bytes(raw)
checks.append('Offset CropBox edits preserve all four rotations, glyph origins and untouched pages')

# Shared glyph IDs must not turn ASCII hyphen into U+2010 / soft hyphen on save.
f=TTFont(ROOT/'native/fonts/DejaVuSans.ttf')
for cm in f['cmap'].tables:
 if cm.isUnicode() and 45 in cm.cmap:cm.cmap[0x2010]=cm.cmap[45];cm.cmap[0xad]=cm.cmap[45]
buf=io.BytesIO();f.save(buf);d=fitz.open();p=d.new_page();p.insert_font(fontname='Alias',fontbuffer=buf.getvalue());p.insert_text((40,80),'A-B',fontname='Alias',fontsize=12);r,ms=models(d.tobytes());m=ms[0]
from font_match import CACHE
key=hashlib.sha256(buf.getvalue()).hexdigest()[:32];CACHE.mkdir(exist_ok=True)
(CACHE/(key+'.ttf')).write_bytes(buf.getvalue())
(CACHE/(key+'.json')).write_text(json.dumps({'name':'Alias fixture','coverage':sorted(f.getBestCmap())}))
m['fontKey']=key;gs=[]
for i,ch in enumerate('A-B'):gs.append(dict(text=ch,start=i,end=i+1,originX=40+i*12,baseline=80,x=40+i*12,y=68,w=10,h=12,size=12,fontKey=key,color='#000000',scale=1))
m['text']='A-B';m['fastLayout']=dict(version=1,text='A-B',glyphs=gs,anchors=[]);res=layout(m);blob=base64.b64decode(res['fragment']);doc=fitz.open(stream=blob,filetype='pdf');assert 'A-B' in ''.join(doc[0].get_text().split()),repr(doc[0].get_text())
with pdfium.PdfDocument(blob) as pdf:assert 'A-B' in ''.join(pdf[0].get_textpage().get_text_range().split())
checks.append('ActualText preserves ASCII hyphen with ambiguous Unicode-to-glyph aliases in two engines')

# Overflow stays valid and fully rendered for editing; exported page stays fixed.
m=dict(text='outside text '*30,pageWidth=200,pageHeight=120,frame=dict(x=15,y=80,width=90,height=20),size=12,lineHeight=1.2,color='#000000',align='left',allowOverflow=True,layoutMode='reflow')
res=layout(m);assert res['mappingComplete'] and res['frameOverset'] and not res['overflow'];assert res['previewBounds']['height']>120
assert len(res['glyphs'])>100
blob=base64.b64decode(res['fragment']);doc=fitz.open(stream=blob,filetype='pdf');assert doc[0].rect==fitz.Rect(0,0,200,120)
(OUT/'p6-overflow-layout.json').write_text(json.dumps(res))
d=fitz.open();p=d.new_page(width=420,height=320);p.insert_text((40,90),'Keep editing 2026',fontsize=14);p.insert_text((40,112),'Neighbouring content',fontsize=12);d.new_page(width=420,height=320).insert_text((40,80),'The next page must not steal editing focus');(OUT/'p6-overflow.pdf').write_bytes(d.tobytes())
checks.append('Overflow preview exposes the final line while preserving the exported page size')

# Mixed combining / supplementary characters use actual coverage and repaired
# UTF-16 ToUnicode before hit testing, not only during final PDF composition.
m=dict(text='café e\u0301 Ω µ ± → 😀',pageWidth=400,pageHeight=300,frame=dict(x=20,y=30,width=350,height=200),size=12,lineHeight=1.3,color='#000000',align='left',allowOverflow=True,layoutMode='reflow')
res=layout(m);assert res['mappingComplete'] and not res['overflow'];assert max(g['end'] for g in res['glyphs'])==len(m['text'].encode('utf-16-le'))//2
blob=base64.b64decode(res['fragment']);doc=fitz.open(stream=blob,filetype='pdf');assert '😀' in doc[0].get_text()
checks.append('Combining marks, symbols and supplementary emoji retain complete UTF-16 hit-test offsets and exported Unicode')

# Deep indirect object chains: keep structure instead of deleting tags/outlines.
w=PdfWriter();w.add_blank_page(width=300,height=400);node=D({N('/Value'):I(1)})
for i in range(800):node=D({N('/Next'):w._add_object(node)})
w._root_object[N('/FolioDeepTest')]=w._add_object(node);buf=io.BytesIO();w.write(buf);reader=PdfReader(io.BytesIO(buf.getvalue()));before=sys.getrecursionlimit();cloned=clone_document(reader);assert sys.getrecursionlimit()==before
node=cloned._root_object['/FolioDeepTest'];count=0
while '/Next' in node:count+=1;node=node['/Next']
assert count==800
checks.append('Bounded deep cloning preserves the complete graph and restores the process recursion limit')

(OUT/'p6-native-report.json').write_text(json.dumps({'platform':sys.platform,'checks':checks,'errors':[]},ensure_ascii=False,indent=2))
print(json.dumps({'checks':checks,'errors':[]},ensure_ascii=False))

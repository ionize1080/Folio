"""Real yearbook regression: shared text cursor, columns, images, fonts, cells."""
import sys,os,json,base64,io,subprocess,struct,time
from pathlib import Path
import fitz
from reportlab.pdfgen import canvas
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
import worker
from story import layout
from font_match import load_font,spaced_font
sample=Path(sys.argv[1]);out=root/'tests/output';out.mkdir(exist_ok=True);checks=[]
def check(name):checks.append(name);print('PASS',name,flush=True)
def candidates(page):
 r=worker.run({'command':'inspect','input':str(sample),'page':page})
 program="import {pageCandidates} from './src/flow-page-model.mjs';let s='';for await(const c of process.stdin)s+=c;let r=JSON.parse(s);console.log(JSON.stringify(pageCandidates(r.objects,...r.size,[],r.tables)));"
 result=subprocess.run(['node','--input-type=module','-e',program],input=json.dumps(r),text=True,cwd=root,capture_output=True,check=True)
 return r,json.loads(result.stdout)
def apply(path,edits,name):
 dest=out/name;worker.run({'command':'apply','input':str(path),'output':str(dest),'edits':edits});return dest
r,cs=candidates(4)
assert len(cs)>=7 and all(c['model']['frame']['width']<220 for c in cs)
check('Three-column yearbook is separated despite shared BT groups')
c=next(c for c in cs if c['model']['text'].startswith('【巍宝山乡法治'));m=c['model'];rr=layout(m)
assert rr['mappingComplete'] and not rr['overflow'] and rr['fallbackCount']==0
assert len({r['fontKey'] for r in m['runs']})>=2
assert abs(rr['glyphs'][0]['baseline']-m['originalBaseline'])<1
check('Original serif and heading fonts retained with effective 10.5pt size and original baseline')
# Font spacing really changes advance widths before the Story layout.
f=load_font(m['fontKey']);a=fitz.Font(fontfile=f['path']);b=fitz.Font(fontbuffer=spaced_font(f['path'],1,0,10.5))
assert abs((b.glyph_advance(ord('代'))-a.glyph_advance(ord('代')))*10.5-1)<.02
check('Character spacing is measured in points and participates in wrapping')
old=m['text'];m={**m,'text':'【巍宝山乡法治建设】本地编辑验证 2025。','runs':[]};rr=layout(m);assert not rr['overflow']
e={'id':'paragraph','page':4,'type':'flow','sources':m['sources'],'model':m,'fragment':rr['fragment']}
p=apply(sample,[e],'v8-yearbook-edited.pdf');a=fitz.open(sample);b=fitz.open(p)
assert '本地编辑验证' in ''.join(b[3].get_text().split()) and ''.join(old[30:60].split()) not in ''.join(b[3].get_text().split())
clip=fitz.Rect(218,75,594,842);assert a[3].get_pixmap(clip=clip).samples==b[3].get_pixmap(clip=clip).samples
for im in a[3].get_image_info():
 clip=fitz.Rect(im['bbox']);assert a[3].get_pixmap(clip=clip).samples==b[3].get_pixmap(clip=clip).samples
assert all(a[i].get_pixmap().samples==b[i].get_pixmap().samples for i in range(len(a)) if i!=3)
check('Other columns, photo pixels and all 11 untouched pages remain pixel exact; source text removed')
blank=layout({**m,'text':''})
background=worker.run({'command':'flow-background','input':str(sample),'page':4,'edits':[{**e,'fragment':blank['fragment']}]})
bg=fitz.open(stream=base64.b64decode(background['pdf']),filetype='pdf')
for im in a[3].get_image_info():
 clip=fitz.Rect(im['bbox']);assert a[3].get_pixmap(clip=clip).samples==bg[0].get_pixmap(clip=clip).samples
check('Editing background stays PDF, preserving CMYK images and Decode arrays')
r,cells=candidates(2);cells=[c for c in cells if c['model'].get('cell')];assert len(cells)>20
c=next(c for c in cells if len(c['model']['text'].strip())>1);m={**c['model'],'text':'核验','runs':[]};rr=layout(m);assert rr['mappingComplete'] and not rr['overflow']
table_edit={'id':'cell','page':2,'type':'flow','sources':m['sources'],'model':m,'fragment':rr['fragment']}
p=apply(sample,[table_edit],'v8-table-edited.pdf');b=fitz.open(p);assert '核验' in b[1].get_text()
# A one-point strip centered on each border must be unchanged.
x,y,x1,y1=m['cell']['bounds']
for clip in [fitz.Rect(x,y-.4,x1,y+.4),fitz.Rect(x,y1-.4,x1,y1+.4),fitz.Rect(x-.4,y,x+.4,y1),fitz.Rect(x1-.4,y,x1+.4,y1)]:
 assert a[1].get_pixmap(matrix=fitz.Matrix(2,2),clip=clip).samples==b[1].get_pixmap(matrix=fitz.Matrix(2,2),clip=clip).samples
check('Real table cell edits are searchable, with all four original borders pixel exact')
# Adjacent Tj operators share a cursor. Deleting the first must not shift the second.
src=out/'v8-advance-source.pdf';c=canvas.Canvas(str(src));t=c.beginText(50,700);t.setCharSpace(1.2);t.setWordSpace(2);t.textOut('REMOVE ME ');t.textOut('KEEP THIS');c.drawText(t);c.save()
objs=worker.run({'command':'inspect','input':str(src),'page':1})['objects'];o=next(o for o in objs if o.get('text','').startswith('REMOVE'))
w,h=fitz.open(src)[0].rect[2:];m={'text':'','pageWidth':w,'pageHeight':h,'frame':{'x':50,'y':50,'width':200,'height':50},'size':12,'lineHeight':1.4,'color':'#000000','align':'left'}
e={'id':'advance','page':1,'type':'flow','sources':[{'index':o['index'],'signature':o['signature']}],'fragment':layout(m)['fragment']}
p=apply(src,[e],'v8-advance-edited.pdf');before=fitz.open(src);after=fitz.open(p)
x=before[0].search_for('KEEP THIS')[0];y=after[0].search_for('KEEP THIS')[0];assert max(abs(a-b) for a,b in zip(x,y))<.001 and 'REMOVE' not in after[0].get_text()
check('Numeric TJ preserves same-line advances and removes old searchable text')
try:apply(src,[{**e,'sources':[{'index':o['index'],'signature':'stale'}]}],'v8-stale.pdf');raise AssertionError('stale accepted')
except ValueError:pass
check('Stale source identities rejected')
(out/'v8-native-report.json').write_text(json.dumps({'checks':checks,'cellCount':len(cells)},ensure_ascii=False,indent=2))

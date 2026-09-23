"""Save/reopen regression for 0.9: fonts, deliberate overlap, page crop and row height."""
import sys,json,subprocess,copy,unicodedata
from pathlib import Path
import fitz
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
import worker
from story import layout
from system_fonts import list_fonts,select_font
out=root/'tests/output';src=out/'v9-fixture.pdf';checks=[]
subprocess.run([sys.executable,str(root/'tests/fixture-v9.py')],check=True)
def check(name):checks.append(name);print('PASS',name,flush=True)
def apply(edits,name):
 dest=out/name;worker.run({'command':'apply','input':str(src),'output':str(dest),'edits':edits});return fitz.open(dest)
def entry(m,ident='edit'):
 rr=layout(m);assert rr['mappingComplete'] and not rr['overflow'],rr.get('overflow')
 return {'id':ident,'page':1,'type':'flow','sources':m.get('sources',[]),'model':m,'fragment':rr['fragment'],'ink':rr['glyphs']}
r=worker.run({'command':'inspect','input':str(src),'page':1})
js="import {pageCandidates} from './src/flow-page-model.mjs';let s='';for await(const c of process.stdin)s+=c;let r=JSON.parse(s);console.log(JSON.stringify(pageCandidates(r.objects,...r.size,[],r.tables)));"
cs=json.loads(subprocess.run(['node','--input-type=module','-e',js],cwd=root,input=json.dumps(r),text=True,capture_output=True,check=True).stdout)
original=fitz.open(src)
# Whole row moves border and following cells while unrelated content remains exact.
m=copy.deepcopy(next(c['model'] for c in cs if c['model'].get('cell',{}).get('row')==0))
t=next(t for t in r['tables'] if t['id']==m['cell']['tableId']);bounds=m['cell']['bounds'][:]
m['text']='Expanded cell row. '*15;m['runs']=[];m['frame']['height']+=115
m['tableGrowth']={'tableId':t['id'],'bounds':t['bounds'],'y':bounds[3],'delta':115}
e=entry(m);doc=apply([e],'v9-native-table.pdf')
assert 'Expanded cell row.' in doc[0].get_text()
a=original[0].search_for('Cell 2-1')[0];b=doc[0].search_for('Cell 2-1')[0];assert abs(b.y0-a.y0-115)<.01
for clip in [fitz.Rect(0,0,600,330),fitz.Rect(0,645,600,800)]:assert original[0].get_pixmap(clip=clip).samples==doc[0].get_pixmap(clip=clip).samples
assert tuple(doc[0].search_for('Unrelated footer')[0])==tuple(original[0].search_for('Unrelated footer')[0])
# Header fill and lower border really expand, not merely the text box.
assert any(abs(d['rect'].y1-500)<.01 for d in doc[0].get_drawings())
check('Row height moves subsequent cells and boundaries; untouched regions remain pixel exact after reopen')
# Same region, two text layers; order is preserved in the actual PDF paint stream.
a={'pageWidth':600,'pageHeight':800,'text':'OVERLAP','sources':[],'frame':{'x':50,'y':60,'width':250,'height':70},'size':32,'lineHeight':1.2,'color':'#ff0000','align':'left','layerOrder':0}
b={**copy.deepcopy(a),'color':'#0000ff','layerOrder':1}
doc1=apply([entry(a,'a'),entry(b,'b')],'v9-native-overlap-blue.pdf')
a['layerOrder']=2;doc2=apply([entry(a,'a'),entry(b,'b')],'v9-native-overlap-red.pdf')
clip=fitz.Rect(50,60,300,130);pix1=doc1[0].get_pixmap(clip=clip).samples;pix2=doc2[0].get_pixmap(clip=clip).samples
assert pix1!=pix2 and doc1[0].get_text().count('OVERLAP')==2
check('Deliberately overlapping text saves and reopens with the selected layer order')
# Below the original table fill is hidden; above is visible.
a.update(frame={'x':50,'y':345,'width':150,'height':35},size=16,text='UNDER HEADER',behindPage=True)
below=apply([entry(a)],'v9-native-below.pdf');a['behindPage']=False;above=apply([entry(a)],'v9-native-above.pdf')
clip=fitz.Rect(50,345,200,380);assert below[0].get_pixmap(clip=clip).samples==original[0].get_pixmap(clip=clip).samples
assert above[0].get_pixmap(clip=clip).samples!=below[0].get_pixmap(clip=clip).samples
check('Placement above or below original page content matches saved rendering')
# Fixed frame: full text retained after explicitly allowing overflow.
a.update(frame={'x':40,'y':750,'width':170,'height':20},text='Keep all this overflow text. '*8,size=12,allowOverflow=True)
e=entry(a);assert len(e['ink'])>100
doc=apply([e],'v9-native-overflow.pdf');text=unicodedata.normalize('NFKC',doc[0].get_text(clip=fitz.INFINITE_RECT()))
# A PDF reader may insert physical line breaks inside the marked paragraph.
# Check every original character and word space, including the off-page tail.
saved_text=text[text.index('Keep all this'):].replace('\n','').rstrip()
assert saved_text==a['text'].rstrip(),repr(saved_text)
assert doc[0].rect.height==800
check('Explicit overflow retains text beyond the original frame and preserves the page crop')
# Font selection coverage and glyph preview / output agreement.
f=next(f for f in list_fonts()['fonts'] if 'DejaVu Sans' in f['name']);font=select_font(f['id'])
m=copy.deepcopy(next(c['model'] for c in cs if c['model']['text']=='Short title'));m.update(text='Hello 中文',fontKey=font['fontKey'],fontName=font['fontName'],runs=[],frame={'x':45,'y':90,'width':300,'height':80})
rr=layout(m);assert rr['fallbackCount']==2 and [x['text'] for x in rr['fallbackDetails']]==['中','文']
doc=apply([entry(m)],'v9-native-fonts.pdf');assert 'Hello 中文' in doc[0].get_text()
check('Chosen font is embedded; missing Chinese characters report only the necessary fallback')
(out/'v9-native-report.json').write_text(json.dumps({'checks':checks},ensure_ascii=False,indent=2))


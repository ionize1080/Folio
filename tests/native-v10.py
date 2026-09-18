import os,sys,json,copy,base64,io,subprocess,unicodedata
from pathlib import Path
import fitz
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
import worker
from story import layout
from table_render import render as render_table
out=root/'tests/output';checks=[]
def check(s):checks.append(s);print('PASS',s,flush=True)
def candidates(r):
 js="import {pageCandidates} from './src/flow-page-model.mjs';let s='';for await(const c of process.stdin)s+=c;let r=JSON.parse(s);console.log(JSON.stringify(pageCandidates(r.objects,...r.size,[],r.tables)));"
 return json.loads(subprocess.run(['node','--input-type=module','-e',js],cwd=root,input=json.dumps(r),text=True,capture_output=True,check=True).stdout)
def apply(src,edits,name):
 dest=out/name;worker.run({'command':'apply','input':str(src),'output':str(dest),'edits':edits});return fitz.open(dest)
# Real QDII Type1 glyphs remain reusable after change / output reopening.
if os.environ.get('FOLIO_TEST_DOCUMENTS')=='1':
 src=Path(os.environ.get('FOLIO_FIXTURES',root.parent/'upload'))/'QDII额度与纳指标普产品比较_20260831(1).pdf';r=worker.run({'command':'inspect','input':str(src),'page':2});cs=candidates(r)
 m=copy.deepcopy(max((c['model'] for c in cs if not c['model'].get('cell')),key=lambda m:len(m['text'])));original=m['text'];m['text']=original.replace('68.40','68.41',1);m['frame']['height']+=35;m['allowOverflow']=True
 rr=layout(m);assert rr['mappingComplete'] and rr['fallbackCount']==0
 entry={'id':'font-change','page':2,'type':'flow','sources':m['sources'],'model':m,'fragment':rr['fragment'],'ink':rr['glyphs']}
 doc=apply(src,[entry],'v10-qdii-font-output.pdf');actual=''.join(doc[1].get_text().split());expected=''.join(m['text'].split());assert expected in actual,(expected[:100],actual[:100]);doc.close();check('QDII Type1 source subset: edit, real PDF output and reopen retain all paragraph characters with zero fallback')
else:
 m=copy.deepcopy(candidates(worker.run({'command':'inspect','input':str(out/'v9-fixture.pdf'),'page':1}))[0]['model'])
# Same-page frame chain renders in explicitly specified independent rectangles.
m.update(text='Frame content. '*15,runs=[],fontKey=None,fontName='内置替代字体',size=10,lineHeight=1.2,allowOverflow=False,frames=[{'x':30,'y':50,'width':120,'height':80},{'x':250,'y':220,'width':170,'height':220}],frame={'x':30,'y':50,'width':390,'height':390},sources=[])
rr=layout(m);assert not rr['overflow'] and rr['mappingComplete'];assert len(rr['frames'])==2;assert any(g['x']>=250 for g in rr['glyphs']);check('Native text chain continues across explicit same-page frames without filling the intervening region')
# Shared resource images: only chosen Do is changed. No resampling for crop.
pix=fitz.Pixmap(fitz.csRGB,fitz.IRect(0,0,40,30));pix.clear_with(180);img=pix.tobytes('png');d=fitz.open();p=d.new_page(width=500,height=400);xref=p.insert_image(fitz.Rect(30,40,190,160),stream=img);p.insert_image(fitz.Rect(270,40,430,160),xref=xref);srcimg=out/'v10-shared-image.pdf';d.save(srcimg);d.close()
r=worker.run({'command':'inspect','input':str(srcimg),'page':1});images=[o for o in r['objects'] if o['type']=='image'];assert len(images)==2 and images[0]['editable'];e={**images[0],'page':1,'crop':[25,0,0,0]};d=apply(srcimg,[e],'v10-cropped-image.pdf');orig=fitz.open(srcimg);clip=fitz.Rect(250,20,450,180);assert d[0].get_pixmap(clip=clip).samples==orig[0].get_pixmap(clip=clip).samples;assert d[0].get_pixmap(clip=fitz.Rect(30,40,65,160)).samples!=orig[0].get_pixmap(clip=fitz.Rect(30,40,65,160)).samples;d.close();
e['crop']=[0,0,0,0];d=apply(srcimg,[e],'v10-restored-image.pdf');assert d[0].get_pixmap().samples==orig[0].get_pixmap().samples;d.close()
pix.clear_with(40);e.update(imageData=base64.b64encode(pix.tobytes('png')).decode(),imageFit='contain');d=apply(srcimg,[e],'v10-replaced-image.pdf');assert d[0].get_pixmap(clip=clip).samples==orig[0].get_pixmap(clip=clip).samples;assert d[0].get_pixmap(clip=fitz.Rect(30,40,190,160)).samples!=orig[0].get_pixmap(clip=fitz.Rect(30,40,190,160)).samples;d.close();orig.close();check('Shared image resource: isolated crop, exact restoration and single-instance replacement verified after reopening')
# Table rebuilt inside its original extent preserves outside-page content.
src=root/'tests/output/v9-fixture.pdf';r=worker.run({'command':'inspect','input':str(src),'page':1});cs=candidates(r);t=r['tables'][0];xs=sorted(set(x for c in t['cells'] for x in [c['bounds'][0],c['bounds'][2]]));ys=sorted(set(y for c in t['cells'] for y in [c['bounds'][1],c['bounds'][3]]));table={**t,'pageWidth':r['size'][0],'pageHeight':r['size'][1],'widths':[b-a for a,b in zip(xs,xs[1:])],'heights':[b-a for a,b in zip(ys,ys[1:])],'cells':[{**c,'model':next(q['model'] for q in cs if q['model'].get('cell',{}).get('id')==c['id'])} for c in t['cells']]};table['cells'][0]['model']['text']='Changed';table['cells'][0]['model']['runs']=[];rr=render_table(table)
sources=[s for c in table['cells'] for s in c['model']['sources']];m=copy.deepcopy(table['cells'][0]['model']);m.pop('cell',None);m.update(text='Changed',sources=sources)
b=t['bounds'];edits=[{'page':1,'type':'path','index':o['index'],'signature':o['signature'],'delete':True} for o in r['objects'] if o['type']=='path' and o['bounds'][0]>=b[0]-1 and o['bounds'][2]<=b[2]+1 and r['size'][1]-o['bounds'][3]>=b[1]-1 and r['size'][1]-o['bounds'][1]<=b[3]+1];edits.append({'page':1,'type':'flow','sources':sources,'model':m,'fragment':rr['fragment']});d=apply(src,edits,'v10-table-output.pdf');assert 'Changed' in d[0].get_text();orig=fitz.open(src)
for clip in [fitz.Rect(0,0,600,330),fitz.Rect(0,550,600,800)]:assert d[0].get_pixmap(clip=clip).samples==orig[0].get_pixmap(clip=clip).samples
check('Table structure output preserves searchable cell text and leaves regions outside table pixel exact')
(out/'v10-native-report.json').write_text(json.dumps({'checks':checks},ensure_ascii=False,indent=2))
# Localized name table and every TTC face are selected independently.
import tempfile
import system_fonts as sf
from fontTools.ttLib import TTCollection,TTFont
old_file=sf.__file__
with tempfile.TemporaryDirectory() as temp:
 try:
  folder=Path(temp)/'fonts';folder.mkdir();paths=[Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),Path('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf')]
  if all(p.exists() for p in paths):
   coll=TTCollection();coll.fonts=[TTFont(str(p)) for p in paths]
   for i,f in enumerate(coll.fonts):
    for ident in [1,4,16]:f['name'].setName('测试字面'+str(i),ident,3,1,0x804)
   coll.save(str(folder/'qa.ttc'));sf.__file__=str(Path(temp)/'system_fonts.py');sf.catalog.cache_clear();faces=[f for f in sf.catalog().values() if f['path'].endswith('qa.ttc')];assert len(faces)==2 and {f['name'] for f in faces}=={'测试字面0','测试字面1'};chosen=[sf.select_font(f['id']) for f in faces];assert chosen[0]['fontKey']!=chosen[1]['fontKey'];check('TTC faces have independent IDs and actual font data; Chinese localized names take precedence')
 finally:sf.__file__=old_file;sf.catalog.cache_clear()
(out/'v10-native-report.json').write_text(json.dumps({'checks':checks},ensure_ascii=False,indent=2))

"""Local deletion retains an overlapping text-free foreground Form and z-order."""
from pathlib import Path
import sys,copy,json,subprocess,base64,io
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor'),str(ROOT/'tests')]
from p8_helpers import models,save,pixels,OUT
from story import layout
from pypdf import PdfReader
from content import map_objects
import fitz
d=fitz.open();p=d.new_page(width=400,height=240)
p.insert_font(fontname='F',fontfile=str(ROOT/'native/fonts/DejaVuSans.ttf'))
p.insert_text((40,80),'Original foreground watermark example.',fontname='F',fontsize=12)
mark=fitz.open();q=mark.new_page(width=400,height=240)
q.draw_rect((100,50,320,110),color=None,fill=(.3,.7,.9),fill_opacity=.25)
p.show_pdf_page(p.rect,mark,0)
d.new_page(width=400,height=240).insert_text((20,40),'Unchanged neighbor')
raw=d.tobytes();d.close();mark.close()
r,ms=models(raw);m=ms[0];m['text']=m['text'].replace('foreground ','')
result=layout(m);assert result['mappingComplete'] and not result['overflow']
check="import{flowConflicts}from'./src/flow-page-model.mjs';let s='';for await(const c of process.stdin)s+=c;const{m,r,g}=JSON.parse(s);console.log(JSON.stringify(flowConflicts(m,r.objects,[],1,null,g)));"
conflicts=json.loads(subprocess.check_output(['node','--input-type=module','-e',check],cwd=ROOT,input=json.dumps({'m':m,'r':r,'g':result['glyphs']}).encode()))
assert not conflicts,conflicts
changed=save(raw,m,result=result)
reader=PdfReader(io.BytesIO(changed));stream,objects=map_objects(reader.pages[0])
forms=[o for o in objects if o['type']=='form'];assert len(forms)==2
# The replacement Form is before the original watermark invocation.
args,_=stream.operations[forms[-1]['at']]
assert str(args[0]).startswith('/fzFrm'),args
assert pixels(raw,1)==pixels(changed,1)
for clip in [fitz.Rect(0,0,400,60),fitz.Rect(0,90,400,240)]:assert pixels(raw,0,clip)==pixels(changed,0,clip)
_,again=models(changed);assert any(x['text']==m['text'] for x in again)
report={'checks':['existing foreground artwork overlap permits deletion within original ink bounds','saved replacement stays before original watermark','untouched artwork bands and adjacent page remain identical','saved paragraph reopens exactly'],'errors':[]}
(OUT/'v191-watermark-report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))

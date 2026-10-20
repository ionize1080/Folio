"""Direct save and frontend reject stranded pronunciation labels equally."""
from pathlib import Path
import base64, copy, json, sys, subprocess
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/'tests'), str(ROOT/'native'), str(ROOT/'native/vendor')]
from p8_helpers import models, save, pixels, OUT
from story import layout
from generated_cmaps import repair
import fitz
import worker

d = fitz.open()
p = d.new_page(width=400,height=220)
p.insert_font(fontname='F',fontfile=str(ROOT/'native/fonts/NotoSansSC.ttf'))
p.insert_font(fontname='L',fontfile=str(ROOT/'native/fonts/DejaVuSans.ttf'))
p.insert_text((30,60),'春天来到了山野。',fontsize=14,fontname='F')
p.insert_text((60,46),'lai',fontsize=9,fontname='L')
d.new_page(width=400,height=220).insert_text((20,40),'Untouched sibling')
d.subset_fonts();raw=repair(d.tobytes(),generated=True);d.close()
inspection,candidates=models(raw)
original=next(m for m in candidates if m['text']=='春天来到了山野。')

def edit(text, reflow=False):
    code="import{editStyles,editSoftBreaks}from'./src/flow-style.mjs';let s='';for await(const c of process.stdin)s+=c;const{m,text}=JSON.parse(s);m.runs=editStyles(m.runs,m.text,text,m);m.softBreaks=editSoftBreaks(m.softBreaks,m.text,text);m.text=text;console.log(JSON.stringify(m));"
    m=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'m':original,'text':text}).encode()))
    if reflow:m.update(layoutMode='reflow');m['frame'].update(width=300,height=140)
    return m

checks=[]
for text,reflow,blocked in [('春天来到了山天。',False,False),('春来到了山野。',True,True),('春天到了山野。',True,True)]:
    m=edit(text,reflow);r=layout(m)
    assert r['mappingComplete'] and not r['overflow']
    code="import{rubyConflicts}from'./src/ruby-anchors.mjs';let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s);console.log(JSON.stringify(rubyConflicts(v.m,v.objects,v.glyphs)));"
    conflicts=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'m':m,'objects':inspection['objects'],'glyphs':r['glyphs']}).encode()))
    assert bool(conflicts)==blocked,(text,conflicts)
    try:
        changed=save(raw,m,result=r)
        assert not blocked,'native save accepted stranded pinyin'
        assert pixels(raw,1)==pixels(changed,1)
        assert pixels(raw,clip=fitz.Rect(59,36,75,47))==pixels(changed,clip=fitz.Rect(59,36,75,47))
    except ValueError as error:
        assert blocked and '注音' in str(error),str(error)
    checks.append({'text':text,'blocked':blocked,'uiNativeAgree':True})

# Opening the UI hides the source paragraph in a temporary background. That
# internal operation must work, while identical public save data still rejects.
erased=copy.deepcopy(original);erased['text']=''
temporary={'page':1,'type':'flow','sources':erased['sources'],'model':erased}
background=worker.run({'command':'flow-background','bytes':base64.b64encode(raw).decode(),
                       'page':1,'edits':[temporary]})
with fitz.open(stream=base64.b64decode(background['pdf']),filetype='pdf') as d:
    assert len(d)==1 and 'lai' in d[0].get_text() and '春' not in d[0].get_text()
for flags in ({},{'preview':True,'_preview':True,'resolvedForms':True}):
    try:
        worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),
                    'edits':[{**temporary,'preview':True,'_preview':True}],**flags})
        raise AssertionError('public save flags bypassed pronunciation protection')
    except ValueError as error:
        assert '注音' in str(error),str(error)
checks.append({'openingBackgroundErasesSource':True,'publicSaveCannotBypassRubyProtection':True})
out=OUT/'deep-edit-v191-paragraphs';out.mkdir(exist_ok=True)
(out/'ruby-report.json').write_text(json.dumps({'checks':checks,'errors':[]},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'checks':checks,'errors':[]}))

"""Save/reopen/edit/save regression for logical soft wraps and live background ownership."""
from pathlib import Path
import sys,json,base64,copy,subprocess,hashlib,os
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'native'),str(ROOT/'native/vendor')]
sys.stdout.reconfigure(encoding='utf-8')
import fitz,worker
from p8_helpers import models,save,pixels
from story import layout
BASE=ROOT/'tests/output/reopen-v190';BASE.mkdir(parents=True,exist_ok=True)
OUT=BASE/('run-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));OUT.mkdir()
checks=[]

def edited(model):
    code="import{editStyles,editSoftBreaks}from'./src/flow-style.mjs';let s='';for await(const c of process.stdin)s+=c;const m=JSON.parse(s),old=m.text;m.text=old[0]+old;m.runs=editStyles(m.runs||[],old,m.text,m);m.softBreaks=editSoftBreaks(m.softBreaks||[],old,m.text);console.log(JSON.stringify(m));"
    return json.loads(subprocess.check_output(['node','--input-type=module','-e',code],input=json.dumps(model).encode(),cwd=ROOT))

def reopened(raw,text,soft):
    inspection,ms=models(raw)
    found=next(m for m in ms if m['text']==text)
    assert found['softBreaks']==soft,(found['softBreaks'],soft)
    assert not found.get('styleMappingWarning'),found.get('styleMappingWarning')
    background=worker.run({'command':'flow-background','bytes':base64.b64encode(raw).decode(),'page':1,
        'edits':[{'page':1,'type':'flow','sources':found['sources'],'model':{'text':''},'fragment':''}]})
    with fitz.open(stream=base64.b64decode(background['pdf']),filetype='pdf')as doc:
        assert ''.join(text.split()) not in ''.join(doc[0].get_text().split())
    return inspection,found

doc=fitz.open();doc.new_page(width=300,height=300);doc.new_page(width=300,height=300)
doc[1].insert_text((20,30),'Untouched sibling');raw=doc.tobytes();doc.close()
model=dict(text='alpha beta\ngamma delta\nA hard paragraph',softBreaks=[10],sources=[],
    pageWidth=300,pageHeight=300,frame=dict(x=30,y=30,width=74,height=200),size=10,
    lineHeight=1.4,paragraphGap=0,columns=1,gap=18,align='left',color='#202020',font='sans',layoutMode='reflow')
r=layout(model);assert r['mappingComplete'] and not r['overflow']
first=save(raw,model,result=r)
(OUT/'soft-hard-first.pdf').write_bytes(first)
_,again=reopened(first,model['text'],model['softBreaks'])
second=edited(again);second['layoutMode']='reflow';second.pop('originalLayout',None)
second['frame'].update(width=240,height=200)
r=layout(second);assert r['mappingComplete'] and not r['overflow']
(OUT/'soft-hard-second.model.json').write_text(json.dumps(second,ensure_ascii=False),encoding='utf8')
visible=[g for g in r['glyphs']if second['text'][g['start']:g['end']].strip()]
soft=second['softBreaks'][0];hard=second['text'].index('\n',soft+1)
before=lambda n:next(g for g in reversed(visible)if g['end']<=n)
after=lambda n:next(g for g in visible if g['start']>n)
assert abs(before(soft)['baseline']-after(soft)['baseline'])<.1,'saved soft newline became a hard line break'
assert after(hard)['baseline']-before(hard)['baseline']>5,'typed hard paragraph break was lost'
last=save(first,second,result=r)
reopened(last,second['text'],second['softBreaks'])
assert pixels(raw,1)==pixels(first,1)==pixels(last,1)
(OUT/'soft-hard-second-edit.pdf').write_bytes(last)
checks.append('narrow first save → reopen → insert and widen: soft wrap rejoins, typed hard newline remains; second save/reopen and sibling pixels pass')

corpus=sys.argv[1] if len(sys.argv)>1 else os.environ.get('FOLIO_CORPUS')
if corpus:
    source=next(Path(corpus).rglob('Beyond SAEs_*.pdf'))
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    with fitz.open(source)as doc:
        selected=fitz.open();selected.insert_pdf(doc,from_page=1,to_page=2);raw=selected.tobytes();selected.close()
    inspection,ms=models(raw)
    original=next(m for m in ms if m['text'].startswith('that coefficients predicted'))
    assert len(original['softBreaks'])>=3
    first_model=edited(original);r=layout(first_model)
    assert r['mappingComplete'] and not r['overflow']
    first=save(raw,first_model,result=r)
    _,again=reopened(first,first_model['text'],first_model['softBreaks'])
    second=edited(again);second['layoutMode']='reflow';second.pop('originalLayout',None)
    second['frame']['width']=min(second['pageWidth']-second['frame']['x']-20,second['frame']['width']+20)
    second['frame']['height']+=20
    r=layout(second);assert r['mappingComplete'] and not r['overflow']
    code="import{flowConflicts}from'./src/flow-page-model.mjs';let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s);console.log(JSON.stringify(flowConflicts(v.m,v.objects,[],1,null,v.glyphs)));"
    # Reopened ownership indices apply to the reopened document's objects.
    inspection,_=models(first)
    conflicts=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],input=json.dumps({'m':second,'objects':inspection['objects'],'glyphs':r['glyphs']}).encode(),cwd=ROOT))
    assert not conflicts,conflicts
    last=save(first,second,result=r)
    reopened(last,second['text'],second['softBreaks'])
    with fitz.open(stream=last,filetype='pdf')as doc:
        assert ''.join(doc[0].get_text().split()).count(''.join(second['text'].split()))==1
    assert pixels(raw,1)==pixels(first,1)==pixels(last,1)
    assert hashlib.sha256(source.read_bytes()).hexdigest()==digest
    (OUT/'beyond-second-edit.pdf').write_bytes(last)
    checks.append('real Beyond SAEs page 2 retains all logical wraps through two inserts, explicit widening, two saves/reopens, live background removal, and real adjacent page pixel checks')

    source=next(Path(corpus).rglob('佰维存储_*.pdf'))
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    with fitz.open(source)as doc:
        selected=fitz.open();selected.insert_pdf(doc,from_page=4,to_page=5);raw=selected.tobytes();selected.close()
    _,ms=models(raw)
    original=next(m for m in ms if m.get('cell') and m['text'].startswith('深圳方泰来企业管理'))
    assert len(original['softBreaks'])==2
    first_model=edited(original);r=layout(first_model)
    assert r['mappingComplete'] and not r['overflow']
    first=save(raw,first_model,result=r)
    _,again=reopened(first,first_model['text'],first_model['softBreaks'])
    assert again['cell']['row']==original['cell']['row'] and again['cell']['column']==original['cell']['column']
    second=edited(again);r=layout(second)
    assert r['mappingComplete'] and not r['overflow']
    last=save(first,second,result=r)
    reopened(last,second['text'],second['softBreaks'])
    assert pixels(raw,1)==pixels(first,1)==pixels(last,1)
    x,y,right,bottom=original['cell']['bounds'];w=original['pageWidth'];h=original['pageHeight']
    for clip in ((0,0,w,y),(0,bottom,w,h),(0,y,x,bottom),(right,y,w,bottom)):
        assert pixels(raw,0,clip)==pixels(first,0,clip)==pixels(last,0,clip),'neighbouring table cells changed'
    assert hashlib.sha256(source.read_bytes()).hexdigest()==digest
    (OUT/'baiwei-table-second-edit.pdf').write_bytes(last)
    checks.append('real Baiwei page 5 table cell retains exact logical text and soft wraps through two insert/save/reopen cycles, while neighbouring cells and the actual adjacent page remain pixel-identical')

report={'checks':checks,'errors':[],'artifactDirectory':str(OUT.relative_to(ROOT))}
(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(BASE/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'checks':checks,'errors':[]},ensure_ascii=False))

"""Real-document pipeline timings and anchored-save checks; never writes sources."""
import base64
import copy
import cProfile
import io
import json
import pstats
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor'),str(ROOT/'tests')]
sys.stdout.reconfigure(encoding='utf8')
import fitz
import worker
from story import layout
from p8_helpers import save,pixels,models

OUT=ROOT/'tests/output/paragraph-pipeline-profile'
OUT.mkdir(parents=True,exist_ok=True)
report=[]
def timed(label,fn,record):
    start=time.perf_counter();value=fn();record[label]=round((time.perf_counter()-start)*1000,2);return value
def profile(label,fn):
    pr=cProfile.Profile();value=pr.runcall(fn)
    out=io.StringIO();pstats.Stats(pr,stream=out).sort_stats('cumtime').print_stats(35)
    (OUT/(label+'.txt')).write_text(out.getvalue(),encoding='utf8')
    return value

for source,page in [
    (Path(r'C:\Users\haowe\Downloads\中国交通年鉴2025_1-edited.pdf'),62),
    (Path(r'D:\APP\PDF Samples\普通高中教科书·语文必修 上册.pdf'),8),
    (Path(r'D:\APP\PDF Samples\金融机构编码规范.pdf'),3),
]:
    if not source.exists():continue
    raw=source.read_bytes();encoded=base64.b64encode(raw).decode();name=source.stem
    args=dict(command='inspect',bytes=encoded,page=page);record=dict(source=source.name,page=page,timings={});timings=record['timings']
    inspect=timed('inspectFirstMs',lambda:worker.run(args),timings)
    again=timed('inspectWarmMs',lambda:worker.run(args),timings);assert inspect==again
    profile(name+'-inspect',lambda:worker.run(args))
    code="""import{pageCandidates}from'./src/flow-page-model.mjs';let s='';for await(const c of process.stdin)s+=c;const r=JSON.parse(s),ms=[];let candidates;for(let i=0;i<31;i++){const t=performance.now();candidates=pageCandidates(r.objects,...r.size,[],r.tables);ms.push(performance.now()-t)};console.log(JSON.stringify({candidates,firstMs:ms[0],medianMs:ms.slice(1).sort((a,b)=>a-b)[15]}));"""
    grouped=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],input=json.dumps(inspect).encode(),cwd=ROOT))
    timings['groupingFirstMs']=round(grouped['firstMs'],2);timings['groupingMedianMs']=round(grouped['medianMs'],2)
    candidates=[c['model'] for c in grouped['candidates']]
    chosen=max((m for m in candidates if m.get('originalLayout') and not m.get('cell') and not m.get('rotation') and m.get('fontKey')),key=lambda m:len(m['text']))
    record['objects']=len(inspect['objects']);record['paragraphs']=len(candidates);record['characters']=len(chosen['text'])
    # Replace one existing character by another from its own subset. This
    # exercises layout and ownership without depending on system fallback fonts.
    edited=copy.deepcopy(chosen)
    chars=[(i,ch) for i,ch in enumerate(edited['text']) if '\u4e00'<=ch<='\u9fff']
    if len({ch for _,ch in chars})<2:
        chars=[(i,ch) for i,ch in enumerate(edited['text']) if ch.isalpha()]
    at,old=chars[0];replacement=next(ch for _,ch in chars if ch!=old)
    edited['text']=edited['text'][:at]+replacement+edited['text'][at+1:]
    (OUT/(name+'-model.json')).write_text(json.dumps(edited,ensure_ascii=False,indent=2),encoding='utf8')
    blank=timed('blankLayoutMs',lambda:layout(dict(text='',pageWidth=chosen['pageWidth'],pageHeight=chosen['pageHeight'],frame=dict(x=0,y=0,width=chosen['pageWidth'],height=chosen['pageHeight']),size=12,lineHeight=1.4,align='left',color='#202020')),timings)
    background=dict(command='flow-background',bytes=encoded,page=page,edits=[dict(type='flow',page=page,sources=chosen['sources'],model={**chosen,'text':'','runs':[],'softBreaks':[]},fragment=blank['fragment'])])
    timed('backgroundFirstMs',lambda:worker.run(background),timings)
    timed('backgroundWarmMs',lambda:worker.run(background),timings)
    profile(name+'-background',lambda:worker.run(background))
    result=timed('editedLayoutMs',lambda:layout(edited),timings)
    assert result['mappingComplete'] and not result['overflow'],(name,result.get('mappingReason'))
    originals={g['start']:g for g in chosen['originalLayout']['glyphs'] if g['text']!='\n'}
    retained=sum(abs(g['originX']-originals[g['start']]['originX'])<.001 and abs(g['baseline']-originals[g['start']]['baseline'])<.001 for g in result['glyphs'] if g['start'] in originals)
    record['layoutMode']=result.get('layoutMode');record['retainedOrigins']=retained;record['originalOrigins']=len(originals)
    assert retained==len(originals),(name,retained,len(originals),result.get('layoutMode'))
    output=timed('saveMs',lambda:save(raw,edited,n=page,result=result),timings)
    (OUT/(name+'-edited.pdf')).write_bytes(output)
    # The earlier page is physically unrelated. Test both exact pixels and
    # source text after full-document save/reopen, not only the preview model.
    assert pixels(raw,page-2)==pixels(output,page-2)
    reopened=timed('reopenedModelsMs',lambda:models(output,page)[1],timings)
    assert any(m['text']==edited['text'] for m in reopened),(name,'reopened paragraph')
    record['checks']=['warm inspection identical','all original glyph origins retained','save into original multipage PDF','adjacent page pixels unchanged','reopened exact paragraph text']
    report.append(record)
    print(json.dumps(record,ensure_ascii=False),flush=True)
(OUT/'report.json').write_text(json.dumps(dict(status='passed',results=report),ensure_ascii=False,indent=2),encoding='utf8')

"""Independent-process before/after benchmark of identical candidate scoring."""
import json,sys,time,subprocess
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor')]
sys.stdout.reconfigure(encoding='utf8')
import font_similarity as sim
from fontTools.ttLib import TTFont
OUT=ROOT/'tests/output/deep-edit-v191-fonts'
CASES=[('2c5b054ce5a81cccbd6ed7010fcdb156','段'),('da368bfa06e1926d6744d8843932454b','补')]

def run():
    result=[]
    for key,character in CASES:
        start=time.perf_counter();matches=sim.recommend(key,character)
        result.append({'fontKey':key,'missing':character,'ms':round((time.perf_counter()-start)*1000,2),'matches':matches})
        if not matches:raise RuntimeError('Run font-deep-v191.py to populate the textbook font fixtures first')
    return result

if '--before' in sys.argv:
    with patch.object(sim,'outline_font',side_effect=lambda path,face,sampled=False:TTFont(path,fontNumber=face,lazy=True)):print(json.dumps(run(),ensure_ascii=False))
elif '--after' in sys.argv:print(json.dumps(run(),ensure_ascii=False))
else:
    before=json.loads(subprocess.check_output([sys.executable,__file__,'--before']))
    after=json.loads(subprocess.check_output([sys.executable,__file__,'--after']))
    for old,new in zip(before,after):assert old['matches']==new['matches'],'Recommendation quality changed'
    report={'scope':'Fresh processes; first recommendation includes catalog and coverage indexing; second uses the same process with another source subset. Every score, candidate order, evidence count and confidence must match.','before':before,'after':after}
    (OUT/'font-performance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps([{'beforeMs':a['ms'],'afterMs':b['ms'],'speedup':round(a['ms']/b['ms'],2)} for a,b in zip(before,after)],ensure_ascii=False))

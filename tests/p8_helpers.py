from pathlib import Path
import sys,io,json,base64,subprocess
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz,worker
from story import layout
OUT=ROOT/'tests/output';OUT.mkdir(exist_ok=True,parents=True)
def inspect(raw,n=1):return worker.run({'command':'inspect','bytes':base64.b64encode(raw).decode(),'page':n})
def models(raw,n=1):
 r=inspect(raw,n)
 code="import{pageCandidates}from './src/flow-page-model.mjs';let s='';for await(const c of process.stdin)s+=c;const r=JSON.parse(s);console.log(JSON.stringify(pageCandidates(r.objects,...r.size,[],r.tables).map(c=>c.model)));"
 return r,json.loads(subprocess.check_output(['node','--input-type=module','-e',code],input=json.dumps(r).encode(),cwd=ROOT))
def save(raw,m,n=1,result=None):
 result=result or layout(m);assert result['mappingComplete'], {'text':m['text'],'mappingReason':result.get('mappingReason'),'warnings':result.get('warnings'),'font':m.get('fontName'),'sources':m.get('sources')}
 out=worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),'edits':[{'page':n,'type':'flow','sources':m.get('sources',[]),'model':m,'fragment':result['fragment']}]})
 return base64.b64decode(out['bytes'])
def pixels(raw,n=0,clip=None):
 with fitz.open(stream=raw,filetype='pdf') as d:return d[n].get_pixmap(matrix=fitz.Matrix(1.5,1.5),clip=clip).samples
def dump(w):
 b=io.BytesIO();w.write(b);return b.getvalue()

"""Exercise real service under Python -I, including missing optional telemetry."""
from pathlib import Path
import json,subprocess,sys,tempfile,os
root=Path(__file__).resolve().parents[1]
python=os.environ.get('FOLIO_PYTHON',sys.executable)
fixture=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root/'tests/output/v4-scan.pdf'
worker=root/'native/worker.py'
with tempfile.TemporaryDirectory() as cwd:
 output=Path(cwd)/'searchable.pdf'
 block={'page':4,'text':'隔离环境验证','confidence':1,'quad':[[40,700],[200,700],[200,680],[40,680]]}
 commands=[{'command':'ocr','input':str(fixture),'page':4,'skipText':False,'threads':2},{'command':'inspect','input':str(fixture),'page':4},{'command':'apply','input':str(fixture),'output':str(output),'ocr':[block]}]
 p=subprocess.run([python,'-I',str(worker)],input='\n'.join(json.dumps(x) for x in commands)+'\n',text=True,capture_output=True,cwd=cwd,timeout=120)
 assert p.returncode==0,p.stderr
 replies=[json.loads(line) for line in p.stdout.splitlines()];assert len(replies)==3,p.stdout
 assert all('result'in r for r in replies),replies
 assert len(replies[0]['result']['blocks'])>0
 assert output.stat().st_size>0
 from pypdf import PdfReader
 assert '隔离环境验证' in PdfReader(output).pages[3].extract_text()
 args=json.dumps(commands[0])
 code='import sys,runpy,json;sys.modules["memory"]=None;ns=runpy.run_path('+repr(str(worker))+');r=ns["run"](json.loads('+repr(args)+'));print(json.dumps({"count":len(r["blocks"]),"rss":r["rss"]}))'
 q=subprocess.run([python,'-I','-c',code],text=True,capture_output=True,cwd=cwd,timeout=120)
 assert q.returncode==0,q.stderr
 degraded=json.loads(q.stdout);assert degraded['count']>0 and degraded['rss']==0,degraded
 report={'isolated_ocr_blocks':len(replies[0]['result']['blocks']),'isolated_inspect':'passed','isolated_apply_and_search':'passed','missing_memory_module':degraded,'environment':'Linux Python -I with unrelated CWD; reproduces excluded-script-path condition, not actual Windows launch'}
 (root/'tests/output/v5.1-isolated-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))

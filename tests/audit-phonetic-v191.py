"""Retrospective independent phonetic-attachment audit of saved benchmark PDFs."""
from pathlib import Path
import argparse,base64,json,subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--run',required=True);p.add_argument('--code-root',type=Path,default=ROOT);args=p.parse_args()
CODE=args.code_root.resolve();RUN=ROOT/'tests/output/deep-edit-v191'/args.run
sys.path[:0]=[str(CODE/'native'),str(CODE/'native/vendor'),str(ROOT/'tests')]
sys.stdout.reconfigure(encoding='utf8')
import worker
from annotation_checks_v191 import phonetic_audit
r=json.loads((RUN/'report.json').read_text(encoding='utf8'));audit=dict(run=args.run,cases=[])
def inspect(raw,page):return worker.run(dict(command='inspect',bytes=base64.b64encode(raw).decode(),page=page))
def models(data):
 return json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{pageCandidates}from'./src/flow-page-model.mjs';let s='';for await(const c of process.stdin)s+=c;let v=JSON.parse(s);console.log(JSON.stringify(pageCandidates(v.objects,...v.size,[],v.tables).map(c=>c.model)));"],input=json.dumps(data).encode(),cwd=CODE))
ids=lambda m:sorted(s['index']for s in m['sources'])
for page in r['pages']:
 if not page['id'].startswith('textbook'):continue
 before=(RUN/'textbook-original.pdf').read_bytes();data=inspect(before,page['page']);originals=json.loads((RUN/(page['id']+'-models.json')).read_text(encoding='utf8'))
 for batch in page.get('batches',[]):
  if 'verification'not in batch:continue
  after_path=RUN/(page['id']+'-batch'+batch['id']+'-after.pdf')
  if not after_path.exists():continue
  again=inspect(after_path.read_bytes(),page['page']);reopened=models(again)
  for item in json.loads((RUN/(page['id']+'-batch'+batch['id']+'-applied-models.json')).read_text(encoding='utf8')):
   attempt=next(a for a in page['attempts']if a['operation']==item['operation']);m=item['model'];old=next(x for x in originals if ids(x)==ids(m));new=next((x for x in reopened if x['text']==m['text']),None)
   if new is None:continue
   check=phonetic_audit(old,m,new,data['objects'],again['objects'],attempt['change']);case=dict(id=page['id'],batch=batch['id'],operation=item['operation'],previousStatus=attempt['status'],**check);audit['cases'].append(case)
   if check['annotationsChecked']:print(json.dumps(case,ensure_ascii=False),flush=True)
audit['lostAssociations']=sum(x['lostAssociations']for x in audit['cases']);audit['affectedOperations']=sum(bool(x['lostAssociations'])for x in audit['cases']);audit['annotationsChecked']=sum(x['annotationsChecked']for x in audit['cases'])
(RUN/'phonetic-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({k:v for k,v in audit.items()if k!='cases'},ensure_ascii=False))

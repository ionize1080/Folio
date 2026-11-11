from pathlib import Path
import hashlib,json,os,zipfile
root=Path(__file__).resolve().parents[1];out=root/'tests/output';sha=os.environ['GITHUB_SHA'];run=os.environ['GITHUB_RUN_ID']
file=root/'deliverables/Folio-PDF-Studio-2.7.0-portable-win-x64.zip'
with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
checks=[]
for i in range(1,5):
    r=json.loads((out/f'packaged-{i}-270.json').read_text(encoding='utf-8'))
    assert r['status']=='passed' and r['shard']==i and r['sourceCommit']==sha and r['runId']==run and r['packageSha256']==digest
    checks.extend(r['checks'])
assert len(checks)==len({c['task'] for c in checks})==25 and all(c['status']=='passed' for c in checks)
(out/'ci-packaged-report.json').write_text(json.dumps(dict(status='passed',checks=checks,sourceCommit=sha,runId=run,packageSha256=digest,parallelJobs=4)),encoding='utf-8')
with zipfile.ZipFile(file) as z:
    info=z.read('Folio-PDF-Studio/BUILD-INFO.json')
dest=root/'dist/Folio-PDF-Studio-win-x64';dest.mkdir(parents=True,exist_ok=True);(dest/'BUILD-INFO.json').write_bytes(info)

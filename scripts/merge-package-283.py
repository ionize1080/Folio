from pathlib import Path
import hashlib,json,os,subprocess,zipfile
root=Path(__file__).resolve().parents[1];out=root/'tests/output';sha=os.environ['GITHUB_SHA'];run=os.environ['GITHUB_RUN_ID']
version=json.loads((root/'package.json').read_text())['version']
file=root/f'deliverables/Folio-PDF-Studio-{version}-portable-win-x64.zip'
with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
checks=[]
groups = json.loads(subprocess.check_output(
    ['node', '-p', "JSON.stringify(require('./scripts/package-shard-283.cjs').groups)"],
    cwd=root, text=True))
assert len(groups) == 6, 'Expected six package test reports'
for i, group in enumerate(groups, 1):
    r=json.loads((out/f'packaged-{i}-283.json').read_text(encoding='utf-8'))
    assert r['status']=='passed' and r['shard']==i and r['sourceCommit']==sha and r['runId']==run and r['packageSha256']==digest
    assert [c['task'] for c in r['checks']] == ['tests/' + task for task in group], f'Unexpected tests in package shard {i}'
    checks.extend(r['checks'])
assert len(checks)==len({c['task'] for c in checks}) and all(c['status']=='passed' for c in checks)
(out/'ci-packaged-report.json').write_text(json.dumps(dict(status='passed',checks=checks,sourceCommit=sha,runId=run,packageSha256=digest,parallelJobs=6)),encoding='utf-8')
with zipfile.ZipFile(file) as z:
    info=z.read('Folio-PDF-Studio/BUILD-INFO.json')
dest=root/'dist/Folio-PDF-Studio-win-x64';dest.mkdir(parents=True,exist_ok=True);(dest/'BUILD-INFO.json').write_bytes(info)

"""Real Win32 updater rejection and rollback with isolated executable fixtures."""
import hashlib, json, os, subprocess, sys, tempfile, zipfile
from pathlib import Path
import shutil
root=Path(__file__).resolve().parents[1]
checks=[]
with tempfile.TemporaryDirectory(prefix="Folio 更新 ' ") as tmp:
    base=Path(tmp)
    for case in ['checksum','traversal','no-commit','wrong-commit','rollback']:
        target=base/case;target.mkdir()
        shutil.copyfile(Path(os.environ['SystemRoot'])/'System32/whoami.exe',target/'Folio.exe')
        (target/'retained.txt').write_text('original')
        archive=base/(case+'.zip')
        exe=(target/'Folio.exe').read_bytes()
        sha=lambda b:hashlib.sha256(b).hexdigest()
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            if case=='traversal':z.writestr('Folio-PDF-Studio/../../escaped','bad')
            else:
                z.writestr('Folio-PDF-Studio/Folio.exe',exe)
                z.writestr('Folio-PDF-Studio/resources/app.asar',b'new')
                z.writestr('Folio-PDF-Studio/BUILD-INFO.json',json.dumps(dict(version='2.0.1',exe_sha256=sha(exe),asar_sha256=sha(b'new'))))
        parent=subprocess.Popen([sys.executable,'-c','import time;time.sleep(2)'])
        manifest=base/(case+'.json');status=str(manifest)+'.status';commit=str(manifest)+'.commit'
        m=dict(file=str(archive),hash='0'*64 if case=='checksum' else sha(archive.read_bytes()),version='v2.0.1',target=str(target),pid=parent.pid,statusFile=status,commitFile=commit,healthFile=str(manifest)+'.health',token='expected')
        if case!='no-commit':Path(commit).write_text(json.dumps(dict(token='wrong' if case=='wrong-commit' else 'expected')))
        manifest.write_text(json.dumps(m),encoding='utf-8')
        result=subprocess.run([str(root/'native/runtime/python.exe'),str(root/'portable-update.py'),str(manifest)],capture_output=True,timeout=20)
        parent.wait()
        report=json.loads(Path(status).read_text())
        assert report['phase']=='failed',report
        assert (target/'retained.txt').read_text()=='original'
        assert not (base/'escaped').exists()
        assert not (target/'resources').exists()
        checks.append(case)
Path('tests/output/update-python-201.json').write_text(json.dumps(dict(checks=checks,errors=[])))
print('PASS',checks)

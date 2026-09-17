"""Assemble pinned Windows wheels and official VC runtime into the portable sidecar."""
from pathlib import Path
import zipfile,hashlib,json,shutil,os
root=Path(__file__).resolve().parents[1];cache=Path(os.environ.get('FOLIO_NATIVE_CACHE',root.parent/'tool-cache'));native=root/'native';runtime=native/'runtime';runtime.mkdir(exist_ok=True)
lockpath=native/'runtime-lock.json';expected=json.loads(lockpath.read_text()) if lockpath.exists() else None
if expected and hashlib.sha256((cache/'python-win.zip').read_bytes()).hexdigest()!=expected['python']['sha256']:raise RuntimeError('Python checksum mismatch')
with zipfile.ZipFile(cache/'python-win.zip') as z:assert z.testzip() is None;z.extractall(runtime)
site=runtime/'Lib/site-packages';site.mkdir(exist_ok=True,parents=True);wheels=[]
inputs=[cache/'win-wheels'/x['name'] for x in expected['wheels']] if expected else sorted((cache/'win-wheels').glob('*.whl'))
for p in inputs:
 if expected and hashlib.sha256(p.read_bytes()).hexdigest()!=next(x['sha256'] for x in expected['wheels'] if x['name']==p.name):raise RuntimeError('Wheel checksum mismatch: '+p.name)
 with zipfile.ZipFile(p) as z:assert z.testzip() is None;z.extractall(site)
 wheels.append({'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(runtime/'python312._pth').write_text('python312.zip\n.\nLib/site-packages\nimport site\n')
for p in (native/'vcredist').iterdir():shutil.copyfile(p,runtime/p.name)
licenses=native/'licenses';licenses.mkdir(exist_ok=True)
for d in site.glob('*.dist-info'):
 for p in d.rglob('*'):
  if p.is_file() and any(k in p.name.lower() for k in ['license','notice','copying']):
   target=licenses/d.name/p.relative_to(d);target.parent.mkdir(exist_ok=True,parents=True);shutil.copyfile(p,target)
for name in ['LICENSE','ThirdPartyNotices.txt']:
 p=site/'onnxruntime'/name
 if p.exists():shutil.copyfile(p,licenses/('ONNX-'+name))
shutil.copyfile(runtime/'LICENSE.txt',licenses/'PYTHON-LICENSE.txt')
lock={'python':{'version':'3.12.10','sha256':hashlib.sha256((cache/'python-win.zip').read_bytes()).hexdigest(),'url':'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'},'wheels':wheels,'vcredist':[{'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted((native/'vcredist').iterdir())]};(native/'runtime-lock.json').write_text(json.dumps(lock,indent=2));print('Windows native runtime staged:',len(wheels),'wheels')

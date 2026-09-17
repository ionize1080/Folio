"""Fetch locked Windows build inputs. Models, font and VC DLLs ship with the source."""
from pathlib import Path
import os,json,urllib.request,hashlib,shutil
root=Path(__file__).resolve().parents[1];cache=Path(os.environ.get('FOLIO_NATIVE_CACHE',root.parent/'tool-cache'));lock=json.loads((root/'native/runtime-lock.json').read_text());cache.mkdir(exist_ok=True,parents=True);(cache/'win-wheels').mkdir(exist_ok=True)
def fetch(url,p,sha):
 if p.exists() and hashlib.sha256(p.read_bytes()).hexdigest()==sha:return
 with urllib.request.urlopen(url,timeout=180) as r:data=r.read()
 if hashlib.sha256(data).hexdigest()!=sha:raise RuntimeError('Checksum mismatch: '+p.name)
 p.write_bytes(data);print(p.name,flush=True)
fetch(lock['python']['url'],cache/'python-win.zip',lock['python']['sha256'])
for item in lock['wheels']:
 p=cache/'win-wheels'/item['name'];bundled=root/'native/build-wheels'/item['name']
 if bundled.exists():shutil.copyfile(bundled,p)
 if p.exists() and hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256']:continue
 name,version=item['name'].split('-')[:2]
 with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json',timeout=60) as r:d=json.load(r)
 url=next(v['url'] for v in d['urls'] if v['filename']==item['name']);fetch(url,p,item['sha256'])
print('All native build inputs verified')

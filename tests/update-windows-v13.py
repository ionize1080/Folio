"""Exercise the actual PowerShell swap helper with real PE fixtures in isolated folders."""
from pathlib import Path
import os,sys,tempfile,subprocess,json,zipfile,hashlib,shutil,time
assert sys.platform=='win32'
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parents[1];checks=[]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix="Folio 更新 ' test ",ignore_cleanup_errors=True) as td:
 base=Path(td);target=base/'Folio fixed directory';target.mkdir();shutil.copyfile(Path(os.environ['SystemRoot'])/'System32/whoami.exe',target/'Folio.exe');(target/'user-notes.txt').write_text('old local file');
 stage=base/'payload/Folio-PDF-Studio';(stage/'resources').mkdir(parents=True);shutil.copyfile(target/'Folio.exe',stage/'Folio.exe');(stage/'resources/app.asar').write_bytes(b'new tested app');(stage/'BUILD-INFO.json').write_text(json.dumps({'version':'1.3.0','exe_sha256':digest(stage/'Folio.exe'),'asar_sha256':digest(stage/'resources/app.asar')}))
 archive=base/'new.zip'
 with zipfile.ZipFile(archive,'w') as z:
  for f in stage.rglob('*'):
   if f.is_file():z.write(f,f.relative_to(stage.parent))
 def run(file,hash,**extra):
  manifest=base/'install.json';manifest.write_text(json.dumps({'file':str(file),'hash':hash,'version':'v1.3.0','target':str(target),'pid':2147483646,**extra}),encoding='utf-8');subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(root/'portable-update.ps1'),'-Manifest',str(manifest)],check=True,timeout=45);time.sleep(1);log=(base/"install.log").read_text(encoding="utf-8-sig",errors="replace");print(log,flush=True);Path("tests/output").mkdir(exist_ok=True);Path("tests/output/v13-updater-last.log").write_text(log,encoding="utf-8")
 run(archive,digest(archive));assert (target/'resources/app.asar').read_bytes()==b'new tested app';backups=list(base.glob('Folio fixed directory.backup-*'));assert len(backups)==1 and (backups[0]/'user-notes.txt').read_text()=='old local file';checks.append('Actual Windows same-directory replacement with Unicode/spaces/apostrophe paths; old folder/user files retained in backup')
 run(archive,'0'*64);assert (target/'resources/app.asar').read_bytes()==b'new tested app';assert 'checksum mismatch' in (base/'install.log').read_text();checks.append('Tampered download rejected before changing installation')
 bad=base/'traversal.zip'
 with zipfile.ZipFile(bad,'w') as z:z.writestr('Folio-PDF-Studio/../../escaped.txt','BAD')
 run(bad,digest(bad));assert not (base/'escaped.txt').exists();assert (target/'resources/app.asar').read_bytes()==b'new tested app';checks.append('Archive traversal rejected before extraction; current program preserved')
 run(archive,digest(archive),healthFile=str(base/'never-ready.json'),headless=True);assert (target/'resources/app.asar').read_bytes()==b'new tested app';assert 'new Folio window did not become ready' in (base/'install.log').read_text();checks.append('New executable exits without a healthy renderer: actual directory rollback restores previous installation')
Path('tests/output/v13-updater-report.json').write_text(json.dumps({'platform':sys.platform,'checks':checks,'errors':[]},indent=2));print(json.dumps(checks))

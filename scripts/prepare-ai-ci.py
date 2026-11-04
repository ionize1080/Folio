"""Download and verify official Chatbox, then reproduce the AI runtime on Windows."""
from pathlib import Path
import hashlib, os, shutil, subprocess, sys, urllib.request
root=Path(__file__).resolve().parents[1]
work=root/'.ai-runtime';work.mkdir(exist_ok=True)
installer=work/'Chatbox-1.20.3-Setup.exe'
url='https://github.com/chatboxai/chatbox/releases/download/v1.20.3/Chatbox-1.20.3-Setup.exe'
if not installer.exists():urllib.request.urlretrieve(url,installer)
assert hashlib.sha256(installer.read_bytes()).hexdigest()=='874171c6c7358ff3915f01412eb036154a5ded7a76c4663fb0f592d2c5c23b13'
seven=shutil.which('7z') or str(Path(os.environ['ProgramFiles'])/'7-Zip/7z.exe')
unpack=work/'installer'
subprocess.run([seven,'x','-y','-o'+str(unpack),str(installer)],check=True)
for i,archive in enumerate(list(unpack.rglob('*.7z'))):
    if 'arm64' not in archive.name.lower():
        subprocess.run([seven,'x','-y','-o'+str(unpack/('payload-'+str(i))),str(archive)],check=True)
matches=[p for p in unpack.rglob('app.asar') if hashlib.sha256(p.read_bytes()).hexdigest()=='e43647af8168b731caa9afaed269a4700f8686c257fbc4dd6a254da42729fa01']
assert len(matches)==1,'Expected exactly one verified Chatbox app.asar'
subprocess.run([sys.executable,str(root/'scripts/prepare-ai.py'),'--chatbox',str(matches[0].parent.parent),'--sevenzip',seven],cwd=root,check=True)

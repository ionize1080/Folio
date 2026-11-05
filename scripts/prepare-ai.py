"""Reproduce the portable PDF MCP runtime from pinned sources and dependencies.
Run after git submodule update --init and native runtime preparation. Downloads
are build-time only; the packaged server never downloads models or opens ports.
"""
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, sys, urllib.request

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'.ai-runtime'
UPSTREAM=ROOT/'integrations/pdf-mcp-upstream'
PIN='9d66cca073f664a8c97d4984b5d9d61d68d4ba30'
TESS='https://github.com/tesseract-ocr/tesseract/releases/download/5.5.3/tesseract-ocr-w64-setup-5.5.3.20260724.exe'
TESS_SHA='bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4'
DATA_PIN='87416418657359cb625c412a48b6e1d6d41c29bd'

def run(*args): subprocess.run([str(x) for x in args],cwd=ROOT,check=True)
def sha(file): return hashlib.sha256(file.read_bytes()).hexdigest()
def download(url,file,expected=None):
    if not file.exists(): urllib.request.urlretrieve(url,file)
    if expected and sha(file)!=expected: raise ValueError('Checksum mismatch: '+file.name)

parser=argparse.ArgumentParser()
parser.add_argument('--chatbox',required=True,help='Extracted official Chatbox 1.20.3 installer folder (app.asar verified)')
parser.add_argument('--sevenzip',default=str(WORK/'7zip/7z.exe'))
args=parser.parse_args()
if subprocess.check_output(['git','rev-parse','HEAD'],cwd=UPSTREAM,text=True).strip()!=PIN: raise ValueError('PDF MCP revision mismatch')
run(sys.executable, ROOT/'scripts/patch-pdf-mcp.py')
WORK.mkdir(exist_ok=True)
chatbox_source=WORK/'chatbox-source'
if not chatbox_source.exists(): run('git','clone','--depth','1','--branch','v1.20.3','https://github.com/chatboxai/chatbox.git',chatbox_source)
if subprocess.check_output(['git','rev-parse','HEAD'],cwd=chatbox_source,text=True).strip()!='d3cd0ad1e6a1127bbbf3991bb5296c181f4cbdeb': raise ValueError('Chatbox source revision mismatch')
venv=ROOT/'.venv-ai'
if not venv.exists(): run(sys.executable,'-m','venv',venv)
python=venv/'Scripts/python.exe'
run(python,'-m','pip','install','-r',ROOT/'integrations/pdf-mcp-requirements.lock.txt')
run(python,'-m','pip','install','--no-deps',UPSTREAM)
runtime=WORK/'pdf-runtime';runtime.mkdir(exist_ok=True)
for file in (ROOT/'native/runtime').iterdir():
    if file.is_file(): shutil.copy2(file,runtime/file.name)
target=runtime/'Lib/site-packages'
shutil.copytree(venv/'Lib/site-packages',target,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','__editable__*'))
for name in ['pdf-server.py','pdf_objects.py']: shutil.copy2(ROOT/'integrations'/name,runtime/name)
download(TESS,WORK/'tesseract-setup.exe',TESS_SHA)
run(args.sevenzip,'x','-y','-o'+str(WORK/'tesseract'),WORK/'tesseract-setup.exe')
for lang in ['eng','chi_sim','chi_tra','osd']:
    file=WORK/'tesseract/tessdata'/f'{lang}.traineddata'
    download(f'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{DATA_PIN}/{lang}.traineddata',file)
shutil.copytree(WORK/'tesseract',runtime/'tesseract',dirs_exist_ok=True,ignore=shutil.ignore_patterns('$PLUGINSDIR','Uninstall*'))
licenses=runtime/'licenses/pdf-mcp';licenses.mkdir(parents=True,exist_ok=True)
for name in ['LICENSE','NOTICE','pyproject.toml']: shutil.copy2(UPSTREAM/name,licenses/name)
run('npm.cmd','ci','--prefix',ROOT/'integrations/chatbox','--ignore-scripts')
run('node',ROOT/'scripts/prepare-chatbox.cjs',args.chatbox)
run('git','-C',chatbox_source,'archive','--format=zip','--output='+str(WORK/'Chatbox/Chatbox-1.20.3-source.zip'),'HEAD')
shutil.copytree(ROOT/'integrations/chatbox/node_modules',WORK/'Chatbox/node_modules',dirs_exist_ok=True)
(runtime/'provenance.json').write_text(json.dumps({'pdfMcpCommit':PIN,'folioPatchSha256':sha(ROOT/'integrations/pdf-mcp-folio.patch'),'tesseractInstallerSha256':TESS_SHA,'tessdataCommit':DATA_PIN,'models':{p.name:sha(p) for p in (runtime/'tesseract/tessdata').glob('*.traineddata')}},indent=2))
print(runtime)

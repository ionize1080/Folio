"""Publish only the source and binaries validated by this exact workflow run."""
from pathlib import Path
import json,zipfile,hashlib,shutil,subprocess,os
root=Path('downloaded');out=Path('release-p7');out.mkdir(exist_ok=True)
prefix='Folio-PDF-Studio-1.2.0-RC1-P7';reports={}
for key,file in {'p7Editor':'p7-electron-report.json','p6Editor':'p6-electron-report.json','p5Editor':'p5-electron-report.json','narrowTable':'p4-electron-report.json','existingFeatures':'v12-electron-report.json','p7Native':'p7-native-report.json','p6Native':'p6-native-report.json','publicCorpus':'p6-corpus-report.json'}.items():
 report=json.loads((root/'folio-p7-windows-validation'/file).read_text(encoding='utf-8'));assert not report['errors'],key;reports[key]=report
packaged=['p7Editor','p6Editor','p5Editor','narrowTable','existingFeatures']
for key in packaged:assert reports[key]['platform']=='win32'
assert len(reports['p7Native']['checks'])>=10
assert reports['publicCorpus']['pages']==50 and len(reports['publicCorpus']['documents'])==10
portable=root/'folio-p7-portable'/f'{prefix}-win-x64.zip';source=root/'folio-p7-source'/f'{prefix}-source.zip'
with zipfile.ZipFile(portable) as z:
 assert z.testzip() is None
 for file,field in [('Folio-PDF-Studio/Folio.exe','exe_sha256'),('Folio-PDF-Studio/resources/app.asar','asar_sha256')]:
  with z.open(file) as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
  assert all(reports[key][field]==digest for key in packaged),field
with zipfile.ZipFile(source) as z:
 assert z.testzip() is None
 package=json.loads(z.read('Folio-PDF-Studio-source/package.json'));assert package['releaseChannel']=='rc1-p7'
 assert 'Folio-PDF-Studio-source/native/form_compat.py' in z.namelist()
 assert 'Folio-PDF-Studio-source/docs/RC1-P7-editor-audit.md' in z.namelist()
 assert not any('/tests/output/' in n or '/.venv/' in n for n in z.namelist())
shutil.copyfile(portable,out/f'{prefix}-portable-win-x64.zip');shutil.copyfile(source,out/source.name)
run=os.environ['GITHUB_RUN_ID'];sha=os.environ['GITHUB_SHA'];url=f'https://github.com/ionize1080/Folio/actions/runs/{run}'
(out/f'{prefix}-validation.json').write_text(json.dumps({'sourceCommit':sha,'windowsRun':url,**reports},ensure_ascii=False,indent=2),encoding='utf-8')
lines=[]
for file in sorted(out.iterdir()):
 with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
 lines.append(digest+'  '+file.name)
(out/f'{prefix}-SHA256.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
notes=Path('docs/RELEASE-P7.md').read_text(encoding='utf-8')+f'\n\n已验证源码：`{sha}`\nWindows 完整验收：{url}\n'
Path('p7-release-notes.md').write_text(notes,encoding='utf-8')
# Draft protects users from a partially uploaded set of attachments. Never overwrite a prior release.
subprocess.run(['gh','release','create','v1.2.0-rc1-p7',*[str(p) for p in sorted(out.iterdir())],'--target',sha,'--title','Folio PDF Studio 1.2.0 RC1-P7','--notes-file','p7-release-notes.md','--draft','--prerelease'],check=True)
subprocess.run(['gh','release','edit','v1.2.0-rc1-p7','--draft=false','--prerelease'],check=True)
print(json.dumps({'release':'https://github.com/ionize1080/Folio/releases/tag/v1.2.0-rc1-p7','sourceCommit':sha,'windowsRun':url}))

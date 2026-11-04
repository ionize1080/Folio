"""Publish the exact artifacts produced and accepted by this Windows Actions job."""
from pathlib import Path
import hashlib, json, os, subprocess, zipfile
from release_transport import gh, publish
root=Path(__file__).resolve().parents[1];out=root/'deliverables'
repo=os.environ['GITHUB_REPOSITORY'];sha=os.environ['GITHUB_SHA'];tag='v2.0.1';prefix='Folio-PDF-Studio-2.0.1'
assert json.loads((root/'package.json').read_text())['version']=='2.0.1'
reports={}
for name in ['sidebar-201.json','update-python-201.json','packaged-ai.json','v201-updater-report.json','v162-health-report.json','remote-qwen.json']:
    reports[name]=json.loads((root/'tests/output'/name).read_text(encoding='utf-8'))
    assert not reports[name].get('errors'),name
assert reports['remote-qwen.json']['status'] in ('passed','skipped-unreachable')
info=json.loads((root/'dist/Folio-PDF-Studio-win-x64/BUILD-INFO.json').read_text())
portable=out/(prefix+'-portable-win-x64.zip');source=out/(prefix+'-source.zip')
with zipfile.ZipFile(portable) as z:
    for name,key in [('Folio.exe','exe_sha256'),('resources/app.asar','asar_sha256')]:
        assert hashlib.sha256(z.read('Folio-PDF-Studio/'+name)).hexdigest()==info[key]
        assert reports['v201-updater-report.json'][key]==info[key]
    for name in ['bootstrap.cjs','dock.py','network.cjs']:
        assert z.read('Folio-PDF-Studio/resources/Chatbox/'+name)==(root/'integrations/chatbox'/name).read_bytes()
with zipfile.ZipFile(source) as z:
    for name in ['ai-dock.cjs','update-manager.cjs','portable-update.py','integrations/chatbox/dock.py']:
        assert z.read('Folio-PDF-Studio-source/'+name)==(root/name).read_bytes()
run=f'https://github.com/{repo}/actions/runs/{os.environ["GITHUB_RUN_ID"]}'
validation=out/(prefix+'-validation.json')
validation.write_text(json.dumps(dict(sourceCommit=sha,windowsActionsRun=run,package=info,reports=reports,
    localNativeComputerUse='Mouse, mixed text, Backspace, Sogou n/i/Space and packaged typing verified locally at application source 6075f6d; this run rebuilds unchanged application code.',
    targetWin10_21H1Tested=False),indent=2),encoding='utf-8')
assets=[portable,source,validation]
checksums=out/(prefix+'-SHA256.txt')
lines=[]
for file in assets:
    with file.open('rb') as stream:lines.append(hashlib.file_digest(stream,'sha256').hexdigest()+'  '+file.name+'\n')
checksums.write_text(''.join(lines),encoding='utf-8');assets.append(checksums)
notes=[]
for lang,suffix in [('en',''),('zh-Hans','.zh-Hans'),('zh-Hant','.zh-Hant')]:
    notes.append(f'<!-- folio-locale:{lang} -->\n'+(root/f'docs/RELEASE-2.0.1{suffix}.md').read_text(encoding='utf-8')+'\n<!-- /folio-locale -->')
notes.append(f'Source: `{sha}`. Built, tested and published by [Windows Actions]({run}). Remote Qwen: **{reports["remote-qwen.json"]["status"]}**. An unreachable remote provider is explicitly non-blocking by user instruction; local live API acceptance passed separately.')
notes_file=out/'release-notes.md';notes_file.write_text('\n\n'.join(notes),encoding='utf-8')
# This release is still our unpublished staging draft. Replace local staged
# artifacts only after every remote acceptance step above has completed.
releases=json.loads(gh('api',f'repos/{repo}/releases?per_page=100'))
draft=next((r for r in releases if r['tag_name']==tag),None)
if draft:
    assert draft['draft'],'Never replace a published release'
    for asset in json.loads(gh('api',f'repos/{repo}/releases/{draft["id"]}/assets')):
        assert asset['name'].startswith(prefix+'-'),'Unexpected draft asset'
        gh('api','--method','DELETE',f'repos/{repo}/releases/assets/{asset["id"]}')
    gh('release','edit',tag,'--repo',repo,'--target',sha,'--notes-file',str(notes_file))
publish(repo,tag,sha,'Folio PDF Studio 2.0.1 — Native sidebar input, no PowerShell',notes_file,assets)
print(f'Published https://github.com/{repo}/releases/tag/{tag}')

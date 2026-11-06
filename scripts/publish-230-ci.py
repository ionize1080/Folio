"""Publish only the exact package accepted by this Windows Actions job."""
from pathlib import Path
import hashlib
import json
import os
import zipfile

from release_transport import gh, publish

root = Path(__file__).resolve().parents[1]
out = root / 'deliverables'
repo, sha = os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_SHA']
tag, prefix = 'v2.3.0', 'Folio-PDF-Studio-2.3.0'
assert json.loads((root / 'package.json').read_text())['version'] == '2.3.0'
reports = {}
for name in ['conversion-native-report.json','conversion-scan-report.json','conversion-public-report.json','conversion-live-report.json','engineering-native-report.json','engineering-ui-report.json','workbench-ui-report.json','context-live-report.json','document-utilities-report.json', 'document-tools-ui.json', 'document-live-report.json', 'chatbox-completion-220.json', 'graphics-220-native.json', 'graphics-220-ui.json', 'graphics-220-live.json', 'ai-workflows-210.json', 'workspace-210.json', 'live-202.json', 'hosted-202.json', 'chrome-202.json', 'ai-settings.json',
             'update-python-201.json', 'packaged-ai.json', 'v201-updater-report.json',
             'v162-health-report.json', 'package-report.json']:
    reports[name] = json.loads((root / 'tests/output' / name).read_text(encoding='utf-8'))
    assert not reports[name].get('errors'), name
for name in ['document-utilities-report.json', 'document-tools-ui.json', 'document-live-report.json', 'chatbox-completion-220.json', 'graphics-220-native.json','graphics-220-ui.json','graphics-220-live.json']: assert reports[name]['status']=='passed'
for name in ['conversion-native-report.json','conversion-scan-report.json','conversion-public-report.json','conversion-live-report.json','engineering-native-report.json','engineering-ui-report.json','workbench-ui-report.json','context-live-report.json']: assert reports[name]['status']=='passed'
assert reports['graphics-220-live.json']['savedPDF']['nativeShadings']>=1
assert reports['graphics-220-live.json']['savedPDF']['images']>=2
assert reports['live-202.json']['status'] == 'passed'
assert reports['live-202.json']['independentStateChecks']
assert len(reports['live-202.json']['checks']) == 12
assert reports['chrome-202.json']['status'] == 'passed'
assert reports['ai-workflows-210.json']['scan']['searchable']
assert reports['ai-workflows-210.json']['color']['neighborPageIdentical']
assert reports['ai-workflows-210.json']['patch']['outsidePixelsIdentical']
assert reports['ai-workflows-210.json']['vector']['vectorForm']
assert reports['ai-workflows-210.json']['generatedBookmarks'] == 4
assert reports['workspace-210.json']['status'] == 'passed'
assert reports['hosted-202.json']['sharedElectron']
assert reports['hosted-202.json']['settingsReloadPersisted']
assert reports['hosted-202.json']['draftSwitches'] >= 21
assert reports['hosted-202.json']['draftImmediateReload']
assert reports['hosted-202.json']['draftCleared']
assert reports['packaged-ai.json']['tools'] == 62
info = json.loads((root / 'dist/Folio-PDF-Studio-win-x64/BUILD-INFO.json').read_text())
portable, source = out / (prefix + '-portable-win-x64.zip'), out / (prefix + '-source.zip')
with zipfile.ZipFile(portable) as z:
    assert not any('/ChatboxRuntime/' in n for n in z.namelist())
    for name, key in [('Folio.exe', 'exe_sha256'), ('resources/app.asar', 'asar_sha256')]:
        assert hashlib.sha256(z.read('Folio-PDF-Studio/' + name)).hexdigest() == info[key]
        assert reports['v201-updater-report.json'][key] == info[key]
    for required in ['resources/native/engines/ghostscript/bin/gswin64c.exe','resources/native/engines/libreoffice/program/soffice.exe','resources/native/font_tools.py','resources/native/pdf_structure.py']:
        assert 'Folio-PDF-Studio/'+required in z.namelist()
    for name in ['profile.cjs', 'tool-schema.cjs', 'result-cache.cjs', 'network.cjs']:
        assert z.read('Folio-PDF-Studio/resources/Chatbox/' + name) == (root / 'integrations/chatbox' / name).read_bytes()
with zipfile.ZipFile(source) as z:
    for name in ['ai-dock.cjs', 'integrations/pdf-mcp-folio.patch', 'scripts/build-chatbox-source.cjs', 'src/chrome.css', 'image-provider.cjs', 'image-config.cjs', 'native/svg_gradients.py']:
        assert z.read('Folio-PDF-Studio-source/' + name) == (root / name).read_bytes()
run = f'https://github.com/{repo}/actions/runs/{os.environ["GITHUB_RUN_ID"]}'
validation = out / (prefix + '-validation.json')
validation.write_text(json.dumps(dict(sourceCommit=sha, windowsActionsRun=run, package=info,
                                     reports=reports, targetWin10_21H1Tested=False),
                                 indent=2), encoding='utf-8')
assets = [portable, source, validation]
checksums = out / (prefix + '-SHA256.txt')
lines = []
for file in assets:
    with file.open('rb') as stream:
        lines.append(hashlib.file_digest(stream, 'sha256').hexdigest() + '  ' + file.name + '\n')
checksums.write_text(''.join(lines), encoding='utf-8')
assets.append(checksums)
notes = []
for lang, suffix in [('en', ''), ('zh-Hans', '.zh-Hans'), ('zh-Hant', '.zh-Hant')]:
    notes.append(f'<!-- folio-locale:{lang} -->\n' + (root / f'docs/RELEASE-2.3.0{suffix}.md').read_text(encoding='utf-8') + '\n<!-- /folio-locale -->')
notes.append(f'Source: `{sha}`. Built, tested and published by [Windows Actions]({run}). Real Qwen acceptance: **passed**, including independent document-state checks.')
notes_file = out / 'release-notes.md'
notes_file.write_text('\n\n'.join(notes), encoding='utf-8')
releases = json.loads(gh('api', f'repos/{repo}/releases?per_page=100'))
draft = next((r for r in releases if r['tag_name'] == tag), None)
if draft:
    assert draft['draft'], 'Never replace a published release'
    for asset in json.loads(gh('api', f'repos/{repo}/releases/{draft["id"]}/assets')):
        assert asset['name'].startswith(prefix + '-'), 'Unexpected draft asset'
        gh('api', '--method', 'DELETE', f'repos/{repo}/releases/assets/{asset["id"]}')
    gh('release', 'edit', tag, '--repo', repo, '--target', sha, '--notes-file', str(notes_file))
publish(repo, tag, sha, 'Folio PDF Studio 2.3.0 — Document conversion, accessibility and live AI workspace', notes_file, assets)
print(f'Published https://github.com/{repo}/releases/tag/{tag}')

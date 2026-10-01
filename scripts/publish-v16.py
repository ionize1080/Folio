"""Publish the exact Windows artifacts after acceptance and visual review."""
from pathlib import Path
import hashlib, json, os, re, shutil, subprocess, zipfile

root = Path('downloaded')
out = Path('release-v16')
out.mkdir(exist_ok=True)
prefix = 'Folio-PDF-Studio-1.6.0'
sha, run = os.environ['FOLIO_SOURCE_COMMIT'], os.environ['FOLIO_RUN_ID']
assert re.fullmatch(r'[a-f0-9]{40}', sha) and run.isdigit()
run_info = json.loads(subprocess.check_output(['gh', 'api', f'repos/ionize1080/Folio/actions/runs/{run}']))
assert run_info['head_sha'] == sha and run_info['conclusion'] == 'success'
reports = {}
required = {
    'v16-ui-report.json': 7, 'v15-ui-report.json': 6,
    'v14-ui-report.json': 6, 'v13-ui-report.json': 3,
    'v12-electron-report.json': 1, 'p7-electron-report.json': 1,
    'v15-native-report.json': 5, 'v14-native-report.json': 5,
    'v13-native-report.json': 5, 'p7-native-report.json': 11,
    'p8-native-report.json': 5, 'yearbook-native-report.json': 7,
    'v13-updater-report.json': 3,
}
for name, minimum in required.items():
    report = json.loads((root / 'folio-v16-validation' / name).read_text(encoding='utf-8'))
    assert not report['errors'] and len(report['checks']) >= minimum, name
    if name not in {'v13-native-report.json', 'v14-native-report.json'}:
        assert report['platform'] == 'win32', name
    reports[name] = report
assert all(not screen['missing'] for screen in reports['v16-ui-report.json']['coverage'])
packaged = [r for r in reports.values() if 'exe_sha256' in r]
assert len(packaged) == 6
portable = root / 'folio-v16-deliverables' / f'{prefix}-win-x64.zip'
source = root / 'folio-v16-deliverables' / f'{prefix}-source.zip'
with zipfile.ZipFile(portable) as z:
    assert z.testzip() is None
    for name, field in [('Folio.exe', 'exe_sha256'), ('resources/app.asar', 'asar_sha256')]:
        with z.open('Folio-PDF-Studio/' + name) as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        assert all(r[field] == digest for r in packaged), field
with zipfile.ZipFile(source) as z:
    assert z.testzip() is None
    base = 'Folio-PDF-Studio-source/'
    assert json.loads(z.read(base + 'package.json'))['version'] == '1.6.0'
    for name in ['README.md', 'README.zh-Hans.md', 'README.zh-Hant.md',
                 'src/i18n.mjs', 'src/locales/en.json', 'src/locales/zh-Hant.json',
                 'docs/RELEASE-1.6.0.md', 'docs/RELEASE-1.6.0.zh-Hans.md', 'docs/RELEASE-1.6.0.zh-Hant.md']:
        assert z.read(base + name) == Path(name).read_bytes(), name
    assert not any('/tests/output/' in n or '/.venv/' in n for n in z.namelist())
shutil.copyfile(portable, out / f'{prefix}-portable-win-x64.zip')
shutil.copyfile(source, out / source.name)
url = f'https://github.com/ionize1080/Folio/actions/runs/{run}'
(out / f'{prefix}-validation.json').write_text(json.dumps({
    'sourceCommit': sha, 'windowsRun': url, 'unitTests': 152,
    'languages': ['en', 'zh-Hans', 'zh-Hant'], 'reports': reports,
}, ensure_ascii=False, indent=2), encoding='utf-8')
lines = []
for file in sorted(out.iterdir()):
    with file.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    lines.append(digest + '  ' + file.name)
(out / f'{prefix}-SHA256.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
sections = []
for locale, suffix, label in [('en', '', 'English'), ('zh-Hans', '.zh-Hans', '简体中文'), ('zh-Hant', '.zh-Hant', '繁體中文')]:
    body = Path(f'docs/RELEASE-1.6.0{suffix}.md').read_text(encoding='utf-8')
    body = re.sub(r'\]\((RELEASE-1\.6\.0[^)]*\.md)\)', rf'](https://github.com/ionize1080/Folio/blob/{sha}/docs/\1)', body)
    section = f'<!-- folio-locale:{locale} -->\n{body}\n<!-- /folio-locale -->'
    sections.append(section if locale == 'en' else f'<details>\n<summary>{label}</summary>\n\n{section}\n\n</details>')
notes = '\n\n'.join(sections) + f'\n\nVerified source: `{sha}`\n\n[Windows acceptance and screenshots]({url})\n'
Path('v16-release-notes.md').write_text(notes, encoding='utf-8')
# Upload as a draft; make discoverable only after the complete attachment set exists.
subprocess.run(['gh', 'release', 'create', 'v1.6.0', *[str(p) for p in sorted(out.iterdir())],
                '--target', sha, '--title', 'Folio PDF Studio 1.6.0',
                '--notes-file', 'v16-release-notes.md', '--draft'], check=True)
subprocess.run(['gh', 'release', 'edit', 'v1.6.0', '--draft=false', '--prerelease=false', '--latest'], check=True)
print(json.dumps({'release': 'https://github.com/ionize1080/Folio/releases/tag/v1.6.0', 'sourceCommit': sha, 'windowsRun': url}))

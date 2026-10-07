"""Publish only artifacts built and accepted in this exact Windows job."""
from pathlib import Path
import hashlib, json, os, subprocess, zipfile, shutil

root = Path(__file__).resolve().parents[1]
out = root / 'release-assets'
out.mkdir(exist_ok=True)
prefix = 'Folio-PDF-Studio-1.7.0'
sha = os.environ['GITHUB_SHA']
run = f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
required = {
    'smart-toc-electron-report.json': 3,
    'smart-toc-ui-report.json': 6, 'page-calibration-ui-report.json': 6,
    'v16-ui-report.json': 7, 'v15-ui-report.json': 6,
    'v14-ui-report.json': 6, 'v13-ui-report.json': 3,
    'v12-electron-report.json': 1, 'p7-electron-report.json': 1,
    'v15-native-report.json': 5, 'v14-native-report.json': 5,
    'v13-native-report.json': 5, 'p7-native-report.json': 11,
    'p8-native-report.json': 5, 'yearbook-native-report.json': 7,
    'v13-updater-report.json': 7, 'v161-updater-report.json': 1, 'v162-health-report.json': 1,
}
reports = {}
for name, minimum in required.items():
    report = json.loads((root / 'tests/output' / name).read_text(encoding='utf-8'))
    assert not report['errors'] and len(report['checks']) >= minimum, name
    reports[name] = report
assert all(not s['missing'] for s in reports['v16-ui-report.json']['coverage'])
portable = root / 'deliverables' / f'{prefix}-win-x64.zip'
def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()
with zipfile.ZipFile(portable) as archive:
    assert archive.testzip() is None
    for name, field in [('Folio.exe', 'exe_sha256'), ('resources/app.asar', 'asar_sha256')]:
        value = hashlib.sha256(archive.read('Folio-PDF-Studio/' + name)).hexdigest()
        assert all(r[field] == value for r in reports.values() if field in r), field
    assert json.loads(archive.read('Folio-PDF-Studio/BUILD-INFO.json'))['version'] == '1.7.0'
source = root / 'deliverables' / f'{prefix}-source.zip'
with zipfile.ZipFile(source) as archive:
    assert archive.testzip() is None
    for name in ['update-manager.cjs', 'portable-update.ps1', 'main.cjs', 'src/update-ui.mjs', 'package.json', 'src/smart-toc.mjs', 'src/smart-toc-ui.mjs', 'src/smart-toc-extract.mjs', 'src/smart-toc-worker.mjs', 'src/page-calibration.mjs']:
        assert archive.read('Folio-PDF-Studio-source/' + name) == (root / name).read_bytes(), name
shutil.copyfile(portable, out / f'{prefix}-portable-win-x64.zip')
shutil.copyfile(source, out / source.name)
config = {'version': 'v1.7.0', 'sha256': digest(portable)}
with zipfile.ZipFile(out / f'{prefix}-update-repair.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ['Repair-Folio-Update.cmd', 'Repair-Folio-Update.ps1']:
        archive.write(root / 'scripts' / name, name)
    archive.write(root / 'portable-update.ps1', 'portable-update.ps1')
    archive.write(root / 'docs/RELEASE-1.7.0.zh-Hans.md', 'README.zh-Hans.md')
    archive.write(root / 'docs/RELEASE-1.7.0.md', 'README.md')
    archive.writestr('repair-config.json', json.dumps(config, indent=2))
(out / f'{prefix}-validation.json').write_text(json.dumps({
    'sourceCommit': sha, 'windowsRun': run, 'reports': reports,
}, ensure_ascii=False, indent=2), encoding='utf-8')
(out / f'{prefix}-SHA256.txt').write_text(''.join(
    f'{digest(file)}  {file.name}\n' for file in sorted(out.iterdir()) if not file.name.endswith('-SHA256.txt')
), encoding='utf-8')
notes = []
for lang, suffix in [('en', ''), ('zh-Hans', '.zh-Hans'), ('zh-Hant', '.zh-Hant')]:
    notes.append(f'<!-- folio-locale:{lang} -->\n' + (root / f'docs/RELEASE-1.7.0{suffix}.md').read_text(encoding='utf-8') + '\n<!-- /folio-locale -->')
notes.append(f'Verified source: `{sha}`\n\n[Windows acceptance]({run})\n')
notes_file = out / 'release-notes.md'
notes_file.write_text('\n\n'.join(notes), encoding='utf-8')
assets = [str(p) for p in sorted(out.iterdir()) if p != notes_file]
# Keep the release hidden until every attachment is present. Never overwrite a
# published version or substitute artifacts from a different workflow run.
subprocess.run(['gh', 'release', 'create', 'v1.7.0', *assets, '--target', sha,
                '--title', 'Folio PDF Studio 1.7.0 — Smart contents and independent page matching',
                '--notes-file', str(notes_file), '--draft'], check=True)
subprocess.run(['gh', 'release', 'edit', 'v1.7.0', '--draft=false', '--prerelease=false', '--latest'], check=True)

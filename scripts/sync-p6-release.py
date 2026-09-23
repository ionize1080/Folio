"""One-time, hash-verified P6 release backup and Latest promotion.

Uses the repository's normal GITHUB_TOKEN via gh; never reads or prints secrets.
The backup-only branch run must pass before merging. Promotion runs on main.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPO = 'ionize1080/Folio'
BASE = '0b1cfa0cfb685f8d8bbd5ee04b0042574a85a8d5'
RELEASE_HEAD = 'd7da3515e5d477122197639dc202c58584b5b21f'
SNAPSHOT = ROOT / 'docs/release-snapshots/2026-09-23-p6-sync.json'
DOCS_PREFIX = 'Folio-PDF-Studio-1.2.0-RC1-P6-docs-20260923'
DOC_FILES = [
    'README.md', 'docs/ARCHITECTURE.md', 'docs/CHANGELOG-1.2.md',
    'docs/NEXT-RELEASE-PLAN.md', 'docs/VALIDATION.md',
    'docs/RELEASE-P6.md', 'docs/RC1-P6-editor-audit.md',
    'docs/RELEASE-SYNC-2026-09-23.md',
    'docs/release-snapshots/2026-09-23-p6-sync.json',
]


def run(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()


def api(endpoint, payload=None):
    command = ['gh', 'api', f'repos/{REPO}/{endpoint}']
    if payload is not None:
        command += ['--method', 'PATCH', '--input', '-']
    result = subprocess.run(command, input=None if payload is None else json.dumps(payload),
                            cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def digest(path):
    with path.open('rb') as stream:
        return 'sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest()


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def check_assets(release, expected, exact=False):
    found = {a['name']: a for a in release['assets']}
    if exact:
        check(set(found) == {a['name'] for a in expected}, 'Unexpected asset set')
    for wanted in expected:
        actual = found.get(wanted['name'])
        check(actual is not None, 'Missing asset: ' + wanted['name'])
        check(actual['size'] == wanted['size'] and actual['digest'] == wanted['digest'],
              'Asset hash/size mismatch: ' + wanted['name'])
        check(actual['state'] == 'uploaded', 'Incomplete upload: ' + wanted['name'])


def validate_checkout():
    run('git', 'merge-base', '--is-ancestor', RELEASE_HEAD, 'HEAD')
    allowed = set(DOC_FILES) | {
        'docs/VALIDATION-0.3.md', '.github/workflows/release-rc1-p6.yml',
        '.github/workflows/sync-p6-main-20260923.yml', 'scripts/sync-p6-release.py',
    }
    changed = set(run('git', 'diff', '--name-only', BASE, 'HEAD').splitlines())
    check(changed <= allowed, 'Program files changed; full Windows validation required')
    package = json.loads((ROOT / 'package.json').read_text())
    check(package['version'] == '1.2.0' and package['releaseChannel'] == 'rc1-p6',
          'Wrong program version')
    for branch, sha in [('backup/main-before-p6-sync-20260923', BASE),
                        ('backup/release-p6-before-sync-20260923', RELEASE_HEAD)]:
        check(api('git/ref/heads/' + branch)['object']['sha'] == sha,
              'Branch backup missing or changed: ' + branch)
    result = api('actions/runs/35818217755')
    check(result['conclusion'] == 'success' and result['status'] == 'completed'
          and result['head_sha'] == BASE, 'Original Windows build is not verified')


def backup_release(original, work):
    current = api('releases/' + str(original['id']))
    check(current['tag_name'] == original['tag_name'], 'Original release changed identity')
    check(api('commits/' + original['tag_name'])['sha'] == original['target_commitish'],
          'Original release tag moved')
    check_assets(current, original['assets'])
    if original['tag_name'].endswith('-p1'):
        check(current['body'] == original['body'] and not current['prerelease'],
              'Original P1 metadata changed since snapshot')
    else:
        notes = (ROOT / 'docs/RELEASE-P6.md').read_text()
        check(current['body'] in (original['body'], notes),
              'P6 notes changed outside this synchronization')
    folder = work / original['tag_name']
    folder.mkdir()
    metadata = folder / 'original-release.json'
    metadata.write_text(json.dumps(original, ensure_ascii=False, indent=2) + '\n')
    prior_notes = folder / 'original-release-notes.md'
    prior_notes.write_text(original['body'])
    extras = [{'name': p.name, 'size': p.stat().st_size, 'digest': digest(p)}
              for p in [metadata, prior_notes]]
    expected = original['assets'] + extras
    tag = original['backup_tag']
    # List includes drafts owned by this token. Never treat an arbitrary API error as absence.
    candidates = [r for r in api('releases?per_page=100') if r['tag_name'] == tag]
    check(len(candidates) <= 1, 'Ambiguous backup release')
    backup = candidates[0] if candidates else None
    if backup and not backup['draft']:
        check(backup['prerelease'], 'Backup unexpectedly promoted')
        check_assets(backup, expected, exact=True)
    else:
        existing = {a['name']: a for a in (backup or {}).get('assets', [])}
        check(set(existing) <= {a['name'] for a in expected}, 'Unexpected backup assets')
        for asset in expected:
            if asset['name'] in existing:
                check_assets({'assets': [existing[asset['name']]]}, [asset])
        for asset in original['assets']:
            if asset['name'] not in existing:
                run('gh', 'release', 'download', original['tag_name'], '--repo', REPO,
                    '--pattern', asset['name'], '--dir', str(folder))
                path = folder / asset['name']
                check(path.stat().st_size == asset['size'] and digest(path) == asset['digest'],
                      'Downloaded original hash mismatch: ' + asset['name'])
        if backup is None:
            note = folder / 'backup-notes.md'
            note.write_text(f"# Backup of {original['tag_name']} before 2026-09-23 synchronization\n\n"
                            'Original attachments were copied with SHA-256 verification. '
                            'Original metadata and notes are attached separately.\n\n'
                            f"Original release: {original['html_url']}\n"
                            f"Original commit: `{original['target_commitish']}`\n"
                            f"Original prerelease flag: {original['prerelease']}\n")
            run('gh', 'release', 'create', tag, '--repo', REPO, '--target', original['target_commitish'],
                '--title', f"Backup {original['tag_name']} · 2026-09-23", '--notes-file', str(note),
                '--draft', '--prerelease', '--latest=false')
        for asset in expected:
            if asset['name'] not in existing:
                run('gh', 'release', 'upload', tag, str(folder / asset['name']), '--repo', REPO)
        backups = [r for r in api('releases?per_page=100') if r['tag_name'] == tag]
        check(len(backups) == 1, 'Created backup is missing')
        backup = backups[0]
        check_assets(backup, expected, exact=True)
        run('gh', 'release', 'edit', tag, '--repo', REPO,
            '--draft=false', '--prerelease', '--latest=false')
    check(api('commits/' + tag)['sha'] == original['target_commitish'], 'Backup tag mismatch')
    print(f"Verified backup: {tag} ({len(expected)} attachments)", flush=True)


def publish_docs(work, snapshot):
    archive = work / (DOCS_PREFIX + '.zip')
    # Include tracked documentation and referenced local files needed for offline reading.
    files = sorted(set(run('git', 'ls-files', 'docs', 'README.md', 'README-P2.md',
                           'THIRD-PARTY-NOTICES.md', 'LICENSE', '.github/workflows',
                           'scripts', 'tests/requirements.txt', 'native/runtime-lock.json').splitlines()))
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
        for name in files:
            info = zipfile.ZipInfo(name, date_time=(2026, 9, 23, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, (ROOT / name).read_bytes())
    manifest = work / (DOCS_PREFIX + '.json')
    manifest.write_text(json.dumps({
        'programCommit': BASE, 'documentationCommit': run('git', 'rev-parse', 'HEAD'),
        'windowsRun': 'https://github.com/ionize1080/Folio/actions/runs/35818217755',
        'archive': archive.name, 'archiveSize': archive.stat().st_size,
        'archiveDigest': digest(archive),
        'backupReleases': [r['backup_tag'] for r in snapshot['releases']],
        'programAssetsUnchanged': True,
    }, ensure_ascii=False, indent=2) + '\n')
    current = api('releases/tags/v1.2.0-rc1-p6')
    existing = {a['name']: a for a in current['assets']}
    for path in [archive, manifest]:
        expected = {'name': path.name, 'size': path.stat().st_size, 'digest': digest(path)}
        if path.name in existing:
            check_assets(current, [expected])
        else:
            run('gh', 'release', 'upload', 'v1.2.0-rc1-p6', str(path), '--repo', REPO)
    current = api('releases/tags/v1.2.0-rc1-p6')
    check_assets(current, [{'name': p.name, 'size': p.stat().st_size, 'digest': digest(p)}
                           for p in [archive, manifest]])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--promote', action='store_true')
    args = parser.parse_args()
    snapshot = json.loads(SNAPSHOT.read_text())
    validate_checkout()
    if args.promote:
        check(os.environ.get('GITHUB_REF') == 'refs/heads/main', 'Promotion requires main')
        check(api('git/ref/heads/main')['object']['sha'] == run('git', 'rev-parse', 'HEAD'),
              'main moved during publication')
    with tempfile.TemporaryDirectory(prefix='folio-release-sync-') as temporary:
        work = Path(temporary)
        for original in snapshot['releases']:
            backup_release(original, work)
        if args.promote:
            publish_docs(work, snapshot)
            p6 = next(r for r in snapshot['releases'] if r['tag_name'].endswith('-p6'))
            updated = api('releases/' + str(p6['id']), {
                'body': (ROOT / 'docs/RELEASE-P6.md').read_text(),
                'prerelease': False, 'make_latest': 'true',
            })
            check_assets(updated, p6['assets'])
            check(api('releases/latest')['id'] == p6['id'], 'Latest did not update to P6')
            check(api('commits/' + p6['tag_name'])['sha'] == BASE, 'P6 tag changed')
            print('P6 Latest verified; original four assets and program tag unchanged.', flush=True)
        else:
            check(api('releases/latest')['tag_name'] == snapshot['originalLatest'],
                  'Backup-only run unexpectedly changed Latest')


if __name__ == '__main__':
    main()

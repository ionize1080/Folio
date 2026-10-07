"""Resume a draft after transient GitHub failures; never replace published assets."""
import hashlib
import json
import subprocess
import time


def gh(*args, missing=False):
    for attempt in range(4):
        result = subprocess.run(['gh', *args], capture_output=True, text=True, encoding='utf-8')
        if result.returncode == 0:
            return result.stdout
        if missing and 'HTTP 404' in result.stderr:
            return None
        transient = any(word in result.stderr.lower() for word in
                        ['timeout', 'timed out', 'tls handshake', 'connection reset', 'unexpected eof', 'http 502', 'http 503', 'http 504'])
        if not transient or attempt == 3:
            raise RuntimeError(result.stderr.strip())
        # Mutations may have succeeded remotely. The caller reconciles before
        # retrying create/upload; only read operations retry here.
        if args[0] != 'api':
            raise RuntimeError(result.stderr.strip())
        time.sleep(3 * (attempt + 1))


def publish(repo, tag, sha, title, notes, assets):
    endpoint = f'repos/{repo}/releases'

    def find():
        # The tag endpoint only finds published releases. Drafts have no public
        # tag yet, so enumerate authenticated releases before creating anything.
        page = 1
        while True:
            releases = json.loads(gh('api', endpoint + f'?per_page=100&page={page}'))
            matches = [r for r in releases if r['tag_name'] == tag]
            assert len(matches) <= 1, 'Multiple drafts require reconciliation'
            if matches:
                return matches[0]
            if len(releases) < 100:
                return None
            page += 1

    release = find()
    if not release:
        create_error = None
        try:
            gh('release', 'create', tag, '--repo', repo, '--target', sha,
               '--title', title, '--notes-file', str(notes), '--draft')
        except RuntimeError as error:
            create_error = error
        # Creation has an unknown remote outcome on transport failure, and
        # list visibility can lag even on success. Never create a second draft
        # during reconciliation; a later invocation can resume the first one.
        for attempt in range(6):
            release = find()
            if release:
                break
            time.sleep(3 * (attempt + 1))
        if not release:
            raise RuntimeError('Draft creation is not yet visible; retry later without creating another draft') from create_error
    assert release and release['target_commitish'] == sha, 'Existing tag targets another commit'

    def current_release():
        return json.loads(gh('api', endpoint + f"/{release['id']}"))
    expected = {}
    for file in assets:
        with file.open('rb') as stream:
            expected[file.name] = 'sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest()

    def uploaded():
        return {a['name']: a for a in json.loads(gh('api', endpoint + f"/{release['id']}/assets"))}

    for file in assets:
        for attempt in range(4):
            current = uploaded().get(file.name)
            if current and current['state'] == 'uploaded':
                assert current.get('digest') == expected[file.name] and current['size'] == file.stat().st_size, file.name
                break
            assert release['draft'], 'Never modify a published release'
            if current:
                assert current['state'] == 'starter', 'Unknown asset state'
                gh('api', '--method', 'DELETE', endpoint + f"/assets/{current['id']}")
            try:
                gh('release', 'upload', tag, str(file), '--repo', repo)
                current = uploaded().get(file.name)
                if current and current.get('digest') == expected[file.name]:
                    break
            except RuntimeError:
                if attempt == 3:
                    current = uploaded().get(file.name)
                    if not current or current.get('digest') != expected[file.name]:
                        raise
                    break
                time.sleep(3 * (attempt + 1))
        else:
            raise RuntimeError('Asset upload could not be verified: ' + file.name)
    actual = uploaded()
    assert set(actual) == set(expected)
    assert all(actual[name]['state'] == 'uploaded' and actual[name].get('digest') == digest for name, digest in expected.items())
    for attempt in range(4):
        if not current_release()['draft']:
            return
        try:
            gh('release', 'edit', tag, '--repo', repo, '--draft=false', '--prerelease=false', '--latest')
        except RuntimeError:
            if not current_release()['draft']:
                return
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))
    assert not current_release()['draft'], 'Release remained a draft'

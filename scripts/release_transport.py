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
        response = gh('api', endpoint + '/tags/' + tag, missing=True)
        return json.loads(response) if response else None

    release = find()
    for attempt in range(4):
        if release:
            break
        try:
            gh('release', 'create', tag, '--repo', repo, '--target', sha,
               '--title', title, '--notes-file', str(notes), '--draft')
        except RuntimeError:
            release = find()
            if release:
                break
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))
        release = find()
    assert release and release['target_commitish'] == sha, 'Existing tag targets another commit'
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
                time.sleep(3 * (attempt + 1))
        else:
            raise RuntimeError('Asset upload could not be verified: ' + file.name)
    actual = uploaded()
    assert set(actual) == set(expected)
    assert all(actual[name]['state'] == 'uploaded' and actual[name].get('digest') == digest for name, digest in expected.items())
    for attempt in range(4):
        if not find()['draft']:
            return
        try:
            gh('release', 'edit', tag, '--repo', repo, '--draft=false', '--prerelease=false', '--latest')
        except RuntimeError:
            if not find()['draft']:
                return
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))
    assert not find()['draft'], 'Release remained a draft'

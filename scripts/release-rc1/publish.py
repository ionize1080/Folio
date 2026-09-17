"""Publish only the verified RC1 deliverables using the Actions GITHUB_TOKEN."""
import hashlib
import base64
import json
import os
from pathlib import Path
import subprocess
import zipfile
import zlib
from restore import restore, digest

REPO = 'ionize1080/Folio'
RUN = 35211609385
TARGET = 'c2d00df968bec8a49a4395dbcbd21f13505ccbee'
TESTED = '233db28ec1fbecf7c052564ef4a1cd3ca5d7f8ba'
TAG = 'v1.2.0-rc1'


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)


def api(path):
    return json.loads(gh('api', f'repos/{REPO}/{path}'))


def finalize(release):
    if (release['tag_name'] != TAG or release['target_commitish'] != TARGET
            or not release['draft'] or not release['prerelease']):
        raise RuntimeError('Unexpected draft identity')
    recipe = json.loads(zlib.decompress(base64.b64decode(Path(__file__).with_name('recipe.zlib.b64').read_text())))
    assets = {asset['name']: asset for asset in release['assets']}
    if len(release['assets']) != len(recipe['outputs']) or set(assets) != {item['name'] for item in recipe['outputs']}:
        raise RuntimeError('Uploaded asset list mismatch; left draft unpublished')
    for item in recipe['outputs']:
        asset = assets[item['name']]
        if (asset['state'] != 'uploaded' or asset['size'] != item['size']
                or asset.get('digest') != 'sha256:' + item['sha256']):
            raise RuntimeError('Uploaded asset digest mismatch; left draft unpublished')
    print('All uploaded asset digests match; publishing verified draft', flush=True)
    gh('api', '--method', 'PATCH', f'repos/{REPO}/releases/{release["id"]}',
       '-F', 'draft=false', '-F', 'prerelease=true', '-f', 'make_latest=false')
    result = api(f'releases/{release["id"]}')
    if result['draft'] or not result['prerelease']:
        raise RuntimeError('Unexpected release state')
    ref = api(f'git/ref/tags/{TAG}')
    if ref['object']['sha'] != TARGET:
        raise RuntimeError('Unexpected release tag target')
    print('Published ' + result['html_url'], flush=True)


def main():
    if os.environ.get('GITHUB_REPOSITORY') != REPO:
        raise RuntimeError('Unexpected repository')
    run = api(f'actions/runs/{RUN}')
    if run['conclusion'] != 'success' or run['head_sha'] != TESTED:
        raise RuntimeError('Source validation is not the expected successful run')
    # Never overwrite an existing release, tag or uploaded asset.
    existing = api('releases?per_page=100')
    matched = [item for item in existing if item['tag_name'] == TAG]
    if matched:
        # Resume only the exact draft created by the first publication run.
        if len(matched) != 1 or matched[0]['id'] != 390649849:
            raise RuntimeError('Unexpected existing RC1 release')
        finalize(api(f'releases/{matched[0]["id"]}'))
        return
    refs = api(f'git/matching-refs/tags/{TAG}')
    if any(item['ref'] == f'refs/tags/{TAG}' for item in refs):
        raise RuntimeError('RC1 tag already exists; review it manually')
    inputs = Path('release-inputs')
    inputs.mkdir(exist_ok=False)
    sources = [
        (10491909365, 'source.zip', '526d3b546bd1618d3a8b611d4403cdfdc58318c0f4d8f894bfdb8afd26e44f2d'),
        (10492123444, 'portable.zip', 'a98a1fa43d116fcef5486962ca9f0d951df840fea5701676d4e865c39bd60601'),
        (10491998634, 'validation.zip', '006ee1ec044a4d18f2a7f902905922d678653afa1459156d791d1fa9a6f888be'),
    ]
    for artifact_id, name, expected in sources:
        meta = api(f'actions/artifacts/{artifact_id}')
        if meta['expired'] or meta['workflow_run']['id'] != RUN:
            raise RuntimeError('Invalid artifact provenance')
        outer = inputs / ('artifact-' + name)
        print(f'Downloading tested {name}', flush=True)
        with outer.open('xb') as stream:
            subprocess.run(['gh', 'api', f'repos/{REPO}/actions/artifacts/{artifact_id}/zip'], stdout=stream, check=True)
        if digest(outer) != expected:
            raise RuntimeError(f'Artifact digest mismatch: {name}')
        if name == 'validation.zip':
            outer.rename(inputs / name)
        else:
            with zipfile.ZipFile(outer) as archive:
                members = [info for info in archive.infolist() if not info.is_dir()]
                if len(members) != 1 or not members[0].filename.endswith('.zip'):
                    raise RuntimeError('Unexpected build artifact layout')
                with archive.open(members[0]) as source, (inputs / name).open('xb') as target:
                    while data := source.read(1024*1024):
                        target.write(data)
    output = Path('release-output')
    restore(inputs, output)
    paths = sorted(output.iterdir())
    print('All five assets match delivered SHA256; creating draft', flush=True)
    gh('release', 'create', TAG, '--repo', REPO, '--target', TARGET,
       '--title', 'Folio PDF Studio 1.2.0 RC1', '--draft', '--prerelease',
       '--latest=false', '--notes-file', str(Path(__file__).with_name('NOTES.md')))
    subprocess.run(['gh', 'release', 'upload', TAG, '--repo', REPO, *map(str, paths)], check=True)
    matches = [item for item in api('releases?per_page=100') if item['tag_name'] == TAG]
    if len(matches) != 1:
        raise RuntimeError('Expected one draft release')
    finalize(api(f'releases/{matches[0]["id"]}'))


if __name__ == '__main__':
    main()

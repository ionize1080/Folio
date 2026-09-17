"""Recreate the delivered RC1 bytes from immutable, tested Actions artifacts.

Only ZIP framing and added validation records are carried by the recipe. Large
compressed payloads are copied unchanged. Input and final SHA256 are mandatory.
No binaries are rebuilt during publication.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import zlib
import zipfile


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def restore(inputs, output):
    recipe = json.loads(zlib.decompress(base64.b64decode(Path(__file__).with_name('recipe.zlib.b64').read_text())))
    for name, expected in recipe['inputs'].items():
        if digest(inputs / name) != expected:
            raise ValueError(f'Untrusted input: {name}')
    output.mkdir(parents=True, exist_ok=True)
    for item in recipe['outputs']:
        name = item['name']
        if Path(name).name != name:
            raise ValueError('Invalid output name')
        target = output / name
        with target.open('xb') as stream:
            for chunk in item['chunks']:
                if isinstance(chunk, str):
                    stream.write(zlib.decompress(base64.b64decode(chunk)))
                elif chunk[0] == 'zip':
                    _, source, entry = chunk
                    if source not in recipe['inputs']:
                        raise ValueError('Invalid source archive')
                    with zipfile.ZipFile(inputs / source) as archive:
                        data = archive.read(entry)
                    compressor = zlib.compressobj(6, zlib.DEFLATED, -15)
                    stream.write(compressor.compress(data) + compressor.flush())
                else:
                    source, offset, size = chunk
                    if source not in recipe['inputs'] or offset < 0 or size < 0:
                        raise ValueError('Invalid source range')
                    with (inputs / source).open('rb') as source_stream:
                        source_stream.seek(offset)
                        remaining = size
                        while remaining:
                            data = source_stream.read(min(remaining, 1024*1024))
                            if not data:
                                raise ValueError('Truncated source')
                            stream.write(data)
                            remaining -= len(data)
        if target.stat().st_size != item['size'] or digest(target) != item['sha256']:
            raise ValueError(f'Release checksum mismatch: {name}')
        print(f'Verified {name}: {item["sha256"]}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('inputs', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    restore(args.inputs, args.output)

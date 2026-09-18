"""Restore the pinned native models required by a clean checkout."""
from pathlib import Path
import hashlib
import json
import urllib.request

root = Path(__file__).resolve().parents[1]
model_dir = root / 'native/models'
manifest = json.loads((model_dir / 'manifest.json').read_text(encoding='utf-8'))
for item in manifest:
    target = model_dir / (item['name'] + '.onnx')
    if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == item['sha256']:
        print('Verified', target.name, flush=True)
        continue
    temporary = target.with_suffix('.download')
    digest = hashlib.sha256()
    try:
        with urllib.request.urlopen(item['url'], timeout=180) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != item['sha256']:
            raise ValueError('Model checksum mismatch: ' + item['name'])
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    print('Restored', target.name, flush=True)

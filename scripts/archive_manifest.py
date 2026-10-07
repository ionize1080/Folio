"""Source archives contain tracked files and explicitly restored, pinned assets."""
from pathlib import Path
import hashlib
import json
import subprocess

def source_files(root):
    root = Path(root).resolve()
    names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    allowed = {Path(n) for n in names if n}
    manifest = root / 'native/models/manifest.json'
    if manifest.exists():
        for item in json.loads(manifest.read_text(encoding='utf-8')):
            rel = Path('native/models') / (item['name'] + '.onnx')
            p = root / rel
            if p.exists():
                if hashlib.sha256(p.read_bytes()).hexdigest() != item['sha256']:
                    raise ValueError('Unverified model: ' + str(rel))
                allowed.add(rel)
    # This exact optional dependency is installed by the release workflow.
    vendor = root / 'native/vendor'
    metadata = vendor / 'fonttools-4.61.1.dist-info/METADATA'
    if metadata.exists():
        text = metadata.read_text(encoding='utf-8')
        if 'Version: 4.61.1\n' not in text:
            raise ValueError('Unexpected fontTools version')
        for folder in ('fontTools', 'fonttools-4.61.1.dist-info'):
            allowed.update(p.relative_to(root) for p in (vendor/folder).rglob('*') if p.is_file())
    result = []
    for rel in sorted(allowed):
        p = root / rel
        if any(x in rel.parts for x in ('.git', '__pycache__', 'node_modules', 'dist', 'deliverables', 'release-assets')) or rel.parts[:2] == ('tests','output'):
            continue
        if p.is_symlink() or root not in p.resolve().parents:
            raise ValueError('Unsafe archive path: ' + str(rel))
        if rel.name == '.env' or rel.name.startswith('.env.') or rel.suffix.lower() in ('.key', '.pem'):
            raise ValueError('Sensitive filename in source manifest: ' + str(rel))
        if not p.is_file():
            raise ValueError('Missing tracked source: ' + str(rel))
        result.append(rel)
    return result

"""Extend the versioned portable runtime with checksum-locked conversion wheels.

The base runtime is tracked in Git and contains locally built wheels (including
ANTLR) that are not published as wheels on PyPI. Do not rebuild that baseline.
"""
from pathlib import Path
import hashlib
import json
import shutil
import urllib.request
import zipfile

root = Path(__file__).resolve().parents[1]
site = root / 'native/runtime/Lib/site-packages'
assert (root / 'native/runtime/python.exe').is_file(), 'Versioned base runtime missing'
cache = root / '.ai-runtime/conversion-downloads/wheels'
cache.mkdir(parents=True, exist_ok=True)
names = {'pdf2docx', 'python_docx', 'openpyxl', 'lxml', 'fire', 'et_xmlfile',
         'termcolor', 'markdown_it_py', 'mdurl'}
lock = json.loads((root / 'native/runtime-lock.json').read_text(encoding='utf-8'))
items = [item for item in lock['wheels'] if item['name'].split('-')[0] in names]
assert len(items) == len(names), 'Missing or duplicate conversion wheel lock'
for item in items:
    target = cache / item['name']
    if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != item['sha256']:
        name, version = item['name'].split('-')[:2]
        with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json', timeout=60) as response:
            metadata = json.load(response)
        release = next((entry for entry in metadata['urls'] if entry['filename'] == item['name']), None)
        if not release or release['digests']['sha256'] != item['sha256']:
            raise ValueError('Locked wheel not available: ' + item['name'])
        with urllib.request.urlopen(release['url'], timeout=180) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Wheel checksum mismatch: ' + item['name'])
        target.write_bytes(data)
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        for entry in archive.namelist():
            assert (site / entry).resolve().is_relative_to(site.resolve()), 'Unsafe wheel path'
        archive.extractall(site)
    print('Verified and restored', target.name, flush=True)
for metadata in site.glob('*.dist-info'):
    for source in metadata.rglob('*'):
        if source.is_file() and any(word in source.name.lower() for word in ['license', 'notice', 'copying']):
            target = root / 'native/licenses' / metadata.name / source.relative_to(metadata)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)

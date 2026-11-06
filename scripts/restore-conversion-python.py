"""Extend the versioned portable runtime with checksum-locked conversion wheels.

The base runtime is tracked in Git and contains locally built wheels (including
ANTLR) that are not published as wheels on PyPI. Do not rebuild that baseline.
"""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import urllib.request
import urllib.error
import time
import zipfile

def download(url, timeout):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))

root = Path(__file__).resolve().parents[1]
site = root / 'native/runtime/Lib/site-packages'
assert (root / 'native/runtime/python.exe').is_file(), 'Versioned base runtime missing'
cache = root / '.ai-runtime/conversion-downloads/wheels'
cache.mkdir(parents=True, exist_ok=True)
names = {'pdf2docx', 'python_docx', 'openpyxl', 'lxml', 'fire', 'et_xmlfile',
         'termcolor', 'markdown_it_py', 'mdurl', 'fonttools', 'brotli', 'pymupdf'}
lock = json.loads((root / 'native/runtime-lock.json').read_text(encoding='utf-8'))
items = [item for item in lock['wheels'] if item['name'].split('-')[0] in names]
assert len(items) == len(names), 'Missing or duplicate conversion wheel lock'
for item in items:
    target = cache / item['name']
    if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != item['sha256']:
        name, version = item['name'].split('-')[:2]
        metadata = json.loads(download(f'https://pypi.org/pypi/{name}/{version}/json', 60))
        release = next((entry for entry in metadata['urls'] if entry['filename'] == item['name']), None)
        if not release or release['digests']['sha256'] != item['sha256']:
            raise ValueError('Locked wheel not available: ' + item['name'])
        data = download(release['url'], 180)
        if hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Wheel checksum mismatch: ' + item['name'])
        target.write_bytes(data)
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        for entry in archive.namelist():
            assert (site / entry).resolve().is_relative_to(site.resolve()), 'Unsafe wheel path'
        package = item['name'].split('-')[0]
        current_metadata = {entry.split('/')[0] for entry in archive.namelist() if entry.split('/')[0].endswith('.dist-info')}
        for obsolete in site.glob(package + '-*.dist-info'):
            if obsolete.name not in current_metadata:
                resolved = obsolete.resolve()
                assert resolved.is_relative_to(site.resolve()) and site.resolve().is_relative_to(root.resolve())
                shutil.rmtree(resolved)
        archive.extractall(site)
    print('Verified and restored', target.name, flush=True)
for metadata in site.glob('*.dist-info'):
    for source in metadata.rglob('*'):
        if source.is_file() and any(word in source.name.lower() for word in ['license', 'notice', 'copying']):
            target = root / 'native/licenses' / metadata.name / source.relative_to(metadata)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)

subprocess.run([str(root / "native/runtime/python.exe"), "-c", "from pdf2docx import Converter;from docx import Document;from openpyxl import Workbook;from markdown_it import MarkdownIt;from fontTools.ttLib import TTFont;from fontTools.varLib.instancer import instantiateVariableFont;import brotli;print('Conversion runtime import smoke check passed')"], check=True)

"""Package verified portable runtime and source. Python standard library only."""
from pathlib import Path
import hashlib, json, sys, zipfile
from concurrent.futures import ThreadPoolExecutor
from archive_manifest import source_files
root = Path(__file__).resolve().parents[1]
package = json.loads((root / 'package.json').read_text())
version = package['version'] + ('-' + package['releaseChannel'].upper() if package.get('releaseChannel') else '')
out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root.parent / 'deliverables'
out.mkdir(parents=True, exist_ok=True)
files = [out / f'Folio-PDF-Studio-{version}-portable-win-x64.zip', out / f'Folio-PDF-Studio-{version}-source.zip']
base = root / 'dist/Folio-PDF-Studio-win-x64'
def digest(file):
    with file.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def archive(index):
    file=files[index]
    with zipfile.ZipFile(file,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        if index==0:
            for f in sorted(base.rglob('*')):
                rel=f.relative_to(base)
                if f.is_file() and not any(p.startswith('.') or p=='__pycache__' for p in rel.parts) and rel not in [Path('resources/default_app.asar'),Path('electron.exe')]:
                    z.write(f,Path('Folio-PDF-Studio')/rel)
        else:
            manifest=[]
            for rel in source_files(root):
                f=root/rel;z.write(f,Path('Folio-PDF-Studio-source')/rel)
                manifest.append({'path':rel.as_posix(),'bytes':f.stat().st_size,'sha256':digest(f)})
            z.writestr('Folio-PDF-Studio-source/SOURCE-MANIFEST.json',json.dumps(manifest,indent=2))
    with zipfile.ZipFile(file) as z:
        assert z.testzip() is None
    return {'file':file.name,'bytes':file.stat().st_size,'sha256':digest(file)}

# zlib releases the GIL. Separate archives have no shared mutable state; retain
# CRC validation and streaming digests while avoiding serial compression.
with ThreadPoolExecutor(max_workers=2) as pool:result=list(pool.map(archive,range(2)))
(out / f'Folio-PDF-Studio-{version}-SHA256.json').write_text(json.dumps(result, indent=2))
(out / f'Folio-PDF-Studio-{version}-SHA256.txt').write_text(''.join(item['sha256']+'  '+item['file']+'\n' for item in result),encoding='utf8')
print(json.dumps(result, indent=2))

"""Extract only the exact workflow-owned portable ZIP, validating every path."""
from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parents[1];folder=root/'deliverables'
name='Folio-PDF-Studio-2.8.0-portable-win-x64.zip';file=folder/name
manifest=json.loads((folder/'Folio-PDF-Studio-2.8.0-SHA256.json').read_text())
with file.open('rb') as stream:actual=hashlib.file_digest(stream,'sha256').hexdigest()
assert next(x['sha256'] for x in manifest if x['file']==name)==actual
target=(root/'dist/Folio-PDF-Studio-win-x64').resolve();target.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(file) as z:
    for item in z.infolist():
        parts=Path(item.filename).parts;assert parts[0]=='Folio-PDF-Studio'
        dest=target.joinpath(*parts[1:]).resolve();assert dest==target or target in dest.parents
        if item.is_dir():dest.mkdir(parents=True,exist_ok=True)
        else:
            dest.parent.mkdir(parents=True,exist_ok=True)
            import shutil
            with z.open(item) as src,dest.open('wb') as output:shutil.copyfileobj(src,output,1024*1024)
print('Verified and extracted package',actual)

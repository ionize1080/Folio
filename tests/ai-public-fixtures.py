"""Public document plus a controlled faded scan of its abstract for pixel/OCR checks."""
from pathlib import Path
import hashlib, io, json
import fitz
from PIL import Image, ImageDraw

out=Path('tests/output')
out.mkdir(parents=True,exist_ok=True)
public=Path('tests/fixtures/NIST.FIPS.197-upd1.pdf')
assert hashlib.sha256(public.read_bytes()).hexdigest()=='62c86eb567f13edb8f71826e985da870b04ef6381634f303cdb16e84d47becd1'
with fitz.open(public) as doc:
    page=doc[2]
    pixels=page.get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False)
    image=Image.frombytes('RGB',(pixels.width,pixels.height),pixels.samples)
    image=image.point(lambda v: round(118+v*0.41))
    image.save(out/'faded-source.png')
    scan=fitz.open()
    dest=scan.new_page(width=page.rect.width,height=page.rect.height)
    dest.insert_image(dest.rect,filename=str(out/'faded-source.png'))
    scan.save(out/'faded-scan.pdf')
patch=Image.new('RGB',(240,240),(28,142,89))
ImageDraw.Draw(patch).ellipse((75,75,165,165),fill=(245,247,250))
patch.save(out/'replacement-patch.png')

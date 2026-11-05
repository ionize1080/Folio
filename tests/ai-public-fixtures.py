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

# An oversized color target makes downsampling and channel changes measurable.
import numpy as np
from PIL import ImageFont
w,h=2400,1600
x=np.tile(np.linspace(32,212,w),(h,1))
y=np.tile(np.linspace(40,200,h),(w,1)).T
im=Image.fromarray(np.stack([x,y,.4*x+.6*y],axis=2).astype('uint8'))
brush=ImageDraw.Draw(im)
for n,color in enumerate(['#BE3542','#2C829D','#C99B28','#5A9155','#766899','#B0ADB1']):
    brush.rectangle((120+n*368,1350,400+n*368,1490),fill=color)
brush.text((140,160),'FOLIO / COLOR PROOF',font=ImageFont.truetype('native/fonts/DejaVuSans.ttf',100),fill='white')
im.save(out/'color-proof.png')
with fitz.open() as doc:
    page=doc.new_page(width=600,height=400)
    page.insert_image(page.rect,filename=str(out/'color-proof.png'))
    doc.new_page(width=600,height=400).insert_text((44,88),'Unchanged control page')
    doc.save(out/'color-proof.pdf',deflate=True)

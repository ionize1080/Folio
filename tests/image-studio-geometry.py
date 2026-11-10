"""Visual image handoff regressions, including real user PDFs when available."""
import base64
import io
import json
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'native'))
import fitz
import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, FloatObject, NameObject as N
import worker
from image_adjustments import add_image

OUT = ROOT/'tests/output/image-studio-geometry'
OUT.mkdir(parents=True, exist_ok=True)
checks = []


def b64(data):
    return base64.b64encode(data).decode()


def pattern(width=160, height=100):
    image = Image.new('RGB', (width, height), '#ecab25')
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width//2-1, height//2-1), fill='#e22c40')
    draw.rectangle((width//2, 0, width, height//2-1), fill='#2cbe65')
    draw.rectangle((0, height//2, width//2-1, height), fill='#2775e4')
    draw.text((7, 7), 'TOP LEFT', fill='white')
    draw.text((7, height-15), 'BOTTOM', fill='white')
    return image


def png(image):
    data = io.BytesIO()
    image.save(data, format='PNG')
    return b64(data.getvalue())


def fixture(matrix, rotation=0, clipped=False):
    writer = PdfWriter()
    page = writer.add_blank_page(600, 500)
    draw = add_image(writer, page, pattern())
    vals = lambda xs: [FloatObject(x) for x in xs]
    ops = [([], b'q')]
    if clipped is True:
        ops += [(vals([170, 190, 125, 80]), b're'), ([], b'W'), ([], b'n')]
    elif clipped=='curved':
        ops += [(vals([155,230]),b'm'),(vals([155,285,285,285,285,230]),b'c'),
                (vals([285,175,155,175,155,230]),b'c'),([],b'W'),([],b'n')]
    elif clipped=='evenodd':
        ops += [(vals([140,180,160,100]),b're'),(vals([190,210,50,40]),b're'),([],b'W*'),([],b'n')]
    elif clipped=='rotated':
        ops += [(vals([.8,.6,-.6,.8,220,230]),b'cm'),(vals([-70,-40,140,80]),b're'),([],b'W'),([],b'n'),
                (vals([.8,-.6,.6,.8,-314,-52]),b'cm')]
    elif clipped=='curve-shorthand':
        ops += [(vals([150,230]),b'm'),(vals([185,285,245,275]),b'v'),
                (vals([305,215,250,185]),b'y'),(vals([150,230]),b'l'),([],b'h'),([],b'W'),([],b'n')]
    elif clipped=='nested-restored':
        ops += [(vals([160,195]),b'm'),(vals([300,215]),b'l'),(vals([260,275]),b'l'),([],b'h'),([],b'W'),([],b'n'),
                ([],b'q'),(vals([180,200,10,10]),b're'),([],b'W'),([],b'n'),([],b'Q')]
    ops += [(vals(matrix), b'cm'), draw, ([], b'Q')]
    stream = ContentStream(None, writer)
    stream.operations = ops
    page[N('/Contents')] = writer._add_object(stream)
    page.cropbox.lower_left = (30, 40)
    page.cropbox.upper_right = (580, 470)
    if rotation:
        page.rotate(rotation)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def inspect(data, page=1):
    result = worker.run(dict(command='inspect', bytes=b64(data), page=page, imagesOnly=True))
    origin = result['pageOrigin']
    for image in result['objects']:
        image['matrix'][4] += origin[0]
        image['matrix'][5] += origin[1]
    return result


def apply(data, edits):
    return base64.b64decode(worker.run(dict(command='apply', bytes=b64(data), edits=edits))['bytes'])


def pixels(data, page=1, engine='mupdf'):
    if engine == 'mupdf':
        with fitz.open(stream=data, filetype='pdf') as doc:
            pix = doc[page-1].get_pixmap(alpha=False)
            return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
    with pdfium.PdfDocument(data) as doc:
        p = doc[page-1]
        bitmap = p.render(scale=1)
        result = np.array(bitmap.to_pil().convert('RGB'))
        bitmap.close()
        p.close()
        return result


def check(name, raw, page=1, changes=None, target_index=None):
    result = inspect(raw, page)
    image = next(o for o in result['objects'] if o['editable'] and (target_index is None or o['index'] == target_index))
    changes = changes or {}
    original = dict(type='image', page=page, index=image['index'], signature=image['signature'],
                    matrix=image['matrix'], **changes)
    expected = apply(raw, [original]) if changes else raw
    exported = worker.run(dict(command='image-export', bytes=b64(raw), page=page,
                               index=image['index'], matrix=image['matrix'],
                               pageRotation=result['pageRotation'], clipBounds=image.get('clipBounds'),
                               studio=True, **changes))
    edited = dict(type='studio-graphic', kind='photo', page=page, id=str(uuid.uuid4()),
                  index=image['index'], signature=image['signature'], matrix=exported['matrix'],
                  box=exported['box'], imageData=exported['imageData'])
    output = apply(raw, [edited])
    stats = {}
    for engine in ('mupdf', 'pdfium'):
        before, after = pixels(expected, page, engine), pixels(output, page, engine)
        assert before.shape == after.shape, (name, engine, before.shape, after.shape)
        diff = np.abs(before.astype(float)-after.astype(float))
        mean = float(diff.mean())
        changed = float((diff.max(axis=2)>32).mean())
        assert mean < 1.1 and changed < .012, (name, engine, mean, changed)
        stats[engine] = dict(meanAbsoluteError=mean, pixelsAbove32=changed)
    (OUT/(name+'.png')).write_bytes(base64.b64decode(exported['imageData']))
    checks.append(dict(name=name, dimensions=exported['dimensions'], **stats))
    return output, exported


matrices = {
    'upright': [160, 0, 0, 100, 140, 180],
    'flip-y': [160, 0, 0, -100, 140, 280],
    'flip-x': [-160, 0, 0, 100, 300, 180],
    'rotate-90': [0, 160, -100, 0, 300, 180],
    'rotate-180': [-160, 0, 0, -100, 300, 280],
    'rotate-270': [0, -160, 100, 0, 140, 340],
    'shear': [160, 24, 32, 100, 140, 180],
    'oblique': [140, 80, -50, 87, 220, 180],
}
for name, matrix in matrices.items():
    for rotation in (0, 90, 180, 270):
        check(f'{name}-page-{rotation}', fixture(matrix, rotation))

normal = fixture(matrices['upright'])
(OUT/'ui-fixture.pdf').write_bytes(normal)
check('existing-clip', fixture(matrices['upright'], clipped=True))
for clip in ('curved','evenodd','rotated','curve-shorthand','nested-restored'):
    for rotation in (0,90,180,270):
        check(f'{clip}-clip-page-{rotation}',fixture(matrices['upright'],rotation,clipped=clip))
check('four-side-crop', normal, changes=dict(crop=[11, 17, 23, 9]))
check('perspective-and-crop', normal, changes=dict(crop=[10, 10, 5, 5],
      perspective=[[.1, .1], [.85, .08], [.94, .9], [.05, .95]]))
check('adjusted-mirror', fixture(matrices['flip-y']), changes=dict(adjustments=dict(brightness=17, saturation=-45)))
for fit in ('contain', 'cover', 'stretch'):
    check('replacement-'+fit, fixture(matrices['rotate-90'], 270), changes=dict(
          imageData=png(pattern(100, 160)), imageFit=fit, crop=[10, 12, 7, 5]))

# Native quarter turns must retain exact source pixels, while appearing in the
# same direction as the source PDF. Color corners catch double flips directly.
for name in ('upright', 'flip-y', 'flip-x', 'rotate-180'):
    image = Image.open(OUT/(name+'-page-0.png')).convert('RGB')
    source = pattern()
    transform = {'flip-y': Image.Transpose.FLIP_TOP_BOTTOM, 'flip-x': Image.Transpose.FLIP_LEFT_RIGHT,
                 'rotate-180': Image.Transpose.ROTATE_180}.get(name)
    if transform is not None:
        source = source.transpose(transform)
    assert image.size == source.size and image.tobytes() == source.tobytes(), name

yearbook = Path(r'C:\Users\haowe\Downloads\中国交通年鉴2025_1-edited.pdf')
if yearbook.exists():
    data = yearbook.read_bytes()
    check('yearbook-page62-train', data, page=62, target_index=43)
    check('yearbook-page62-logo', data, page=62, target_index=25)
    checks.append(dict(name='real-yearbook', pages=len(PdfReader(io.BytesIO(data)).pages)))

report = dict(status='passed', checks=checks)
(OUT/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(dict(status='passed', cases=len(checks), maxError=max(x['mupdf']['meanAbsoluteError'] for x in checks if 'mupdf' in x)), indent=2))

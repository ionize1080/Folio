"""Save and editable reopen use the same sub-pixel rectangular-clip tolerance."""
from pathlib import Path
import base64, io, json, sys
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'native'), str(ROOT / 'native/vendor')]
import fitz, worker, pypdfium2 as pdfium
from clip_contract import validate_ink, CLIP_TOLERANCE
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, NameObject, FloatObject

d = fitz.open()
d.new_page(width=300, height=150).insert_text((30, 60), 'Third line', fontsize=12)
raw = d.tobytes()
with pdfium.PdfDocument(raw) as document:
    page = document[0]
    box = list(next(page.get_objects()).get_bounds())
    page.close()

checks = []
for delta, editable in [(0.03, True), (0.10, False), (1.0, False)]:
    writer = PdfWriter()
    page = writer.add_page(PdfReader(io.BytesIO(raw)).pages[0])
    clip = [box[0] + delta, box[1] - 5, box[2] + 5, box[3] + 5]
    stream = ContentStream(page.get('/Contents'), writer)
    stream.operations = [([], b'q'), ([FloatObject(v) for v in [clip[0], clip[1], clip[2] - clip[0], clip[3] - clip[1]]], b're'), ([], b'W'), ([], b'n')] + stream.operations + [([], b'Q')]
    page[NameObject('/Contents')] = writer._add_object(stream)
    buf = io.BytesIO()
    writer.write(buf)
    inspection = worker.run({'command': 'inspect', 'bytes': base64.b64encode(buf.getvalue()).decode(), 'page': 1})
    text = next(o for o in inspection['objects'] if o['type'] == 'text')
    assert bool(text.get('flowEditable')) == editable, (delta, text)
    try:
        validate_ink([box], [clip])
        accepted = True
    except ValueError:
        accepted = False
    assert accepted == editable, delta
    checks.append(f'{delta}pt clip overrun: save/reopen agree on {"editable" if editable else "protected"}')
print(json.dumps({'tolerance': CLIP_TOLERANCE, 'checks': checks, 'errors': []}))

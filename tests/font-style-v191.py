"""Embedded style survives missing PDF descriptor hints and repeated export."""
import base64
import io
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/'native'), str(ROOT/'native/vendor'), str(ROOT/'tests')]
import fitz
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject
from p8_helpers import inspect
from font_match import load_font
from fast_layout import font_data, render


def font_blob(bold=False, italic=False):
    builder = FontBuilder(1000, isTTF=True)
    order = ['.notdef', 'A', 'B', 'C', 'D']
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap({ord(name): name for name in order[1:]})
    glyphs = {}
    for i, name in enumerate(order):
        pen = TTGlyphPen(None)
        pen.moveTo((70, 0)); pen.lineTo((460 + 20*i if bold else 350 + 20*i, 0))
        pen.lineTo((480 + 20*i if italic else 350 + 20*i, 700))
        pen.lineTo((190 if italic else 70, 700)); pen.closePath()
        glyphs[name] = pen.glyph()
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (650, 70) for name in order})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800,
                    usWinDescent=200, usWeightClass=700 if bold else 400,
                    fsSelection=(32 if bold else 0) | (1 if italic else 0))
    style = ('Bold' if bold else '') + ('Italic' if italic else '') or 'Regular'
    builder.setupNameTable({'familyName': 'StyleAudit', 'styleName': style,
                           'psName': 'StyleAudit-'+style, 'fullName': 'StyleAudit '+style})
    builder.setupPost(italicAngle=-12 if italic else 0)
    builder.font['head'].macStyle = (1 if bold else 0) | (2 if italic else 0)
    out = io.BytesIO(); builder.save(out)
    return out.getvalue()


def pdf(bold=False, italic=False, synthetic=False, shear=False, weight=None):
    with fitz.open() as doc:
        page = doc.new_page(width=250, height=150)
        page.insert_font(fontname='F', fontbuffer=font_blob(bold, italic))
        page.insert_text((30, 60), 'ABCD', fontname='F', fontsize=20,
                         render_mode=2 if synthetic else 0,
                         morph=(fitz.Point(30, 60), fitz.Matrix(1, 0, .2, 1, 0, 0)) if shear else None)
        raw = doc.tobytes()
    reader = PdfReader(io.BytesIO(raw)); writer = PdfWriter()
    page = writer.add_page(reader.pages[0])
    font = next(iter(page['/Resources']['/Font'].values())).get_object()
    desc = font['/DescendantFonts'][0]['/FontDescriptor']
    desc.pop('/FontWeight', None)
    # Exercise absent descriptor hints, as in the generated fonts. The
    # embedded program remains the authoritative source of intrinsic style.
    desc[NameObject('/Flags')] = NumberObject(4)
    desc[NameObject('/ItalicAngle')] = NumberObject(0)
    if weight is not None:
        desc[NameObject('/FontWeight')] = NumberObject(weight)
        desc[NameObject('/StemV')] = NumberObject(182)
    out = io.BytesIO(); writer.write(out)
    return out.getvalue()


def text_object(raw):
    return next(o for o in inspect(raw)['objects'] if o.get('text') == 'ABCD')


class EmbeddedStyleTests(unittest.TestCase):
    def test_bold_italic_and_bold_italic_missing_descriptor_hints(self):
        for bold, italic in [(True, False), (False, True), (True, True)]:
            with self.subTest(bold=bold, italic=italic):
                obj = text_object(pdf(bold, italic))
                data = font_data(obj['fontKey'])
                self.assertEqual((data['fontBold'], data['fontItalic']), (bold, italic))
                self.assertEqual((obj['bold'], obj['italic']), (bold, italic))
                self.assertEqual((obj['fontBold'], obj['fontItalic']), (bold, italic))

    def test_explicit_regular_weight_remains_authoritative(self):
        obj = text_object(pdf(bold=True, weight=400))
        self.assertTrue(font_data(obj['fontKey'])['fontBold'])
        self.assertFalse(obj['fontBold'])
        self.assertFalse(obj['bold'])

    def test_synthetic_bold_and_shear_are_not_intrinsic_styles(self):
        obj = text_object(pdf(synthetic=True, shear=True))
        self.assertFalse(obj['fontBold']); self.assertFalse(obj['fontItalic'])
        self.assertTrue(obj['bold']); self.assertTrue(obj['italic'])
        self.assertEqual(obj['renderMode'], 2); self.assertTrue(obj['syntheticItalic'])

    def test_repeated_real_export_keeps_original_font_and_styles(self):
        raw = pdf(bold=True, italic=True)
        for text in ('BCD', 'CD'):
            result = inspect(raw)
            obj = next(o for o in result['objects'] if o.get('text'))
            self.assertTrue(obj['bold']); self.assertTrue(obj['italic'])
            fd = font_data(obj['fontKey'])
            glyphs = [dict(text=ch, start=i, end=i+1, originX=30+i*13, baseline=60,
                           x=30+i*13, y=40, w=13, h=20, size=20,
                           fontKey=fd['key'], bold=obj['bold'], italic=obj['italic'],
                           fontBold=fd['fontBold'], fontItalic=fd['fontItalic'])
                      for i, ch in enumerate(text)]
            model = dict(text=text, pageWidth=250, pageHeight=150,
                         frame=dict(x=20, y=20, width=210, height=100),
                         fastLayout=dict(version=1, text=text, glyphs=glyphs))
            raw = base64.b64decode(render(model)['fragment'])
            with fitz.open(stream=raw, filetype='pdf') as doc:
                traces = doc[0].get_texttrace()
                self.assertTrue(all(t['font'] == 'StyleAudit-BoldItalic' for t in traces))
                self.assertTrue(all(t['flags'] & 16 and t['flags'] & 2 for t in traces))
                self.assertTrue(all(t['type'] == 0 for t in traces))
                self.assertTrue(all(abs(t['size']-20) < .001 for t in traces))


if __name__ == '__main__':
    unittest.main()

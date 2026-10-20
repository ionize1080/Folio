"""Real subset/reopen regression for shared TrueType advances and stale caches."""
import base64
import hashlib
import io
import json
import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/'tests'), str(ROOT/'native'), str(ROOT/'native/vendor')]
import fitz
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from font_match import CACHE, load_font, populated_coverage, unicode_cmap
from font_metrics import expanded_metrics, restore_cid_advances, subset_fonts
from font_sfnt import tables, build
from fast_layout import font_data, render
from p8_helpers import inspect
from ui_glyph_verification_v191 import assert_cjk_glyph_geometry


def fixture():
    builder = FontBuilder(1000, isTTF=True)
    order = ['.notdef'] + [f'g{i}' for i in range(1, 12)]
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap({ord(c): order[i] for c, i in [('补', 5), ('充', 9), ('康', 11)]})
    glyphs = {}
    for i, name in enumerate(order):
        pen = TTGlyphPen(None)
        pen.moveTo((100, 0)); pen.lineTo((700 + i, 0)); pen.lineTo((700 + i, 700)); pen.lineTo((100, 700)); pen.closePath()
        glyphs[name] = pen.glyph()
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (500 if i == 0 else 1000, 100) for i, name in enumerate(order)})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupNameTable({'familyName': 'SharedWidthTest', 'styleName': 'Regular', 'psName': 'SharedWidthTest'})
    builder.setupPost()
    buf = io.BytesIO(); builder.save(buf)
    return buf.getvalue()


def cache(blob, coverage=None):
    key = hashlib.sha256(blob).hexdigest()[:32]
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE/(key+'.ttf')).write_bytes(blob)
    # Deliberately legacy metadata: the upgrade must work without cache clearing.
    (CACHE/(key+'.json')).write_text(json.dumps({'name': 'SharedWidthTest', 'coverage': coverage or list(fitz.Font(fontbuffer=blob).valid_codepoints())}))
    return key


def anchored(key, text):
    f = font_data(key); glyphs = []; x = 30
    for i, ch in enumerate(text):
        width = f['advances'][str(ord(ch))]*20
        glyphs.append(dict(text=ch, start=i, end=i+1, originX=x, baseline=60, x=x, y=40,
                           w=width, h=20, size=20, fontKey=f['key']))
        x += width
    m = dict(text=text, pageWidth=250, pageHeight=150, frame=dict(x=20, y=20, width=210, height=100),
             fastLayout=dict(version=1, text=text, glyphs=glyphs))
    return base64.b64decode(render(m)['fragment'])


class FontMetricRoundTrip(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.blob = fixture()

    def test_expansion_retains_every_advance_bearing_outline_and_hint(self):
        old, new = tables(self.blob), tables(expanded_metrics(self.blob))
        self.assertLess(struct.unpack_from('>H', old[b'hhea'], 34)[0], 12)
        a, b = TTFont(io.BytesIO(self.blob)), TTFont(io.BytesIO(expanded_metrics(self.blob)))
        self.assertEqual(a['hmtx'].metrics, b['hmtx'].metrics)
        for tag in old.keys()-{b'hmtx', b'hhea', b'head'}:
            self.assertEqual(old[tag], new[tag], tag)

    def test_first_save_reopen_delete_and_second_save_keep_real_positions(self):
        key = cache(self.blob)
        for text in ('补充康', '补充', '充'):
            raw = anchored(key, text)
            assert_cjk_glyph_geometry(raw, 1)
            # Inspect repairs old PDFs. Check the saved font program *before*
            # inspection so recovery cannot mask a missing safe-subset call.
            with fitz.open(stream=raw, filetype='pdf') as doc:
                embedded = doc.extract_font(doc[0].get_fonts()[0][0])[3]
                font = TTFont(io.BytesIO(embedded)); order = font.getGlyphOrder()
                for ch in text:
                    gid = {'补': 5, '充': 9, '康': 11}[ch]
                    self.assertEqual(font['hmtx'].metrics[order[gid]][0], font['head'].unitsPerEm)
                font.close()
            inspected = inspect(raw)
            key = next(o['fontKey'] for o in inspected['objects'] if text[0] in o.get('text', ''))
            fd = font_data(key)
            for ch in text:
                self.assertAlmostEqual(fd['advances'][str(ord(ch))], 1)
            with fitz.open(stream=raw, filetype='pdf') as doc:
                points = [c[2][0] for span in doc[0].get_texttrace() for c in span['chars']]
                self.assertEqual(points, [30+20*i for i in range(len(text))])

    def test_previous_release_pdf_recovers_width_and_rejects_its_stale_cache(self):
        with fitz.open() as doc:
            page = doc.new_page(width=250, height=150)
            page.insert_font(fontname='F', fontbuffer=self.blob)
            for x, ch in zip((30, 50, 70), '补充康'):
                page.insert_text((x, 60), ch, fontname='F', fontsize=20)
            # Reproduce the old shipped native subset path and an already
            # populated v15 cache; the actual PDF /W still proves 1000 units.
            doc.subset_fonts()
            raw = doc.tobytes()
            damaged = doc.extract_font(page.get_fonts()[0][0])[3]
        bad, coverage = unicode_cmap(damaged, {ord(c): g for c, g in [('补', 5), ('充', 9), ('康', 11)]})
        old_key = cache(bad, sorted(coverage))
        self.assertNotIn(ord('补'), load_font(old_key)['coverage'])
        r = inspect(raw)
        new_key = next(o['fontKey'] for o in r['objects'] if '补' in o.get('text', ''))
        self.assertNotEqual(old_key, new_key)
        self.assertEqual(font_data(new_key)['advances'][str(ord('补'))], 1)
        assert_cjk_glyph_geometry(anchored(new_key, '补充'), 1)

    def damaged(self):
        parts = tables(expanded_metrics(self.blob)); raw = bytearray(parts[b'hmtx'])
        for gid in (5, 9):struct.pack_into('>H', raw, gid*4, 0)
        parts[b'hmtx'] = bytes(raw)
        return build(self.blob[:4], parts)

    def test_pdf_width_array_range_and_nonidentity_cid_mapping(self):
        mapping = {ord('补'): 5, ord('充'): 9}
        gids = bytearray(24);struct.pack_into('>H', gids, 2*2, 5);struct.pack_into('>H', gids, 7*2, 9)
        blob = restore_cid_advances(self.damaged(), {'/W': [2, [1000], 7, 7, 1000]}, mapping, bytes(gids))
        face = fitz.Font(fontbuffer=blob)
        self.assertEqual(face.glyph_advance(ord('补')), 1)
        self.assertEqual(face.glyph_advance(ord('充')), 1)

    def test_conflicting_or_unproven_zero_width_is_not_advertised(self):
        mapping = {ord('补'): 5, ord('充'): 9}
        gids = bytearray(24)
        for cid in (2, 3):struct.pack_into('>H', gids, cid*2, 5)
        result = restore_cid_advances(self.damaged(), {'/W': [2, [1000, 900]], '/DW': 0}, mapping, bytes(gids))
        self.assertEqual(result, self.damaged())
        self.assertNotIn(ord('补'), populated_coverage(result, set(mapping)))
        self.assertNotIn(ord('充'), populated_coverage(result, set(mapping)))
        zero = restore_cid_advances(self.damaged(), {'/DW': 0}, mapping)
        self.assertEqual(zero, self.damaged())

    def test_positive_metrics_and_combining_zero_width_are_preserved(self):
        raw, _ = unicode_cmap(self.damaged(), {0x301: 5, ord('充'): 9, ord('康'): 11})
        result = restore_cid_advances(raw, {'/DW': 1000, '/W': [11, [500]]}, {0x301: 5, ord('充'): 9, ord('康'): 11})
        face = fitz.Font(fontbuffer=result)
        self.assertEqual(face.glyph_advance(0x301), 0)
        self.assertEqual(face.glyph_advance(ord('康')), 1)
        self.assertIn(0x301, populated_coverage(result, {0x301}))

    def test_malformed_cid_indices_and_unbounded_repeated_ranges_are_rejected(self):
        for widths in ([5.9, [1000]], [True, [1000]], [5, 5.5, 1000], [0, 65535, 1000, 0, 65535, 1000]):
            with self.assertRaises(ValueError):
                restore_cid_advances(self.damaged(), {'/DW': 0, '/W': widths}, {ord('补'): 5})


if __name__ == '__main__':
    unittest.main()

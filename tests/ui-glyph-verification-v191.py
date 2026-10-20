"""Regression tests for the independent saved-PDF geometry audit."""
from pathlib import Path
import argparse
import json
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
import fitz
from ui_glyph_verification_v191 import audit_cjk_glyph_geometry, assert_cjk_glyph_geometry


def fixture(collapsed=False):
    doc = fitz.open()
    page = doc.new_page(width=300, height=270)
    page.insert_font(fontname='Han', fontfile=str(ROOT / 'native/fonts/NotoSansSC.ttf'))
    page.insert_font(fontname='Latin', fontfile=str(ROOT / 'native/fonts/DejaVuSans.ttf'))
    if collapsed:
        for ch in '补充康':
            page.insert_text((30, 40), ch, fontsize=12, fontname='Han')
    else:
        page.insert_text((30, 40), '补充康', fontsize=12, fontname='Han')
    # Whitespace and a line break are deliberately part of the legal sample.
    page.insert_text((30, 80), '补 充\n康', fontsize=12, fontname='Han')
    # Latin combining accents may share an origin and must not be treated as Han.
    page.insert_text((30, 130), 'e', fontsize=12, fontname='Latin')
    page.insert_text((30, 130), '\u0301', fontsize=12, fontname='Latin')
    # Repeated fill / stroke paint is a valid way to draw a bold Chinese glyph.
    page.insert_text((30, 170), '补充', fontsize=12, fontname='Han', render_mode=2)
    # Same x on another text line is unrelated to a zero-advance defect.
    page.insert_text((30, 210), '康', fontsize=12, fontname='Han')
    raw = doc.tobytes()
    doc.close()
    return raw


class GeometryTests(unittest.TestCase):
    def test_spacing_lines_combining_and_bold_pass(self):
        result = assert_cjk_glyph_geometry(fixture())
        for engine in ('MuPDF', 'PDFium'):
            self.assertGreaterEqual(result[engine]['checkedHanGlyphs'], 9)
            self.assertEqual(result[engine]['collapsedPairCount'], 0)

    def test_distinct_han_at_one_origin_fail_in_both_engines(self):
        raw = fixture(True)
        result = audit_cjk_glyph_geometry(raw)
        for engine in ('MuPDF', 'PDFium'):
            self.assertEqual(len(result[engine]['collapsedPairs']), 3)
            self.assertTrue(all(p['originDistancePoints'] == 0 for p in result[engine]['collapsedPairs']))
        with self.assertRaisesRegex(AssertionError, 'Collapsed standalone Han'):
            assert_cjk_glyph_geometry(raw)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--good', type=Path)
    parser.add_argument('--bad', type=Path)
    args = parser.parse_args()
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(GeometryTests))
    if not result.wasSuccessful():
        raise SystemExit(1)
    if args.good or args.bad:
        assert args.good and args.bad
        good = assert_cjk_glyph_geometry(args.good, 12)
        bad = audit_cjk_glyph_geometry(args.bad, 12)
        assert all(len(bad[e]['collapsedPairs']) == 3 for e in ('MuPDF', 'PDFium'))
        print(json.dumps(dict(firstSave=good, failedSecondSave=bad), indent=2))

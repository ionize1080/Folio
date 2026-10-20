"""The independent style audit rejects real loss of weight, slant and size."""
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from ui_style_verification_v191 import audit_retained_styles, assert_retained_styles
import fitz

spec = importlib.util.spec_from_file_location("style_fixture", ROOT / "tests/font-style-v191.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def pdf(text, drop_bold=False, drop_italic=False, size=20):
    with fitz.open() as doc:
        page = doc.new_page(width=250, height=150)
        for name, bold, italic in (("R", False, False), ("B", True, False), ("I", False, True)):
            page.insert_font(fontname=name, fontbuffer=fixture.font_blob(bold, italic))
        for index, ch in enumerate(text):
            name = "B" if ch in "AB" and not drop_bold else "I" if ch == "D" and not drop_italic else "R"
            page.insert_text((30 + index * 20, 60), ch, fontsize=size, fontname=name)
        return doc.tobytes()


class IndependentStyleAudit(unittest.TestCase):
    def test_retained_mixed_styles_and_outlines_survive_deletion(self):
        result = assert_retained_styles(pdf("ABCD"), pdf("BCD"), 1, "ABCD", "BCD")
        self.assertEqual(result["retainedCharacters"], 3)
        self.assertEqual(result["boldCharacters"], 1)
        self.assertEqual(result["italicCharacters"], 1)
        self.assertEqual(result["outlineCharacters"], 3)
        self.assertEqual(result["outlineUnavailableCharacters"], 0)

    def test_missing_bold_and_italic_are_rejected_from_raw_pdf(self):
        original = pdf("ABCD")
        for option, field in (("drop_bold", "boldDifferences"), ("drop_italic", "italicDifferences")):
            with self.subTest(option=option):
                edited = pdf("BCD", **{option: True})
                result = audit_retained_styles(original, edited, 1, "ABCD", "BCD")
                self.assertEqual(result[field], 1)
                self.assertEqual(result["outlineDifferences"], 1)
                with self.assertRaises(AssertionError):
                    assert_retained_styles(original, edited, 1, "ABCD", "BCD")

    def test_changed_size_is_rejected_even_when_font_outlines_match(self):
        result = audit_retained_styles(pdf("ABCD"), pdf("BCD", size=21), 1, "ABCD", "BCD")
        self.assertEqual(result["sizeDifferences"], 3)
        self.assertEqual(result["outlineDifferences"], 0)
        with self.assertRaises(AssertionError):
            assert_retained_styles(pdf("ABCD"), pdf("BCD", size=21), 1, "ABCD", "BCD")

    def test_inserted_characters_are_not_claimed_as_original_glyphs(self):
        result = assert_retained_styles(pdf("BCD"), pdf("ABCD"), 1, "BCD", "ABCD")
        self.assertEqual(result["retainedCharacters"], 3)
        self.assertEqual(result["boldCharacters"], 1)
        self.assertEqual(result["outlineCharacters"], 3)


if __name__ == "__main__":
    unittest.main()

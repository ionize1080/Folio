"""Keep a generated font's aliases distinct when converting a Story fragment to PDF."""
import io
import sys
import unittest
from pathlib import Path

import fitz
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native"))
from text_semantics import mark_shows


class StoryAliases(unittest.TestCase):
    def test_submit_and_extract_exact_punctuation(self):
        with fitz.open() as source:
            source.new_page().insert_text((20, 30), "A;-B")
            writer = PdfWriter()
            page = writer.add_page(PdfReader(io.BytesIO(source.tobytes())).pages[0])
        font = next(iter(page["/Resources"]["/Font"].values())).get_object()
        cmap = DecodedStreamObject()
        cmap.set_data(b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n"
                      b"1 begincodespacerange\n<00> <FF>\nendcodespacerange\n"
                      b"4 beginbfchar\n<41> <0041>\n<3B> <037E>\n<2D> <00AD>\n<42> <0042>\n"
                      b"endbfchar\nendcmap CMapName currentdict /CMap defineresource pop end end")
        font[NameObject("/ToUnicode")] = writer._add_object(cmap)
        out = io.BytesIO()
        writer.write(out)
        raw = out.getvalue()
        with fitz.open(stream=raw) as before:
            self.assertEqual(before[0].get_text().strip(), "A\u037e\u00adB")
            pixels = before[0].get_pixmap().samples
        for logical in ("A;-B", "A\u037e-B"):
            with fitz.open(stream=mark_shows(raw, logical)) as after:
                self.assertEqual(after[0].get_text(flags=fitz.TEXTFLAGS_TEXT | fitz.TEXT_INHIBIT_SPACES).strip(), logical)
                self.assertEqual(after[0].get_pixmap().samples, pixels)
        self.assertEqual(mark_shows(raw, "X;-B"), raw)


if __name__ == "__main__":
    unittest.main()

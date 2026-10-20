"""Legacy TrueType CID programs retain glyphs, metrics and reusable Unicode maps."""
import io, sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor')]
import fitz
from font_match import unicode_cmap
from font_sfnt import tables

class LegacyTrueType(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.blob=(ROOT/'native/fonts/DejaVuSans.ttf').read_bytes()
        cls.face=fitz.Font(fontbuffer=cls.blob)

    def test_apple_true_signature_keeps_outlines_and_metrics(self):
        original=b'true'+self.blob[4:]
        glyphs={ord(c):self.face.has_glyph(ord(c)) for c in 'AgéΩ'}
        restored,coverage=unicode_cmap(original,glyphs)
        self.assertEqual(restored[:4],b'\0\1\0\0')
        self.assertEqual(coverage,set(glyphs))
        before,after=tables(original),tables(restored)
        for tag in (b'glyf',b'loca',b'hmtx',b'fpgm',b'prep'):
            if tag in before:self.assertEqual(before[tag],after[tag],tag)
        face=fitz.Font(fontbuffer=restored)
        for cp,gid in glyphs.items():
            self.assertEqual(face.has_glyph(cp),gid)
            self.assertAlmostEqual(face.glyph_advance(cp),self.face.glyph_advance(cp),places=6)
        self.assertEqual(face.has_glyph(ord('B')),0)

    def test_reconstructed_code_to_glyph_mapping_is_not_original_cmap(self):
        # A PDF ToUnicode code can name another scalar than a font's old cmap.
        # Recovery must follow the supplied mapping for both legacy and modern sfnt.
        gid=self.face.has_glyph(ord('A'))
        for signature in (b'true',b'\0\1\0\0'):
            blob,coverage=unicode_cmap(signature+self.blob[4:],{0x1f642:gid,ord('B'):0})
            face=fitz.Font(fontbuffer=blob)
            self.assertEqual(coverage,{0x1f642})
            self.assertEqual(face.has_glyph(0x1f642),gid)
            self.assertEqual(face.has_glyph(ord('B')),0)

    def test_unsupported_program_remains_rejected(self):
        with self.assertRaises(ValueError):unicode_cmap(b'typ1'+self.blob[4:],{ord('A'):1})

if __name__=='__main__':unittest.main()

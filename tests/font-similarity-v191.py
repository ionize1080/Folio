"""On-demand outline comparison preserves canonical signatures and font rankings."""
import sys,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor')]
import font_similarity as similarity
from fontTools.ttLib import TTFont

class SampledOutlineFonts(unittest.TestCase):
    def compare(self,path,face,characters):
        stamp=path.stat().st_mtime_ns
        similarity.features.cache_clear();similarity.coverage.cache_clear();similarity._glyph_features.clear()
        # The reference loader is exactly the pre-optimization library path.
        with patch.object(similarity,'outline_font',side_effect=lambda path,face,sampled=False:TTFont(path,fontNumber=face,lazy=True)):
            expected=similarity.features(str(path),face,stamp,characters)
        similarity.features.cache_clear();similarity.coverage.cache_clear();similarity._glyph_features.clear()
        actual=similarity.features(str(path),face,stamp,characters)
        self.assertEqual(actual,expected)

    def test_latin_and_composite_signatures_and_metrics(self):
        self.compare(ROOT/'native/fonts/DejaVuSans.ttf',0,'AgéÅǽΩﬁ')

    def test_cjk_signatures_and_metrics(self):
        self.compare(ROOT/'native/fonts/NotoSansSC.ttf',0,'一中段检查字体，。')

    def test_collection_face_and_names_do_not_affect_identity(self):
        path=Path('C:/Windows/Fonts/simsun.ttc')
        if not path.exists():self.skipTest('Windows collection fixture unavailable')
        for face in (0,1):self.compare(path,face,'一中段检查字体，。')

    def test_variable_font_default_instance_keeps_signatures(self):
        path=Path('C:/Windows/Fonts/bahnschrift.ttf')
        if not path.exists():self.skipTest('Windows variable font fixture unavailable')
        self.compare(path,0,'AgéÅΩ')

    def test_composite_glyphs_load_only_used_components(self):
        font=similarity.outline_font(str(ROOT/'native/fonts/DejaVuSans.ttf'),0,sampled=True)
        try:
            glyphs=font['glyf'].glyphs
            self.assertEqual(len(glyphs.cache),0)
            from fontTools.pens.recordingPen import DecomposingRecordingPen
            name=font.getBestCmap()[ord('é')];gs=font.getGlyphSet();pen=DecomposingRecordingPen(gs);gs[name].draw(pen)
            self.assertGreater(len(glyphs.cache),1)
            self.assertLess(len(glyphs.cache),10)
        finally:font.close()

if __name__=='__main__':unittest.main()

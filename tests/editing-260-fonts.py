"""Cross-process cache reuse keeps exact coverage and tolerates stale metadata."""
import io,json,pathlib,sys,tempfile,time,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor')]
import font_similarity as sim,system_fonts,font_match,fast_layout

class FontMapping260(unittest.TestCase):
    def test_indexed_coverage_matches_full_outline_decoder(self):
        import fitz,unicodedata
        from fontTools.ttLib import TTFont
        for name in ('DejaVuSans.ttf','NotoSansSC.ttf'):
            blob=(ROOT/'native/fonts'/name).read_bytes();requested=set(fitz.Font(fontbuffer=blob).valid_codepoints())
            font=TTFont(io.BytesIO(blob));cmap=font.getBestCmap() or {};glyphs=font['glyf'];metrics=font['hmtx'].metrics
            reference={cp for cp in requested if cp in cmap and (unicodedata.category(chr(cp))[0] in ('M','Z','C') or metrics.get(cmap[cp],(0,0))[0]!=0 and glyphs[cmap[cp]].numberOfContours!=0)}
            self.assertEqual(font_match._populated_coverage(blob,requested),reference);font.close()

    def test_rankings_survive_process_cache_clear_and_filter_each_new_character(self):
        with tempfile.TemporaryDirectory() as folder,patch.dict('os.environ',{'FOLIO_FONT_MATCH_CACHE':folder}):
            import fitz,hashlib
            from font_cache import publish_font
            path=ROOT/'native/fonts/DejaVuSans.ttf';blob=path.read_bytes();key=hashlib.sha256(blob).hexdigest()[:32]
            coverage=sorted(font_match.populated_coverage(blob,fitz.Font(fontbuffer=blob).valid_codepoints()))
            publish_font(font_match.CACHE,key,blob,{'name':'DejaVu Sans','coverage':coverage,'coverageVersion':2})
            item={'id':'fixture','path':str(path),'face':0,'name':'DejaVu Sans','family':'DejaVu Sans','source':'fixture'}
            with patch.object(system_fonts,'catalog',return_value={'fixture':item}):
                sim.rank_fonts.cache_clear();sim.recommend.cache_clear();first=sim.recommend(key,'B')
                self.assertEqual(first[0]['id'],'fixture')
                sim.rank_fonts.cache_clear();sim.recommend.cache_clear();sim.features.cache_clear()
                with patch.object(sim,'features',side_effect=AssertionError('cached scores were recomputed')):
                    self.assertEqual(sim.recommend(key,'Ω'),first)
                    self.assertEqual(sim.recommend(key,'\u2dff'),[])
                path=next(pathlib.Path(folder).glob('ranking-*'));path.write_text('{"version":2,"fonts":[{}]}')
                sim.rank_fonts.cache_clear();sim.recommend.cache_clear()
                self.assertEqual(sim.recommend(key,'B'),first)

    def test_browser_normalization_is_shared_without_skipping_fresh_validation(self):
        with tempfile.TemporaryDirectory() as folder,patch.dict('os.environ',{'FOLIO_FONT_MATCH_CACHE':folder}):
            fast_layout.font_data.cache_clear()
            first=fast_layout.font_data('builtin-latin')
            fast_layout.font_data.cache_clear()
            with patch('browser_fonts.opentype',side_effect=AssertionError('validated font normalized again')):
                second=fast_layout.font_data('builtin-latin')
            self.assertEqual(first,second)
            self.assertTrue(font_match.load_font(first['key']).get('browserReadyVersion'))

if __name__=='__main__':unittest.main()

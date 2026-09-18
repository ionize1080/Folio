"""Behavioral regression: different new characters reuse a compatible full font."""
import sys, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
import font_similarity as sim
class FontReuse(unittest.TestCase):
 def setUp(self):sim.fallback.cache_clear();sim._fallback_faces.clear()
 def test_coverage_and_font_identity(self):
  a={'name':'A','path':'a','coverage':{ord(c) for c in '新增字'}}
  b={'name':'B','path':'b','coverage':{ord('稀')}}
  def rank(key,ch):return [{'id':'b' if ch=='稀' else 'a','match':'字形相近','score':.9,'confidence':'中'}]
  with patch.object(sim,'recommend',side_effect=rank) as recommend,patch('system_fonts.select_font',side_effect=lambda x:{'fontKey':x}) as select,patch.object(sim,'load_font',side_effect=lambda x:{'a':a,'b':b}[x]):
   self.assertEqual(sim.fallback('source','新')['name'],'A')
   self.assertEqual(sim.fallback('source','增')['name'],'A')
   self.assertEqual(sim.fallback('source','字')['name'],'A')
   self.assertEqual(recommend.call_count,1);self.assertEqual(select.call_count,1)
   self.assertEqual(sim.fallback('source','稀')['name'],'B')
   self.assertEqual(recommend.call_count,2)
   sim.fallback('different-source','新');self.assertEqual(recommend.call_count,3)
 def test_missing_result_and_uncovered_selection(self):
  with patch.object(sim,'recommend',return_value=[]):self.assertIsNone(sim.fallback('source','新'))
  sim.fallback.cache_clear()
  with patch.object(sim,'recommend',return_value=[{'id':'bad'}]),patch('system_fonts.select_font',return_value={'fontKey':'bad'}),patch.object(sim,'load_font',return_value={'coverage':set()}):
   self.assertIsNone(sim.fallback('source','新'))
if __name__=='__main__':unittest.main()

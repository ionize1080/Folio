import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
import numpy as np
from ocr_diagnostics import choose_candidate, oriented_quad, crosses_rule

class OCRDiagnostics(unittest.TestCase):
 def test_longer_evidence_beats_short_high_score(self):
  a={'text':'年','score':.99,'rotation':180};b={'text':'2020年工程监理月报','score':.9,'rotation':0}
  self.assertIs(choose_candidate(a,b),b)
  self.assertIs(choose_candidate(b,{'text':'字','score':1,'rotation':180}),b)
 def test_no_low_score_hallucination_or_digit_flip(self):
  a={'text':'6','score':.99,'rotation':0}
  self.assertIs(choose_candidate(a,{'text':'9','score':1,'rotation':180}),a)
  self.assertIs(choose_candidate(a,{'text':'乱七八糟内容','score':.2,'rotation':180}),a)
 def test_quad_follows_crop_rotation(self):
  q=[[0,0],[10,0],[10,50],[0,50]]
  self.assertEqual(oriented_quad(q,True,False),[q[1],q[2],q[3],q[0]])
  self.assertEqual(oriented_quad(q,True,True),[q[3],q[0],q[1],q[2]])
  self.assertEqual(oriented_quad(q,False,True),[q[2],q[3],q[0],q[1]])
 def test_cell_separator_requires_full_height(self):
  img=np.full((30,200,3),255,dtype=np.uint8);img[:,90:92]=0
  self.assertTrue(crosses_rule(img));img[:]=255;img[8:23,90:92]=0
  self.assertFalse(crosses_rule(img))

if __name__=='__main__':unittest.main()

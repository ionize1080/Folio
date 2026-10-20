"""Source PDF Tc/Tw cancellation is valid when used advances remain nonnegative."""
import sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor')]
from story import layout

def model(text,spacing=9,word=-9):
    return dict(text=text,softBreaks=[],sources=[],pageWidth=500,pageHeight=300,
        frame=dict(x=30,y=30,width=440,height=230),size=18,lineHeight=1.4,
        paragraphGap=0,columns=1,gap=18,align='left',color='#202020',font='sans',
        layoutMode='reflow',runs=[],charSpacing=spacing,wordSpacing=word)

class WordTracking(unittest.TestCase):
    def test_source_tracking_without_spaces(self):
        r=layout(model('瑜忌督幔寨擂呐弩丞'))
        self.assertTrue(r['mappingComplete']);self.assertFalse(r['overflow'])
    def test_tracking_cancels_only_added_space_advance(self):
        r=layout(model('词语 练习'))
        self.assertTrue(r['mappingComplete']);self.assertFalse(r['overflow'])
    def test_negative_actual_space_advance_remains_rejected(self):
        with self.assertRaisesRegex(ValueError,'字符宽度'):layout(model('AB CD',spacing=0))
    def test_unbounded_and_nonfinite_word_spacing_remain_rejected(self):
        for word in (-1000,float('inf'),float('nan')):
            with self.assertRaises(ValueError):layout(model('中文',word=word))

if __name__=='__main__':unittest.main()

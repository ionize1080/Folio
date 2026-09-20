"""Real unembedded resource -> inspect -> font resolution -> Story coverage."""
import sys, io, tempfile, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
import fitz, worker
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject
from font_resolver import resolve_name, normalized
from font_match import load_font

class FontResolution(unittest.TestCase):
 def test_unknown_and_styles(self):
  self.assertIsNone(resolve_name('UnknownSerifXYZ'))
  self.assertEqual(normalized('ABCDEF+Times New Roman'), 'timesnewroman')
  a=resolve_name('TimesNewRomanPSMT');b=resolve_name('TimesNewRomanPS-BoldMT')
  self.assertIsNotNone(a);self.assertNotEqual(a['fontKey'],b['fontKey'])
  font=load_font(a['fontKey']); self.assertTrue(set(map(ord,'0123456789()')).issubset(font['coverage']))
  f=fitz.Font(fontfile=font['path']);self.assertAlmostEqual(f.text_length('2015',fontsize=1000),2000,delta=1)
 def test_unembedded_resource(self):
  doc=fitz.open();p=doc.new_page();p.insert_text((40,60),'2015 (00123)',fontname='tiro')
  reader=PdfReader(io.BytesIO(doc.tobytes()));font=next(iter(reader.pages[0]['/Resources']['/Font'].values())).get_object()
  font[NameObject('/BaseFont')]=NameObject('/TimesNewRomanPSMT')
  out=io.BytesIO();w=PdfWriter();w.add_page(reader.pages[0]);w.write(out)
  with tempfile.TemporaryDirectory() as td:
   path=Path(td)/'missing.pdf';path.write_bytes(out.getvalue())
   result=worker.run({'command':'inspect','input':str(path),'page':1})
  runs=[o for o in result['objects'] if o['type']=='text']
  self.assertTrue(runs);self.assertTrue(all(o.get('fontKey') for o in runs))
  self.assertTrue(all(o['fontResolution'] in ('system-name','metric-substitute') for o in runs))
 def test_system_name(self):
  r=resolve_name('DejaVuSans');self.assertEqual(r['fontResolution'],'system-name')

if __name__=='__main__':unittest.main()

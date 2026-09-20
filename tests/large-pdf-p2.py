import sys, unittest, tempfile, hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
import fitz
from large_pdf import process

class LargePDF(unittest.TestCase):
 def test_incremental_copy_preserves_actions_and_content(self):
  with tempfile.TemporaryDirectory() as td:
   src=Path(td)/'source.pdf';out=Path(td)/'saved.pdf'
   d=fitz.open()
   for i in range(3):d.new_page().insert_text((40,60),f'Yearbook page {i+1}')
   d.set_toc([[1,'Chapter',1],[2,'Child',2],[1,'External',3]])
   refs=d.get_outline_xrefs();d.xref_set_key(refs[2],'A','<< /S /URI /URI (https://example.com) >>');d.xref_set_key(refs[2],'Dest','null')
   d.save(src);d.close();before=src.read_bytes()
   info=process({'command':'large-info','input':str(src)})
   rows=info['outlines'];rows[0]['title']='第一章';rows[1]['page']=3
   rows.append({'id':'new-extra','level':1,'title':'New','page':2})
   result=process({'command':'large-save','input':str(src),'output':str(out),'outlines':rows})
   self.assertTrue(result['verified']);self.assertEqual(src.read_bytes(),before)
   self.assertTrue(out.read_bytes().startswith(before))
   with fitz.open(out) as d:
    self.assertEqual(d[1].get_text().strip(),'Yearbook page 2')
    self.assertIn('https://example.com',d.xref_object(refs[2]))
   page=process({'command':'large-page','input':str(src),'page':2,'scale':1})
   self.assertTrue(page['image']);self.assertIn('Yearbook page 2',page['lines'][0]['text'])
 def test_invalid_hierarchy_never_creates_output(self):
  with tempfile.TemporaryDirectory() as td:
   src=Path(td)/'in.pdf';out=Path(td)/'out.pdf';d=fitz.open();d.new_page();d.save(src);d.close()
   with self.assertRaises(ValueError):process({'command':'large-save','input':str(src),'output':str(out),'outlines':[{'id':'new-x','level':2,'title':'x','page':1}]})
   self.assertFalse(out.exists())
 def test_password_and_preserved_encryption(self):
  with tempfile.TemporaryDirectory() as td:
   src=Path(td)/'protected.pdf';out=Path(td)/'copy.pdf';d=fitz.open();d.new_page();d.save(src,encryption=fitz.PDF_ENCRYPT_AES_256,user_pw='reader',owner_pw='owner');d.close()
   with self.assertRaisesRegex(ValueError,'密码'):process({'command':'large-info','input':str(src)})
   process({'command':'large-save','input':str(src),'output':str(out),'password':'owner','outlines':[{'id':'new-p','level':1,'title':'Protected','page':1}]})
   with fitz.open(out) as check:self.assertTrue(check.needs_pass);self.assertTrue(check.authenticate('reader'));self.assertEqual(check.get_toc()[0][1],'Protected')
 def test_sparse_pdf_over_4g_metadata(self):
  # Valid unreferenced stream crosses 32-bit offsets, without allocating its size.
  with tempfile.TemporaryDirectory() as td:
   src=Path(td)/'over4g.pdf';offsets={};size=4*1024**3+1024
   with src.open('wb') as f:
    f.write(b'%PDF-1.7\n');offsets[4]=f.tell();f.write(f'4 0 obj\n<< /Length {size} >>\nstream\n'.encode());start=f.tell();f.seek(start+size);f.write(b'\nendstream\nendobj\n')
    for n,obj in [(1,'<< /Type /Catalog /Pages 2 0 R >>'),(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>')]:
     offsets[n]=f.tell();f.write(f'{n} 0 obj\n{obj}\nendobj\n'.encode())
    xref=f.tell();f.write(b'xref\n0 5\n0000000000 65535 f \n')
    for n in range(1,5):f.write(f'{offsets[n]:010d} 00000 n \n'.encode())
    f.write(f'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
   self.assertGreater(src.stat().st_size,4*1024**3)
   result=process({'command':'large-info','input':str(src)});self.assertEqual(result['pages'],1)
   result=process({'command':'large-page','input':str(src),'page':1,'scale':.5});self.assertTrue(result['image'])

if __name__=='__main__':unittest.main()

import sys,io,base64,json,zipfile
from pathlib import Path
sys.path.insert(0,'native')
import fitz,pikepdf
from pypdf import PdfReader
from document_utilities import process
out=Path('tests/output');out.mkdir(exist_ok=True)
source=out/'utilities-source.pdf';d=fitz.open();p=d.new_page();p.insert_text((60,60),'Document utility preservation benchmark');d.set_toc([[1,'Chapter',1]]);d.save(source);d.close()
def run(action,options={},input=source):
 r=process({'input':str(input),'action':action,'options':options})
 if 'bytes' in r:
  f=out/('utilities-'+action+'.'+r['extension']);f.write_bytes(base64.b64decode(r['bytes']));return f
 return r
meta=run('metadata',{'fields':{'Title':'Custom title','Creator':'Custom creator','Producer':'Custom producer','CustomKey':'custom value'}})
with pikepdf.open(meta) as p:
 assert str(p.docinfo['/Producer'])=='Custom producer';assert str(p.docinfo['/CustomKey'])=='custom value'
 assert p.open_metadata()['pdf:Producer']=='Custom producer'
for action in ['linearize','compress']:
 f=run(action)
 with fitz.open(f) as p:assert p.get_toc()==[[1,'Chapter',1]];assert 'preservation' in p[0].get_text()
f=run('encrypt',{'ownerPassword':'test-owner','userPassword':'test-reader'})
try:pikepdf.open(f);raise AssertionError('No password accepted')
except pikepdf.PasswordError:pass
with pikepdf.open(f,password='test-reader') as p:assert p.is_encrypted
f=run('create-form',{'fields':[{'name':'name','page':1,'rect':[60,100,260,130]}]})
assert 'name' in PdfReader(f).get_fields()
f=run('fill',{'fields':{'name':'Filled value'}},f)
assert PdfReader(f).get_fields()['name']['/V']=='Filled value'
with fitz.open(f) as p:assert next(p[0].widgets()).field_value=='Filled value'
f=run('export-images',{'pages':[1],'dpi':100})
with zipfile.ZipFile(f) as z:assert z.namelist()==['page-0001.png'];assert z.read(z.namelist()[0]).startswith(b'\x89PNG')
f=run('export-text');assert 'preservation' in f.read_text()
for mode in ['reader','original']:
 with fitz.open(out/('web-'+mode+'.pdf')) as p:
  text=''.join(page.get_text() for page in p)
  assert all('Paragraph '+str(i) in text for i in range(18))
  assert ('UNWANTED NAVIGATION' in text)==(mode=='original')
(out/'document-utilities-report.json').write_text(json.dumps({'status':'passed','checks':['metadata','linearize','compress','encrypt','create-form','fill','export-images','export-text','reader-content']}))
print('PASS document utilities and web text preservation')

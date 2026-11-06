"""Public multi-column research corpus, editable Office round-trip and legacy slides."""
import sys,pathlib,hashlib,urllib.request,json,base64
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz
from document_utilities import process
OUT=ROOT/'tests/output';OUT.mkdir(exist_ok=True)
paper=OUT/'attention-paper.pdf';expected='bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697'
if not paper.exists():
 with urllib.request.urlopen('https://arxiv.org/pdf/1706.03762',timeout=90) as r:paper.write_bytes(r.read())
assert hashlib.sha256(paper.read_bytes()).hexdigest()==expected
checks=[]
for action in ('export-word','export-excel'):
 r=process({'input':str(paper),'action':action,'options':{'pages':[1,5,6],'layout':'faithful'}})
 output=OUT/('public-research.'+r['extension']);output.write_bytes(base64.b64decode(r.pop('bytes')));checks.append(r)
 if action=='export-word':
  assert r['metrics']['textCoverage']>=.98
  rendered=process({'input':str(output),'action':'import-office','options':{'extension':'docx'}})
  roundtrip=OUT/'public-word-roundtrip.pdf';roundtrip.write_bytes(base64.b64decode(rendered['bytes']))
  with fitz.open(roundtrip) as pdf:
   assert 1<=len(pdf)<=6
   assert 'Attention' in pdf[0].get_text()
   pdf[0].get_pixmap(matrix=fitz.Matrix(1.2,1.2)).save(OUT/'public-word-roundtrip.png')
  with fitz.open(paper) as pdf:pdf[0].get_pixmap(matrix=fitz.Matrix(1.2,1.2)).save(OUT/'public-word-original.png')
slides_results=[]
for name,sha in {'basic_test_ppt_file.ppt': 'e8fd4c38ad72ce3735acbca0b60dd5870fb60f819c169e3947d166f4f1bcc79d', 'SampleShow.pptx': 'bfb4b2f07c9233afd2f32aa5781d849d0c7d225bf03721a10becf487b481d828'}.items():
 slides=OUT/name
 if not slides.exists():
  with urllib.request.urlopen('https://raw.githubusercontent.com/apache/poi/trunk/test-data/slideshow/'+name,timeout=90) as r:slides.write_bytes(r.read())
 assert hashlib.sha256(slides.read_bytes()).hexdigest()==sha
 r=process({'input':str(slides),'action':'import-office','options':{'extension':slides.suffix[1:]}});dest=OUT/(slides.stem+'.pdf');dest.write_bytes(base64.b64decode(r['bytes']))
 with fitz.open(dest) as pdf:assert len(pdf)==2
 slides_results.append({'file':name,'sha256':sha,'pages':2})
(OUT/'conversion-public-report.json').write_text(json.dumps({'status':'passed','paperSha256':expected,'checks':checks,'officeRoundTrip':True,'presentations':slides_results,'knownLimitations':['Apache POI pictures.ppt with legacy mixed image objects cannot be opened by LibreOffice 26.2.7; reported explicitly, no blank PDF emitted.']},indent=2),encoding='utf-8')
print('PASS public research Word/Excel, Word render round-trip, PPT/PPTX import')

"""Independently verify the PDF saved by real hosted model/tool calls."""
from pathlib import Path
import json
import fitz
from pypdf import PdfReader
out=Path('tests/output');file=out/'graphics-220-live.pdf'
r=PdfReader(file);assert len(r.pages)==2
images=[];shadings=[];forms=[]
def visit(resources):
 for _,ref in resources.get('/XObject',{}).items():
  o=ref.get_object()
  if o.get('/Subtype')=='/Image':images.append(o)
  elif o.get('/Subtype')=='/Form':
   forms.append(o)
   visit(o.get('/Resources',{}))
 for _,ref in resources.get('/Shading',{}).items():shadings.append(ref.get_object())
visit(r.pages[1]['/Resources'])
assert len([i for i in images if i['/Width']>=512 and i['/Height']>=512])>=2
assert any(s['/ShadingType'] in (2,3) for s in shadings),'native gradient missing'
assert any('/FolioSVG' in f for f in forms),'editable SVG source missing'
with fitz.open(file) as d:
 p=d[1];p.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(out/'graphics-220-live-page.png')
 assert len(p.get_images())>=2
report=json.loads((out/'graphics-220-live.json').read_text())
report['savedPDF']={'pages':len(r.pages),'images':len(images),'nativeShadings':len(shadings),'editableForms':len(forms)}
(out/'graphics-220-live.json').write_text(json.dumps(report,indent=2))
print('PASS independent saved PDF: images, native shading, editable vector source and rendered page')

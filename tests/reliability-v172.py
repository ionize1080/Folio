"""Native content preservation and pre-decode limits using real PDF files."""
from pathlib import Path
import base64, io, json, sys, copy, struct, zlib
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz,worker,pypdfium2 as pdfium
from PIL import Image
from pypdf import PdfReader,PdfWriter
from pypdf.generic import NameObject as N,DecodedStreamObject,ArrayObject as A,FloatObject as F
OUT=ROOT/'tests/output';OUT.mkdir(exist_ok=True);checks=[]
# A separate same-style checkmark inside the table must survive another cell edit.
import runpy
runpy.run_path(str(ROOT/'tests/fixture-v9.py'))
with fitz.open(OUT/'v9-fixture.pdf') as source,fitz.open() as table:
 for _ in range(3):table.insert_pdf(source)
 table[0].draw_polyline([(490,412),(498,421),(514,398)],color=(.3,.35,.4),width=.5)
 table.save(OUT/'v172-table.pdf')

def call(raw,command,**kw):return worker.run(dict(command=command,bytes=base64.b64encode(raw).decode(),**kw))
def apply(raw,edits):return base64.b64decode(call(raw,'apply',edits=edits)['bytes'])
def dump(w):
 b=io.BytesIO();w.write(b);return b.getvalue()
def pixels(raw,n=0):
 with fitz.open(stream=raw,filetype='pdf') as d:return d[n].get_pixmap().samples
# Small inherited rectangle: original ink fits, longer replacement must not be silently clipped.
d=fitz.open();p=d.new_page(width=300,height=300);p.insert_text((30,60),'Old',fontsize=12)
w=PdfWriter();p=w.add_page(PdfReader(io.BytesIO(d.tobytes())).pages[0]);st=DecodedStreamObject();st.set_data(b'q 20 225 65 35 re W n\n'+p.get_contents().get_data()+b'\nQ');p[N('/Contents')]=w._add_object(st);raw=dump(w)
obj=next(o for o in call(raw,'inspect',page=1)['objects'] if o['type']=='text');assert obj['flowEditable'] and obj['clipBounds']
for text,expected in [('New',True),('This replacement is outside the inherited clip',False)]:
 frag=fitz.open();p=frag.new_page(width=300,height=300);p.insert_text((30,60),text,fontsize=12)
 edit=dict(page=1,type='flow',sources=[dict(index=obj['index'],signature=obj['signature'])],model=dict(text=text),fragment=base64.b64encode(frag.tobytes()).decode())
 if expected:
  saved=apply(raw,[edit]);assert 'New' in fitz.open(stream=saved,filetype='pdf')[0].get_text()
 else:
  for cmd in ['apply','flow-background']:
   try:call(raw,cmd,page=1,edits=[edit]);raise AssertionError('clipped replacement accepted')
   except ValueError as error:assert '裁剪边界' in str(error)
for edit in [dict(obj,page=1,text='This generic replacement extends beyond clip'),dict(obj,page=1,matrix=[1,0,0,1,130,240],objectStyle={'scale':1})]:
 try:apply(raw,[edit]);raise AssertionError('generic clipped text edit accepted')
 except ValueError as error:assert '裁剪边界' in str(error)
# Equal-advance digits can still have wider ink; the original-font fast path
# must measure the candidate without clipping, rather than trusting advances.
from p8_helpers import models as edit_models, save as save_model
d=fitz.open();p=d.new_page(width=300,height=300);p.insert_text((30,60),'1',fontsize=12)
base=d.tobytes();digit=call(base,'inspect',page=1)['objects'][0];x0,y0,x1,y1=digit['bounds']
w=PdfWriter();p=w.add_page(PdfReader(io.BytesIO(base)).pages[0]);st=DecodedStreamObject()
st.set_data(f'q {x0-.05} {y0-1} {x1-x0+.1} {y1-y0+2} re W n\n'.encode()+p.get_contents().get_data()+b'\nQ');p[N('/Contents')]=w._add_object(st);narrow=dump(w)
_,digit_models=edit_models(narrow);assert len(digit_models)==1
model=digit_models[0];model['text']='8'
try:save_model(narrow,model);raise AssertionError('equal-width glyph escaped clip')
except ValueError as error:assert '裁剪边界' in str(error)
checks.append('Inherited rectangular clip: inside replacement succeeds, overflowing paragraph, generic text and object transform reject with preserved source')
# Replacement on mixed text/image page remains editable through three cold reopens, all fit modes.
im=Image.new('RGB',(80,40),'red');b=io.BytesIO();im.save(b,format='PNG');image=b.getvalue()
im=Image.new('RGB',(40,80),'blue');b=io.BytesIO();im.save(b,format='PNG');replacement=base64.b64encode(b.getvalue()).decode()
d=fitz.open();p=d.new_page(width=300,height=300);p.insert_text((30,40),'Keep this text');xref=p.insert_image(fitz.Rect(40,80,200,200),stream=image);p=d.new_page(width=300,height=300);p.insert_image(fitz.Rect(40,80,200,200),xref=xref);raw=d.tobytes()
fixture=fitz.open();fp=fixture.new_page(width=300,height=300);fp.insert_text((30,40),'Two image targets');fp.insert_image(fitz.Rect(30,70,120,170),stream=image);fp.insert_image(fitz.Rect(170,70,260,170),stream=image);fixture.save(OUT/'v172-images.pdf');fixture.close();(OUT/'v172-replacement.png').write_bytes(base64.b64decode(replacement))
for mode in ['contain','cover','stretch']:
 current=raw
 for cycle in range(3):
  o=next(o for o in call(current,'inspect',page=1)['objects'] if o['type']=='image');assert o['editable'],(mode,cycle)
  current=apply(current,[dict(o,page=1,imageData=replacement,imageFit=mode)])
  assert pixels(current,1)==pixels(raw,1)
  with fitz.open(stream=current,filetype='pdf') as out:assert 'Keep this text' in out[0].get_text()
 checks.append('Mixed-page replacement cold-reopens editable for 3 cycles: '+mode+'; shared sibling pixels and text preserved')
# Header-only malicious dimensions fail before any image pixel decode.
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',40000,1,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0'+b'\0'*120000))+chunk(b'IEND',b'')
encoded=base64.b64encode(png).decode();o=next(o for o in call(raw,'inspect',page=1)['objects'] if o['type']=='image')
for changes in [{},{'adjustments':{'contrast':10}},{'perspective':[[0,0],[1,0],[1,1],[0,1]]}]:
 try:apply(raw,[dict(o,page=1,imageData=encoded,**changes)]);raise AssertionError('oversized image accepted')
 except ValueError as error:assert '预算' in str(error)
checks.append('Neutral/adjusted/perspective replacement share pre-decode dimensions budget')
(OUT/'v172-native-report.json').write_text(json.dumps(dict(platform=sys.platform,checks=checks,errors=[]),indent=2));print(json.dumps(dict(checks=checks,errors=[])))

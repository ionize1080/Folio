"""P8 full-resolution image instance, edit contracts and native pipeline regression."""
from pathlib import Path
import sys,io,json,base64,copy
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz,worker,pypdfium2 as pdfium
from PIL import Image,ImageDraw,ImageChops
from pypdf import PdfReader,PdfWriter
from pypdf.generic import DictionaryObject as D,NameObject as N,NumberObject as I,ContentStream,DecodedStreamObject as Stream,ArrayObject as A,FloatObject as F
from image_adjustments import process,validate,read_image
OUT=ROOT/'tests/output';OUT.mkdir(exist_ok=True);checks=[]
def call(raw,command,**kw):return worker.run({'command':command,'bytes':base64.b64encode(raw).decode(),**kw})
def apply(raw,edit):return base64.b64decode(call(raw,'apply',edits=[edit])['bytes'])
def bitmap(raw,page=0):
 with fitz.open(stream=raw,filetype='pdf') as d:return d[page].get_pixmap().samples
im=Image.new('RGBA',(600,800),(230,225,208,255));draw=ImageDraw.Draw(im)
for y in range(50,650,60):draw.text((30,y),'SCAN 2026 -12.50 0007 ABCD',fill=(40,40,40,255));draw.line((30,y+25,570,y+25),fill=(80,80,80,255))
draw.rectangle((450,50,580,180),fill=(120,60,180,128));buf=io.BytesIO();im.save(buf,format='PNG')
d=fitz.open();p=d.new_page(width=300,height=400);xref=p.insert_image(p.rect,stream=buf.getvalue());p=d.new_page(width=300,height=400);p.insert_image(p.rect,xref=xref);raw=d.tobytes();d.close();(OUT/'p8-scan.pdf').write_bytes(raw)
object=call(raw,'inspect',page=1)['objects'][0];assert object['editable']
# Identity, all effects, source alpha and monochrome fine marks.
assert process(im,{}).tobytes()==im.tobytes()
for options in [{'brightness':20},{'contrast':40},{'black':10,'white':240,'gamma':1.2},{'curves':[[0,0],[64,40],[192,215],[255,255]]},{'blur':1.5},{'sharpen':150},{'preset':'scan-color'},{'preset':'scan-gray'}]:
 source_image=read_image(PdfReader(io.BytesIO(raw)).pages[0],([N('/fzImg0')],b'Do'))
 processed=process(source_image,options);assert processed.size==im.size;assert processed.getchannel('A').tobytes()==source_image.getchannel('A').tobytes()
 edited=apply(raw,{**object,'page':1,'adjustments':options});assert bitmap(raw,1)==bitmap(edited,1)
 with fitz.open(stream=edited,filetype='pdf') as out:assert len(out)==2
 again=call(edited,'inspect',page=1);assert any(o['type']=='image' and o['editable'] for o in again['objects'])
 preview=call(raw,'image-preview',page=1,index=object['index'],adjustments=options);assert sum(preview['histogram'])==600*800
 visible=Image.open(io.BytesIO(base64.b64decode(preview['preview'])));assert visible.tobytes()==processed.tobytes()
checks.append('Eight image adjustments: identity, shared-image isolation, alpha, exact preview/export processing, reopen editable')
# Three successive edits preserve the sibling page; source pixels are not modified.
current=raw
for contrast in [10,-10,15]:
 obj=next(o for o in call(current,'inspect',page=1)['objects'] if o['type']=='image');current=apply(current,{**obj,'page':1,'adjustments':{'contrast':contrast}});assert bitmap(current,1)==bitmap(raw,1)
(OUT/'p8-scan-adjusted.pdf').write_bytes(current)
checks.append('Three save/reopen image adjustment cycles keep page count and shared sibling pixels')
# Cropping keeps original image resource and visible sibling; invalid crop/parameters reject.
cropped=apply(raw,{**object,'page':1,'crop':[10,15,5,0],'adjustments':{'contrast':20}});assert bitmap(cropped,1)==bitmap(raw,1)
for options in [{'black':200,'white':100},{'blur':float('nan')},{'curves':[[0,0],[0,100],[255,255]]},{'contrast':True}]:
 try:validate(options);raise AssertionError('invalid adjustment accepted')
 except ValueError:pass
try:apply(raw,{**object,'page':1,'crop':[60,0,60,0]});raise AssertionError('invalid crop accepted')
except ValueError:pass
checks.append('Crop and parameter validation reject invalid ranges, NaN and duplicate curve inputs')
# Tagged catalog + otherwise plain wrapper: extracting page may not change capability.
d=fitz.open();p=d.new_page(width=300,height=400);p.insert_text((30,60),'Tagged scope');source=PdfReader(io.BytesIO(d.tobytes())).pages[0]
w=PdfWriter();pg=w.add_blank_page(width=300,height=400);form=Stream();form.set_data(source.get_contents().get_data());form.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Form'),N('/BBox'):A([I(0),I(0),I(300),I(400)]),N('/Resources'):source['/Resources'].clone(w)})
pg[N('/Resources')]=D({N('/XObject'):D({N('/F'):w._add_object(form)})});st=Stream();st.set_data(b'/F Do');pg[N('/Contents')]=w._add_object(st);w._root_object[N('/StructTreeRoot')]=w._add_object(D({N('/Type'):N('/StructTreeRoot')}));b=io.BytesIO();w.write(b);tagged=b.getvalue()
inspection=call(tagged,'inspect',page=1);assert not inspection['editSummary']['editableTextObjects']
preview=base64.b64decode(call(tagged,'flow-background',page=1,edits=[],ocr=[])['pdf']);assert bitmap(preview)==bitmap(tagged)
# A source-index that refers to the protected Form must fail in both paths.
bad={'page':1,'type':'flow','sources':[{'index':0,'signature':inspection['objects'][0]['signature']}],'model':{'text':''},'fragment':''}
for command in ['apply','flow-background']:
 try:call(tagged,command,page=1,edits=[bad]);raise AssertionError('protected Form accepted')
 except ValueError:pass
checks.append('Tagged catalog context: preview/save both reject protected Form source and keep identical pixels')
# Empty fragment deletion must not parse an empty byte string.
d=fitz.open();p=d.new_page();p.insert_text((30,60),'Delete all');raw=d.tobytes();obj=call(raw,'inspect',page=1)['objects'][0]
removed=apply(raw,{'page':1,'type':'flow','sources':[{'index':0,'signature':obj['signature']}],'model':{'text':''},'fragment':''})
with fitz.open(stream=removed,filetype='pdf') as d:assert not d[0].get_text().strip()
checks.append('Complete paragraph deletion succeeds with no fragment and remains readable')
(OUT/'p8-native-report.json').write_text(json.dumps({'platform':sys.platform,'checks':checks,'errors':[]},indent=2));print(json.dumps({'checks':checks,'errors':[]}))

"""Numerical reference checks plus real PDF instance/save/preview contracts."""
import sys,io,json,base64,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
import numpy as np
from PIL import Image
import fitz
from image_adjustments import process,preview
from image_color import validate,curve_lut
import worker
def call(raw,command,**kw):return worker.run({'command':command,'bytes':base64.b64encode(raw).decode(),**kw})
def apply(raw,edit):return base64.b64decode(call(raw,'apply',edits=[edit])['bytes'])
def bitmap(raw,page=0):
 with fitz.open(stream=raw,filetype='pdf') as d:return d[page].get_pixmap().samples
out=Path('tests/output');out.mkdir(exist_ok=True);checks=[]
y,x=np.indices((180,240));a=np.stack((x%256,y%256,(x+y)%256,np.full_like(x,180)),2).astype('uint8');im=Image.fromarray(a,'RGBA')
assert process(im,{}).tobytes()==im.tobytes();checks.append('Neutral adjustment is byte-identical including alpha')
options=[{'brightness':20},{'contrast':35},{'black':20,'white':210,'gamma':1.3,'outputBlack':15,'outputWhite':240},{'levels':{'r':[25,1.4,210,10,250]}},{'curves':[[0,0],[64,20],[190,230],[255,255]],'interpolation':'smooth'},{'channelCurves':{'b':[[0,20],[255,240]]}},{'exposure':1.2,'offset':.02,'exposureGamma':1.3},{'temperature':20,'tint':10,'vibrance':40},{'hue':35,'saturation':25,'lightness':10},{'clarity':40,'dehaze':30},{'grain':25},{'balance':{'shadows':[20,0,-20],'highlights':[-20,0,20]}},{'blackWhite':True,'bwMix':[80,70,30,60,20,80]},{'photoDensity':50,'photoColor':[210,130,70]},{'mixer':[[0,0,100,0],[0,100,0,0],[100,0,0,0]]},{'monochrome':True},{'lookup':'cinema'},{'selective':{'reds':[0,40,10,-10],'blacks':[0,0,0,-30]}},{'invert':True},{'posterize':5},{'thresholdEnabled':True,'threshold':100},{'gradientEnabled':True,'gradient':[[0,10,20,80],[100,190,50,40],[255,255,240,130]]},{'blur':1.4,'sharpen':90}]
for p in options:
 r=process(im,p);assert r.size==im.size and r.getchannel('A').tobytes()==im.getchannel('A').tobytes();assert r.tobytes()!=im.tobytes(),p;assert r.tobytes()==process(im,p).tobytes(),p
checks.append(f'{len(options)} adjustment configurations change RGB deterministically and preserve alpha')
np.testing.assert_array_equal(np.array(process(im,{'invert':True}))[:,:,:3],255-a[:,:,:3])
r=np.array(process(im,{'thresholdEnabled':True,'threshold':100}));assert set(np.unique(r[:,:,:3]))=={0,255}
levels=process(Image.fromarray(np.tile(np.arange(256,dtype='uint8'),(3,1))).convert('RGB'),{'black':20,'white':220,'outputBlack':10,'outputWhite':240});assert levels.getpixel((0,0))==(10,10,10) and levels.getpixel((255,0))==(240,240,240)
lut=curve_lut([[0,0],[40,10],[120,160],[200,200],[255,255]],True);assert np.all(np.diff(lut)>=0) and lut[40]==10 and lut[120]==160
cube={'size':2,'data':[c for b in (0,1) for g in (0,1) for r in (0,1) for c in (r,g,b)]};np.testing.assert_array_equal(np.array(process(im,{'lookup':'cube','cube':cube})),a)
checks.append('Exact inversion, binary threshold, input/output endpoints, monotone cubic knots and trilinear identity LUT')
for p in [{'outputBlack':250,'outputWhite':10},{'levels':{'r':[50,1,40,0,255]}},{'mixer':[[0]*4]*2},{'cube':{'size':2,'data':[]}},{'exposure':float('nan')},{'gradient':[[20,0,0,0],[255,0,0,0]]},{'lookup':'cube'},{'invert':1}]:
 try:validate(p);raise AssertionError(p)
 except ValueError:pass
checks.append('Malformed nested controls, LUT and nonfinite values rejected')
buf=io.BytesIO();im.save(buf,format='PNG');d=fitz.open();p=d.new_page(width=300,height=250);ref=p.insert_image(fitz.Rect(25,35,265,215),stream=buf.getvalue());p.draw_rect(fitz.Rect(80,90,170,150),color=(0,0,1),fill=(0,0,1));p.insert_text((30,25),'Foreground text');p=d.new_page(width=300,height=250);p.insert_image(fitz.Rect(25,35,265,215),xref=ref);raw=d.tobytes();d.close();(out/'v13-images.pdf').write_bytes(raw)
obj=next(o for o in call(raw,'inspect',page=1)['objects'] if o['type']=='image')
for p in options:
 edited=apply(raw,{**obj,'page':1,'adjustments':p});assert bitmap(raw,1)==bitmap(edited,1)
 with fitz.open(stream=edited,filetype='pdf') as doc:
  assert 'Foreground text' in doc[0].get_text();pix=doc[0].get_pixmap();assert pix.pixel(120,110)==(0,0,255)
 r=call(raw,'image-preview',page=1,index=obj['index'],adjustments=p);assert sum(r['histogram'])==im.width*im.height
checks.append('Every adjustment saves/reopens a real PDF; shared sibling, foreground vector and text preserved')

# PDF color semantics and masks are decoded by MuPDF, not bare JPEG/JPX pixels.
from pypdf import PdfReader,PdfWriter
from pypdf.generic import NameObject as N,NumberObject as I,DecodedStreamObject,DictionaryObject as D
from form_compat import reopen
from content import map_objects
from image_adjustments import read_image
w=PdfWriter(clone_from=PdfReader(io.BytesIO(raw)));pg=w.pages[0];image=next(v.get_object() for v in pg['/Resources']['/XObject'].values() if v.get_object().get('/Subtype')=='/Image')
mask=DecodedStreamObject();mask.set_data(bytes([80,180,240,160])* (60*45//4)+bytes([120])*(60*45%4));mask.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Image'),N('/Width'):I(60),N('/Height'):I(45),N('/BitsPerComponent'):I(8),N('/ColorSpace'):N('/DeviceGray')});image[N('/SMask')]=w._add_object(mask);buffer=io.BytesIO();w.write(buffer);masked=buffer.getvalue()
info=call(masked,'inspect',page=1);obj=next(o for o in info['objects'] if o['type']=='image');assert bitmap(apply(masked,{**obj,'page':1,'adjustments':{}}))==bitmap(masked)
reader=PdfReader(io.BytesIO(reopen(masked,[1])));stream,mapped=map_objects(reader.pages[0]);decoded=read_image(reader.pages[0],stream.operations[mapped[obj['index']]['at']]);assert decoded.mode=='RGBA' and decoded.getchannel('A').getextrema()[0]<200
buf=io.BytesIO();im.convert('RGB').convert('CMYK').save(buf,format='JPEG');doc=fitz.open();page=doc.new_page(width=300,height=260);page.insert_image(fitz.Rect(10,20,290,240),stream=buf.getvalue());page.set_cropbox(fitz.Rect(10,20,290,240));page.set_rotation(90);cmyk=doc.tobytes();doc.close();(out/'v13-cmyk-crop.pdf').write_bytes(cmyk)
info=call(cmyk,'inspect',page=1);obj=next(o for o in info['objects'] if o['type']=='image');obj={**obj,'matrix':[v+(info['pageOrigin'][i-4] if i>=4 else 0) for i,v in enumerate(obj['matrix'])]}
assert bitmap(apply(cmyk,{**obj,'page':1,'adjustments':{}}))==bitmap(cmyk)
result=call(cmyk,'image-preview',page=1,index=obj['index'],adjustments={'contrast':10});assert result['width']==240 and result['height']==180
checks.append('Nonzero CropBox, 90-degree CMYK image and differently sized soft mask: neutral PDF pixels exact; source alpha decoded')
(out/'v13-native-report.json').write_text(json.dumps({'checks':checks,'errors':[]},indent=2));print(json.dumps({'checks':checks,'errors':[]}))

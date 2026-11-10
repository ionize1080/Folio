"""JPX image beside an edited paragraph, including the supplied yearbook."""
import base64
import copy
import io
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor'),str(ROOT/'tests')]
import fitz
import worker
from PIL import Image,ImageDraw
from pypdf import PdfWriter
from pypdf.generic import ContentStream,DecodedStreamObject,DictionaryObject as D,NameObject as N,NumberObject as I,FloatObject as F
from p8_helpers import models,save,dump
from preview_page import render_page
from story import layout

OUT=ROOT/'tests/output/pdf-loading';OUT.mkdir(parents=True,exist_ok=True)
image=Image.new('RGB',(128,80),'#e0ac15');draw=ImageDraw.Draw(image)
draw.rectangle((0,0,63,39),fill='#e32645');draw.rectangle((64,0,127,39),fill='#24b960');draw.rectangle((0,40,63,79),fill='#2876e0')
encoded=io.BytesIO();image.save(encoded,format='JPEG2000')
doc=fitz.open();p=doc.new_page(width=320,height=240)
p.draw_rect(fitz.Rect(170,0,300,240),color=None,fill=(.75,.45,.24))
p.insert_text((25,75),'Annual report 2024 summary',fontsize=9)
raw=doc.tobytes();doc.close()
w=PdfWriter(clone_from=io.BytesIO(raw));p=w.pages[0]
picture=DecodedStreamObject();picture.set_data(encoded.getvalue())
picture.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Image'),N('/Width'):I(128),N('/Height'):I(80),N('/ColorSpace'):N('/DeviceRGB'),N('/BitsPerComponent'):I(8),N('/Filter'):N('/JPXDecode')})
resources=D(dict(p['/Resources']));resources[N('/XObject')]=D({N('/Photo'):w._add_object(picture)});p[N('/Resources')]=resources
stream=ContentStream(p.get('/Contents'),w);stream.operations.extend([([],b'q'),([F(v) for v in [128,0,0,80,170,90]],b'cm'),([N('/Photo')],b'Do'),([],b'Q')]);p[N('/Contents')]=w._add_object(stream)
cases=[('synthetic-jpx',dump(w),1)]
source=Path(r'C:\Users\haowe\Downloads\中国交通年鉴2025_1-edited.pdf')
if source.exists():cases.append(('yearbook-page62',source.read_bytes(),62))
manifest=[]
for name,raw,number in cases:
    inspect,candidates=models(raw,number);model=next(m for m in candidates if '2024' in m['text'])
    edited=copy.deepcopy(model);edited['text']=edited['text'].replace('2024','2026',1)
    precise=layout(edited);assert precise['mappingComplete'] and not precise['overflow'],(name,{k:precise.get(k) for k in ('layoutMode','mappingComplete','overflow','mappingReason')},model['frame'])
    saved=save(raw,edited,number,result=precise)
    blank=layout(dict(text='',pageWidth=model['pageWidth'],pageHeight=model['pageHeight'],frame=dict(x=0,y=0,width=model['pageWidth'],height=model['pageHeight']),size=12,lineHeight=1.4,align='left',color='#202020'))
    background=worker.run(dict(command='flow-background',bytes=base64.b64encode(raw).decode(),page=number,edits=[dict(type='flow',page=number,sources=model['sources'],model={**model,'text':'','runs':[],'softBreaks':[]},fragment=blank['fragment'])]))
    files={}
    for kind,data,page in [('source',raw,number),('saved',saved,number),('background',base64.b64decode(background['pdf']),1)]:
        filename=name+'-'+kind+'.pdf';single=render_page(data,page);(OUT/filename).write_bytes(single);files[kind]=filename
    frame=model['frame'];ignored=[frame['x']-2,frame['y']-2,frame['x']+frame['width']+2,frame['y']+frame['height']+2]
    photo=next(o for o in inspect['objects'] if o['type']=='image' and (name!='yearbook-page62' or o['index']==43))
    l,b,r,t=photo['bounds'];h=inspect['size'][1]
    manifest.append(dict(name=name,files=files,ignored=ignored,image=[l,h-t,r,h-b]))
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print(json.dumps(dict(status='passed',cases=[m['name'] for m in manifest])))

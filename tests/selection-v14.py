"""Source-glyph preservation, independent text advances, mixed edits and page coordinates."""
import sys,io,json,base64
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
import fitz
from PIL import Image
from pypdf import PdfReader,PdfWriter
from pypdf.generic import DecodedStreamObject,NameObject
import worker
out=Path('tests/output');out.mkdir(exist_ok=True);checks=[]
def call(raw,command,**kw):return worker.run({'command':command,'bytes':base64.b64encode(raw).decode(),**kw})
def apply(raw,edits):return base64.b64decode(call(raw,'apply',edits=edits)['bytes'])
def pixels(raw):
 with fitz.open(stream=raw,filetype='pdf') as d:return d[0].get_pixmap().samples
# Consecutive Tj operators exercise shared text-position state and original subset font.
doc=fitz.open();p=doc.new_page(width=620,height=820);p.insert_text((60,80),'Alpha   Beta   Gamma',fontname='tiro',fontsize=16)
p.insert_text((60,130),'Second text',fontname='hebo',fontsize=18);p.insert_text((350,130),'Untouched sibling',fontsize=12)
for i,color in enumerate(['#e08c48','#4c9cb8']):
 im=Image.new('RGB',(200,120),color);buf=io.BytesIO();im.save(buf,format='PNG');p.insert_image(fitz.Rect(60+i*270,200,280+i*270,340),stream=buf.getvalue())
p=doc.new_page(width=620,height=820);p.insert_text((60,80),'Rotated crop test',fontsize=16);p.insert_text((60,130),'Neighbor',fontsize=12);p.set_cropbox(fitz.Rect(20,30,590,790));p.set_rotation(90)
raw=doc.tobytes();doc.close();(out/'v14-selection.pdf').write_bytes(raw)
objects=call(raw,'inspect',page=1)['objects'];texts=[o for o in objects if o['type']=='text'];images=[o for o in objects if o['type']=='image'];assert len(texts)==3 and len(images)==2
edits=[{**o,'page':1,'objectStyle':{}} for o in texts]
neutral=apply(raw,edits);assert pixels(neutral)==pixels(raw)
checks.append('Neutral batch text operation is pixel-identical with original fonts')
e={**texts[0],'page':1,'matrix':[*texts[0]['matrix'][:4],texts[0]['matrix'][4]+24,texts[0]['matrix'][5]-18],'objectStyle':{'fill':[210,20,40],'scale':1.25}}
result=apply(raw,[e,{**images[0],'page':1,'adjustments':{'contrast':30}},{**images[1],'page':1,'adjustments':{'contrast':30}}])
with fitz.open(stream=raw,filetype='pdf') as a,fitz.open(stream=result,filetype='pdf') as b:
 aa=a[0].get_text('dict')['blocks'];bb=b[0].get_text('dict')['blocks'];sa=aa[0]['lines'][0]['spans'][0];sb=bb[0]['lines'][0]['spans'][0]
 assert sb['font']==sa['font'] and sb['text']==sa['text'] and abs(sb['size']-20)<.05
 assert abs(sb['origin'][0]-sa['origin'][0]-24)<.05 and abs(sb['origin'][1]-sa['origin'][1]-18)<.05
 assert bb[1]['bbox']==aa[1]['bbox'] and bb[2]['bbox']==aa[2]['bbox']
 assert b[1].get_pixmap().samples==a[1].get_pixmap().samples
(out/'v14-selection-edited.pdf').write_bytes(result)
checks.append('Mixed image batch plus text size/color/move preserves text/font, sibling positions and other page')
info=call(raw,'inspect',page=2);o=info['objects'][0];origin=info['pageOrigin'];o['matrix']=[v+(origin[i-4] if i>=4 else 0) for i,v in enumerate(o['matrix'])]
assert pixels(apply(raw,[{**o,'page':2,'objectStyle':{}}]))==pixels(raw)
r=apply(raw,[{**o,'page':2,'matrix':[*o['matrix'][:4],o['matrix'][4]+7,o['matrix'][5]-9],'objectStyle':{'fill':[10,100,200]}}])
with fitz.open(stream=r,filetype='pdf') as d:assert d[1].rotation==90 and 'Neighbor' in d[1].get_text()
checks.append('Rotated nonzero CropBox text remains editable with native page coordinates')
# Force adjacent paints in one BT; first edit must not alter the following advance.
w=PdfWriter(clone_from=PdfReader(io.BytesIO(raw)));stream=DecodedStreamObject();stream.set_data(b'BT /helv 12 Tf 1 0 0 1 60 700 Tm (FIRST) Tj ( SECOND) Tj ET');w.pages[0][NameObject('/Contents')]=w._add_object(stream);buf=io.BytesIO();w.write(buf);shared=buf.getvalue();objs=call(shared,'inspect',page=1)['objects'];assert len(objs)==2
r=apply(shared,[{**objs[0],'page':1,'matrix':[*objs[0]['matrix'][:4],100,650],'objectStyle':{'scale':1.5,'fill':[0,0,255]}}])
with fitz.open(stream=shared,filetype='pdf') as a,fitz.open(stream=r,filetype='pdf') as b:
 wa={v[4]:v[:4] for v in a[0].get_text('words')};wb={v[4]:v[:4] for v in b[0].get_text('words')};assert wa['SECOND']==wb['SECOND'];assert wa['FIRST']!=wb['FIRST']
checks.append('Consecutive Tj paints retain unselected text advance and position')
for style in [{'scale':float('nan')},{'scale':0},{'fill':[300,0,0]}]:
 try:apply(raw,[{**texts[0],'page':1,'objectStyle':style}]);raise AssertionError('accepted invalid style')
 except ValueError:pass
checks.append('Malformed object style rejected atomically')
(out/'v14-native-report.json').write_text(json.dumps({'checks':checks,'errors':[]},indent=2));print(json.dumps({'checks':checks,'errors':[]}))

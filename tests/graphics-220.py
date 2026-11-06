import sys,io,base64,json,math,uuid
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
import fitz,worker
from PIL import Image
from pypdf import PdfReader
from vector_graphics import list_graphics
from document_assembly import assemble
out=root/'tests/output';out.mkdir(exist_ok=True)
checks=[]
def ok(name):checks.append(name);print('PASS',name,flush=True)
def encoded(data):return base64.b64encode(data).decode()
def apply(data,edits):return base64.b64decode(worker.run({'command':'apply','bytes':encoded(data),'edits':edits})['bytes'])
def inspect(data,page=1):return worker.run({'command':'inspect','bytes':encoded(data),'page':page,'imagesOnly':True})['objects']
def pixels(data,page=0):
    with fitz.open(stream=data,filetype='pdf') as d:return d[page].get_pixmap().samples
image=Image.new('RGB',(180,120),'#db542c');buf=io.BytesIO();image.save(buf,format='PNG');image_data=buf.getvalue()
doc=fitz.open();p=doc.new_page(width=500,height=500);p.insert_text((40,35),'Original text stays intact')
x=p.insert_image(fitz.Rect(50,60,230,180),stream=image_data);p.insert_image(fitz.Rect(270,60,450,180),xref=x)
doc.new_page(width=500,height=500).insert_text((40,35),'Destination');doc.set_toc([[1,'First',1],[1,'Second',2]])
raw=doc.tobytes();doc.close();(out/'graphics-220-source.pdf').write_bytes(raw)
objects=inspect(raw);first=objects[0]
def old_edit(**more):return dict(type='image',page=1,index=first['index'],signature=first['signature'],**more)
deleted=apply(raw,[old_edit(delete=True)])
assert len(inspect(deleted))==1
assert pixels(raw,1)==pixels(deleted,1)
with fitz.open(stream=deleted,filetype='pdf') as d:assert 'Original text' in d[0].get_text()
ok('Delete only one occurrence of a shared old image; preserve text and neighboring page')
exported=worker.run({'command':'image-export','bytes':encoded(raw),'page':1,'index':first['index']})['imageData']
insert=dict(id=str(uuid.uuid4()),type='inserted-image',page=2,imageData=exported,matrix=[120,50,-30,100,100,160],opacity=.65,blendMode='Multiply',adjustments={'contrast':20},crop=[5,0,5,0])
moved=apply(raw,[old_edit(delete=True),insert]);assert len(inspect(moved,2))==1
assert pixels(raw,1)!=pixels(moved,1)
(out/'graphics-220-moved.pdf').write_bytes(moved)
second=inspect(moved,2)[0];again=apply(moved,[dict(type='image',page=2,index=second['index'],signature=second['signature'],delete=True)])
assert not inspect(again,2);ok('Move full-resolution old pixels across pages with rotation, scale, crop, color and opacity; delete after reopen')
uid=str(uuid.uuid4());svg='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect id="r" width="200" height="100" fill="url(#g)"/><line id="l" x1="10" y1="50" x2="190" y2="50" stroke="#ffffff" stroke-width="5"/></svg>'
v=dict(id=uid,type='vector-graphic',page=1,svg=svg,box=[80,90,300,150],rotation=23,opacity=.8)
created=apply(raw,[v]);reader=PdfReader(io.BytesIO(created));listed=list_graphics(reader.pages[0]);assert len(listed)==1 and listed[0]['svg']==svg and listed[0]['rotation']==23
with fitz.open(stream=created,filetype='pdf') as d:
    assert d[0].get_drawings()
    pix=d[0].get_pixmap();pix.save(out/'graphics-220-vector.png')
form=next(ref.get_object() for ref in reader.pages[0]['/Resources']['/XObject'].values() if ref.get_object().get('/FolioVectorID')==uid)
artwork=form['/Resources']['/XObject']['/FolioArtwork'].get_object()
assert '/Shading' in artwork['/Resources'], 'Gradient must remain a native shading, not a bitmap'
assert not any(x.get_object().get('/Subtype')=='/Image' for x in artwork['/Resources'].get('/XObject',{}).values())
ok('Native vector gradient and line survive rotation, opacity, saving and source inspection')
radial='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><defs><radialGradient id="g" gradientTransform="translate(.1 0) scale(.8 1)"><stop offset="0" stop-color="#ffffff" stop-opacity="0.2"/><stop offset="0.5" stop-color="#00ff00" stop-opacity="0.7"/><stop offset="1" stop-color="#000000"/></radialGradient></defs><ellipse cx="100" cy="50" rx="95" ry="45" fill="url(#g)"/></svg>'
rad=apply(raw,[{**v,'svg':radial,'rotation':0,'opacity':1}])
with fitz.open(stream=rad,filetype='pdf') as d:
    d[0].get_pixmap().save(out/'graphics-220-radial.png')
    assert len(set(d[0].get_pixmap().samples))>100
ok('Radial multistop gradients retain alpha and gradient transforms')
alpha_svg='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ff0000" fill-opacity="0.5"/></svg>'
alpha=apply(raw,[{**v,'svg':alpha_svg,'box':[50,50,100,100],'rotation':0,'opacity':0.5}])
with fitz.open(stream=alpha,filetype='pdf') as d:
    color=d[0].get_pixmap().pixel(100,400)
    assert color[0]>250 and all(185<c<197 for c in color[1:]),color
ok('Whole-vector opacity multiplies element opacity in an isolated transparency group')

transferred=apply(created,[dict(id=uid,type='vector-graphic',page=1,delete=True),{**v,'page':2,'rotation':-37,'box':[20,40,200,100],'svg':svg.replace('#ff0000','#00ff00')}])
r=PdfReader(io.BytesIO(transferred));assert not list_graphics(r.pages[0]);assert len(list_graphics(r.pages[1]))==1
removed=apply(transferred,[dict(id=uid,type='vector-graphic',page=2,delete=True)])
assert pixels(raw)==pixels(removed) and pixels(raw,1)==pixels(removed,1)
ok('Move and edit a reopened vector across pages, then delete with exact pixel restoration')
(out/'graphics-220-vector.pdf').write_bytes(created)
combined=assemble({'bytes':encoded(moved),'parts':[{'current':True},{'data':encoded(created)}]})
assert combined['pageCount']==4
reader=PdfReader(io.BytesIO(base64.b64decode(combined['bytes'])));assert len(reader.outline)==4
split=assemble({'bytes':combined['bytes'],'parts':[{'current':True,'pages':[4,2]}]});assert split['pageCount']==2
reader=PdfReader(io.BytesIO(base64.b64decode(split['bytes'])));assert len(reader.outline)==2
assert len(inspect(base64.b64decode(split['bytes']),2))==1
ok('Merge and split preserve updated images and remap bookmarks, including reordered ranges')
for edit in [{**insert,'matrix':[0,0,0,0,0,0]},{**insert,'opacity':2},{**v,'box':[0,0,-1,50]},{**v,'svg':'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'}]:
    try:apply(raw,[edit])
    except (ValueError,TypeError):pass
    else:raise AssertionError('Invalid graphic was accepted')
ok('Reject invalid geometry, opacity and executable SVG without modifying source')
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject,NameObject
w=PdfWriter();pg=w.add_blank_page(width=300,height=300);stream=DecodedStreamObject();stream.set_data(b'q 100 0 0 100 30 30 cm BI /W 1 /H 1 /CS /RGB /BPC 8 ID '+bytes([210,40,90])+b' EI Q')
pg[NameObject('/Contents')]=w._add_object(stream);buf=io.BytesIO();w.write(buf);inline=buf.getvalue();obj=inspect(inline)[0];assert obj['editable']
exported=worker.run({'command':'image-export','bytes':encoded(inline),'page':1,'index':obj['index']});assert exported['imageData']
changed=apply(inline,[dict(type='image',page=1,index=obj['index'],signature=obj['signature'],adjustments={'contrast':10})]);assert len(inspect(changed))==1
deleted=apply(inline,[dict(type='image',page=1,index=obj['index'],signature=obj['signature'],delete=True)]);assert not inspect(deleted)
ok('Legacy inline images can be inspected, exported, adjusted and deleted')
(out/'graphics-220-native.json').write_text(json.dumps({'status':'passed','checks':checks},indent=2))

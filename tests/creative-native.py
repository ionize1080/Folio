"""Real PDF paint-order, raster handoff, native vector and source-free save checks."""
import base64, io, json, sys, uuid
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
import fitz, worker
from PIL import Image
from pypdf import PdfReader, PdfWriter
from creative_graphics import inspect as studio_inspect
out=root/'tests/output';out.mkdir(exist_ok=True)
checks=[]
def b64(data):return base64.b64encode(data).decode()
def apply(data,edits):return base64.b64decode(worker.run({'command':'apply','bytes':b64(data),'edits':edits})['bytes'])
def pixels(data,page=0):
    with fitz.open(stream=data,filetype='pdf') as d:return d[page].get_pixmap(alpha=True).samples
def png(color):
    buf=io.BytesIO();Image.new('RGB',(80,60),color).save(buf,format='PNG');return buf.getvalue()
doc=fitz.open();p=doc.new_page(width=400,height=400)
p.insert_image(fitz.Rect(40,60,200,180),stream=png('#e03030'))
p.draw_rect(fitz.Rect(90,80,150,160),color=None,fill=(0,0,1),overlay=True)
doc.new_page(width=400,height=400).insert_text((30,30),'Untouched neighbor')
raw=doc.tobytes();(out/'creative-source.pdf').write_bytes(raw);doc.close()
objects=worker.run({'command':'inspect','bytes':b64(raw),'page':1})['objects']
image=next(o for o in objects if o['type']=='image');path=next(o for o in objects if o['type']=='path')
uid=str(uuid.uuid4());edit=dict(type='studio-graphic',id=uid,page=1,kind='photo',index=image['index'],signature=image['signature'],box=[40,220,160,120],matrix=image['matrix'],imageData=b64(png('#e03030')),sourceData='PRIVATE_NATIVE_LAYERS')
result=apply(raw,[edit]);assert pixels(result)==pixels(raw),'Opening and applying must not move/reorder artwork'
assert pixels(result,1)==pixels(raw,1);assert b'PRIVATE_NATIVE_LAYERS' not in result
listed=studio_inspect(PdfReader(io.BytesIO(result)).pages[0]);assert listed[0]['matrix']==image['matrix']
checks.append('Existing image replacement preserves paint order, pixel geometry, neighbor page; native source excluded from PDF')
changed=apply(raw,[{**edit,'imageData':b64(png('#20e030'))}]);assert pixels(changed)!=pixels(raw)
reopened={**edit,'imageData':b64(png('#2030e0'))};reopened.pop('index');reopened.pop('signature')
changed2=apply(changed,[reopened]);assert len(studio_inspect(PdfReader(io.BytesIO(changed2)).pages[0]))==1
deleted=apply(changed2,[dict(type='studio-graphic',id=uid,page=1,delete=True)]);assert not studio_inspect(PdfReader(io.BytesIO(deleted)).pages[0])
checks.append('Reopened result updates the same artwork and deletes it without orphan calls')
adj=worker.run({'command':'image-export','bytes':b64(raw),'page':1,'index':image['index'],'adjustments':{'saturation':-100},'crop':[10,0,0,0]})['imageData']
im=Image.open(io.BytesIO(base64.b64decode(adj)));assert im.mode=='RGBA' and im.getpixel((0,20))[3]==0
r,g,b,a=im.getpixel((30,20));assert r==g==b and a==255
inserted=worker.run({'command':'image-export','imageData':b64(png('#12ab34'))})['imageData'];assert inserted
checks.append('Existing color adjustments and crop alpha enter studio; inserted images work without an original object index')
vdoc=fitz.open();v=vdoc.new_page(width=80,height=80);v.draw_bezier((0,70),(20,0),(60,0),(80,70),color=(1,0,0),width=2);vdata=vdoc.tobytes();vdoc.close()
vector=dict(type='studio-graphic',id=str(uuid.uuid4()),page=1,kind='vector',index=path['index'],signature=path['signature'],box=[90,240,60,80],pdfData=b64(vdata),sourceData='VECTOR_EDIT_HISTORY')
vresult=apply(raw,[vector]);assert b'VECTOR_EDIT_HISTORY' not in vresult
with fitz.open(stream=vresult,filetype='pdf') as vd:assert vd[0].get_drawings() and len(vd[0].get_images())==1
item=studio_inspect(PdfReader(io.BytesIO(vresult)).pages[0],vector['id'])[0]
with fitz.open(stream=base64.b64decode(item['pdfData']),filetype='pdf') as vd:assert vd[0].get_drawings() and not vd[0].get_images()
checks.append('Vector replacement, extraction and reopening retain editable PDF Bezier paths without rasterization')
# Page rotation is only a viewing attribute; reference pixels and object matrices
# both use unrotated absolute PDF coordinates, including a nonzero crop origin.
writer=PdfWriter(clone_from=io.BytesIO(raw));pg=writer.pages[0];pg.cropbox.lower_left=(20,30);pg.cropbox.upper_right=(380,390);pg.rotate(90)
buf=io.BytesIO();writer.write(buf);cropped=buf.getvalue()
ref=worker.run({'command':'studio-reference','bytes':b64(cropped),'page':1,'maxSide':720})
assert ref['bounds']==[20,30,380,390]
with fitz.open(stream=cropped,filetype='pdf') as d:
    d[0].set_rotation(0);expected=d[0].get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
    image_ref=Image.open(io.BytesIO(base64.b64decode(ref['imageData'])))
    assert image_ref.tobytes()==expected.samples
assert pixels(cropped)==pixels(buf.getvalue()),'Reference generation must not modify the PDF'
checks.append('PDF reference is correctly aligned for rotated and cropped pages without modifying source bytes')
# Upgrade the old quick-vector edit in its existing paint slot, before a covering image.
legacy_id=str(uuid.uuid4());legacy=dict(type='vector-graphic',id=legacy_id,page=1,box=[90,240,60,80],svg='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="red"/></svg>')
legacy_pdf=apply(raw,[legacy]);legacy_doc=fitz.open(stream=legacy_pdf,filetype='pdf');legacy_doc[0].draw_rect(fitz.Rect(100,100,140,140),color=None,fill=(0,1,0));legacy_pdf=legacy_doc.tobytes();legacy_doc.close()
replacement={**vector,'id':str(uuid.uuid4()),'replaceVectorId':legacy_id};replacement.pop('index');replacement.pop('signature')
upgraded=apply(legacy_pdf,[replacement])
with fitz.open(stream=upgraded,filetype='pdf') as d:
    pix=d[0].get_pixmap();assert pix.pixel(120,120)==(0,255,0),'Upgrading must preserve the original vector paint order'
checks.append('Existing quick-vector artwork upgrades in place beneath overlapping page content')
(out/'creative-result.pdf').write_bytes(vresult)
(out/'creative-native.json').write_text(json.dumps({'status':'passed','checks':checks},indent=2),encoding='utf-8')
print('\n'.join('PASS '+x for x in checks))

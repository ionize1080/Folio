"""Isolated image instances. Original resource and pixels are never modified."""
import base64,io,math
from pypdf import PdfReader
from pypdf.generic import NameObject,DictionaryObject,FloatObject

def operations(writer,page,original,matrix,ctm,crop,image_data=None,fit='contain'):
 def numbers(v,n):
  if not isinstance(v,list) or len(v)!=n or any(not isinstance(x,(int,float)) or not math.isfinite(x) for x in v):raise ValueError('图片参数无效')
  return list(map(float,v))
 matrix=numbers(matrix,6);a,b,c,d,e,f=numbers(ctm,6);det=a*d-b*c
 if abs(det)<1e-12:raise ValueError('图片变换不可逆')
 inv=[d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det]
 crop=numbers(crop or [0,0,0,0],4);left,top,right,bottom=[x/100 for x in crop]
 if min(crop)<0 or left+right>=.99 or top+bottom>=.99:raise ValueError('裁切后必须保留可见图片')
 draw=original
 if image_data:
  data=base64.b64decode(image_data,validate=True)
  if len(data)>32*1024*1024:raise ValueError('替换图片限 32 MB')
  import fitz
  width=max(1,math.hypot(matrix[0],matrix[1]));height=max(1,math.hypot(matrix[2],matrix[3]))
  doc=fitz.open();p=doc.new_page(width=width,height=height)
  pix=fitz.Pixmap(data);iw,ih=pix.width,pix.height;del pix
  if fit not in ('contain','cover','stretch'):raise ValueError('图片适配方式无效')
  if fit=='stretch':rect=p.rect
  else:
   scale=(max if fit=='cover' else min)(width/iw,height/ih);w,h=iw*scale,ih*scale;rect=fitz.Rect((width-w)/2,(height-h)/2,(width+w)/2,(height+h)/2)
  p.insert_image(rect,stream=data,keep_proportion=False)
  source=PdfReader(io.BytesIO(doc.tobytes()));sp=source.pages[0]
  from pypdf.generic import DecodedStreamObject,ArrayObject
  form=DecodedStreamObject();form.set_data(sp.get_contents().get_data());form.update({NameObject('/Type'):NameObject('/XObject'),NameObject('/Subtype'):NameObject('/Form'),NameObject('/BBox'):ArrayObject([FloatObject(x) for x in [0,0,width,height]]),NameObject('/Matrix'):ArrayObject([FloatObject(x) for x in [1/width,0,0,1/height,0,0]]),NameObject('/Resources'):sp['/Resources'].clone(writer)})
  resources=DictionaryObject(dict(page['/Resources']));xs=resources.get('/XObject',{});xs=xs.get_object() if hasattr(xs,'get_object') else xs;xs=DictionaryObject(dict(xs));j=1
  while NameObject('/FolioImage'+str(j)) in xs:j+=1
  name=NameObject('/FolioImage'+str(j));xs[name]=writer._add_object(form);resources[NameObject('/XObject')]=xs;page[NameObject('/Resources')]=resources;draw=([name],b'Do');doc.close()
 def vals(v):return [FloatObject(x) for x in v]
 return [([],b'q'),(vals(inv),b'cm'),(vals(matrix),b'cm'),(vals([left,bottom,1-left-right,1-top-bottom]),b're'),([],b'W'),([],b'n'),draw,([],b'Q')]

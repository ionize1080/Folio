"""Place studio results as ordinary PDF artwork; editable sources live in .folio only."""
import base64
import io
import math
from uuid import UUID

import fitz
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (ArrayObject, BooleanObject, ContentStream, DecodedStreamObject,
                           DictionaryObject, FloatObject, NameObject as N, TextStringObject)


def reference(data, page, max_side=1600):
    """An unrotated preview, in the same absolute PDF coordinates as object placement."""
    with io.BytesIO(data) as stream:
        reader=PdfReader(stream)
        if not isinstance(page,int) or not 1<=page<=len(reader.pages):raise ValueError('Invalid reference page')
        bounds=list(map(float,reader.pages[page-1].cropbox))
    with fitz.open(stream=data,filetype='pdf') as doc:
        pg=doc[page-1];pg.set_rotation(0)
        scale=max(64,min(int(max_side),2048))/max(pg.rect.width,pg.rect.height)
        pix=pg.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False)
        return dict(imageData=base64.b64encode(pix.tobytes('png')).decode(),bounds=bounds,width=pix.width,height=pix.height)


def objects(page):
    return page.get('/Resources', {}).get('/XObject', {}).get_object() if hasattr(page.get('/Resources', {}).get('/XObject', {}), 'get_object') else page.get('/Resources', {}).get('/XObject', {})


def inspect(page, uid=None):
    result = []
    for ref in objects(page).values():
        form = ref.get_object()
        if '/FolioStudioID' not in form:
            continue
        a,b,c,d,e,f=map(float,form['/Matrix']);x0,y0,x1,y1=map(float,form['/BBox'])
        item = dict(id=str(form['/FolioStudioID']), kind=str(form['/FolioStudioKind']),
                    box=list(map(float, form['/FolioStudioBox'])), matrix=[a*(x1-x0),b*(x1-x0),c*(y1-y0),d*(y1-y0),e+a*x0+c*y0,f+b*x0+d*y0],opacity=float(form.get('/FolioOpacity',1)),blendMode=str(form.get('/FolioBlendMode','Normal')))
        if uid == item['id']:
            writer = PdfWriter()
            x0,y0,x1,y1 = map(float,form['/BBox'])
            out = writer.add_blank_page(x1-x0, y1-y0)
            artwork = form['/Resources']['/XObject']['/Artwork'].get_object().clone(writer)
            artwork[N('/Matrix')] = ArrayObject([FloatObject(v) for v in [1,0,0,1,-x0,-y0]])
            out[N('/Resources')] = DictionaryObject({N('/XObject'):DictionaryObject({N('/Artwork'):writer._add_object(artwork)})})
            stream = DecodedStreamObject();stream.set_data(b'q /Artwork Do Q')
            out[N('/Contents')] = writer._add_object(stream)
            buf=io.BytesIO();writer.write(buf);item['pdfData']=base64.b64encode(buf.getvalue()).decode()
        result.append(item)
    return result


def make_form(writer, page, edit):
    uid=str(UUID(edit['id']));name=N('/FolioStudio'+uid.replace('-',''))
    x,y,w,h=map(float,edit['box'])
    if not all(math.isfinite(v) and abs(v)<=100000 for v in (x,y,w,h)) or min(w,h)<=0:
        raise ValueError('Invalid studio placement')
    if edit.get('pdfData'):
        data=base64.b64decode(edit['pdfData'],validate=True)
    else:
        image=base64.b64decode(edit['imageData'],validate=True)
        with fitz.open() as doc:
            pg=doc.new_page(width=w,height=h);pg.insert_image(pg.rect,stream=image,keep_proportion=False);data=doc.tobytes()
    source=PdfReader(io.BytesIO(data))
    if len(source.pages)!=1:raise ValueError('Apply one artboard at a time')
    original=source.pages[0];vw,vh=float(original.mediabox.width),float(original.mediabox.height)
    matrix=edit.get('matrix') or [w,0,0,h,x,y]
    if len(matrix)!=6 or not all(math.isfinite(v) for v in matrix) or abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])<1e-10:
        raise ValueError('Invalid studio transformation')
    a,b,c,d,e,f=matrix
    opacity=float(edit.get('opacity',1));blend=edit.get('blendMode','Normal')
    if not math.isfinite(opacity) or not 0<=opacity<=1:raise ValueError('Invalid opacity')
    if blend not in ('Normal','Multiply','Screen','Overlay','Darken','Lighten','ColorDodge','ColorBurn','HardLight','SoftLight','Difference','Exclusion','Hue','Saturation','Color','Luminosity'):raise ValueError('Invalid blend mode')
    inner=DecodedStreamObject();inner.set_data(original.get_contents().get_data())
    inner.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Form'),N('/BBox'):ArrayObject([FloatObject(v) for v in original.mediabox]),N('/Resources'):original['/Resources'].clone(writer),N('/Group'):DictionaryObject({N('/S'):N('/Transparency'),N('/I'):BooleanObject(True)})})
    if '/Group' in original:inner[N('/Group')]=original['/Group'].clone(writer)
    form=DecodedStreamObject();form.set_data(b'q /Style gs /Artwork Do Q')
    form.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Form'),
                 N('/BBox'):ArrayObject([FloatObject(v) for v in original.mediabox]),
                 N('/Matrix'):ArrayObject([FloatObject(v) for v in [a/vw,b/vw,c/vh,d/vh,e-a*float(original.mediabox.left)/vw-c*float(original.mediabox.bottom)/vh,f-b*float(original.mediabox.left)/vw-d*float(original.mediabox.bottom)/vh]]),
                 N('/Resources'):DictionaryObject({N('/XObject'):DictionaryObject({N('/Artwork'):writer._add_object(inner)}),N('/ExtGState'):DictionaryObject({N('/Style'):DictionaryObject({N('/Type'):N('/ExtGState'),N('/ca'):FloatObject(opacity),N('/CA'):FloatObject(opacity),N('/BM'):N('/'+blend)})})}),
                 N('/FolioOpacity'):FloatObject(opacity),N('/FolioBlendMode'):TextStringObject(blend),
                 N('/FolioLayerKind'):N('/Studio'),N('/FolioStudioID'):TextStringObject(uid),
                 N('/FolioStudioKind'):TextStringObject(edit['kind']),
                 N('/FolioStudioBox'):ArrayObject([FloatObject(v) for v in (x,y,w,h)])})
    resources=DictionaryObject(dict(page.get('/Resources',{})));xs=DictionaryObject(dict(objects(page)))
    xs[name]=writer._add_object(form);resources[N('/XObject')]=xs;page[N('/Resources')]=resources
    return name


def replace_operations(writer,page,edit,stream,position):
    name=make_form(writer,page,edit)
    ctm=[1,0,0,1,0,0];stack=[]
    for ar,op in stream.operations[:position+1]:
        if op==b'q':stack.append(ctm[:])
        elif op==b'Q':ctm=stack.pop() if stack else [1,0,0,1,0,0]
        elif op==b'cm':
            a,b,c,d,e,f=map(float,ar);A,B,C,D,E,F=ctm
            ctm=[A*a+C*b,B*a+D*b,A*c+C*d,B*c+D*d,A*e+C*f+E,B*e+D*f+F]
    a,b,c,d,e,f=ctm;det=a*d-b*c
    if abs(det)<1e-12:raise ValueError('Invalid inherited transform')
    inv=[d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det]
    return [([],b'q'),([FloatObject(v) for v in inv],b'cm'),([name],b'Do'),([],b'Q')]


def place(writer,page,edits):
    calls=[]
    for edit in edits:
        name=N('/FolioStudio'+str(UUID(edit['id'])).replace('-',''))
        existed=name in objects(page)
        if edit.get('delete'):
            stream=ContentStream(page.get('/Contents'),writer)
            stream.operations=[(a,o) for a,o in stream.operations if not(o==b'Do' and a and a[0]==name)]
            page[N('/Contents')]=writer._add_object(stream)
            resources=DictionaryObject(dict(page.get('/Resources',{})));xs=DictionaryObject(dict(objects(page)));xs.pop(name,None)
            resources[N('/XObject')]=xs;page[N('/Resources')]=resources
        else:
            make_form(writer,page,edit)
            legacy=N('/FolioVector'+str(UUID(edit['replaceVectorId'])).replace('-','')) if edit.get('replaceVectorId') else None
            if legacy and legacy in objects(page):
                stream=ContentStream(page.get('/Contents'),writer)
                stream.operations=[([name],op) if op==b'Do' and ar and ar[0]==legacy else (ar,op) for ar,op in stream.operations]
                page[N('/Contents')]=writer._add_object(stream)
                objects(page).pop(legacy,None)
            elif not existed:calls.append(([name],b'Do'))
    if calls:
        start=ContentStream(None,writer);start.operations=[([],b'q')]
        end=ContentStream(None,writer);end.operations=[([],b'Q'),*calls]
        old=page.raw_get('/Contents') if '/Contents' in page else None
        refs=list(old.get_object()) if old and isinstance(old.get_object(),ArrayObject) else ([old] if old else [])
        page[N('/Contents')]=ArrayObject([writer._add_object(start),*refs,writer._add_object(end)])

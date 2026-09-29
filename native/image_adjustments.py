"""Deterministic image adjustments shared by preview and full-resolution export.

Operations are applied to an isolated image instance. Alpha is preserved. Preview
is resized AFTER processing, so blur, sharpening and histogram use source pixels.
"""
import base64, io, math
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pypdf.generic import NameObject as N, NumberObject as I, DecodedStreamObject

MAX_PIXELS = 100_000_000

def bounded(value, low, high, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('图像参数无效：' + name)
    return float(value)

from image_color import validate, tonal, colors

def read_image(page, original, image_data=None):
    if image_data:
        data = base64.b64decode(image_data,validate=True)
        if len(data)>32*1024**2: raise ValueError('替换图片限 32 MB')
        image = Image.open(io.BytesIO(data))
    else:
        name = original[0][0]
        obj = page['/Resources']['/XObject'][name].get_object()
        if obj.get('/Subtype') != '/Image': raise ValueError('请选择直接图片对象')
        if int(obj['/Width'])*int(obj['/Height'])>MAX_PIXELS: raise ValueError('图像超过 1 亿像素处理预算')
        try:
            image = page.images[str(name)].image
        except Exception:
            # PDFium/MuPDF ship JBIG2 decoders; do not require a separate jbig2dec
            # executable. Render only this isolated image at its native resolution
            # so Decode arrays, color spaces and masks keep PDF semantics.
            from pypdf import PdfWriter
            from pypdf.generic import DictionaryObject as D
            import fitz
            iw,ih=int(obj['/Width']),int(obj['/Height'])
            if iw>32768 or ih>32768:raise ValueError('图片边长超过处理预算')
            writer=PdfWriter();single=writer.add_blank_page(width=iw,height=ih)
            single[N('/Resources')]=D({N('/XObject'):D({N('/Image'):writer._add_object(obj.clone(writer))})})
            content=DecodedStreamObject();content.set_data(f'{iw} 0 0 {ih} 0 0 cm /Image Do'.encode());single[N('/Contents')]=writer._add_object(content)
            buffer=io.BytesIO();writer.write(buffer)
            with fitz.open(stream=buffer.getvalue(),filetype='pdf') as doc:
                pix=doc[0].get_pixmap(alpha=('/SMask' in obj or '/Mask' in obj))
                image=Image.open(io.BytesIO(pix.tobytes('png')))

    if image.width*image.height>MAX_PIXELS: raise ValueError('图像超过 1 亿像素处理预算')
    image.load()
    return image.convert('RGBA') if 'A' in image.getbands() else image.convert('RGB')

def process(image, options):
    p = validate(options)
    alpha = image.getchannel('A') if 'A' in image.getbands() else None
    rgb = image.convert('RGB')
    if p['preset'] != 'none':
        # Low clipping budget; do not threshold or remove fine punctuation/table rules.
        rgb = ImageOps.autocontrast(rgb,cutoff=.15,preserve_tone=True)
        if p['preset']=='scan-gray': rgb = ImageOps.grayscale(rgb).convert('RGB')
        rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.2,percent=110,threshold=3))
    if p['brightness']: rgb=ImageEnhance.Brightness(rgb).enhance(1+p['brightness']/100)
    if p['contrast']: rgb=ImageEnhance.Contrast(rgb).enhance(1+p['contrast']/100)
    rgb=tonal(rgb,p)
    rgb=colors(rgb,p)
    if p['clarity']:
        if p['clarity']>0:rgb=rgb.filter(ImageFilter.UnsharpMask(radius=8,percent=round(p['clarity']),threshold=3))
        else:rgb=Image.blend(rgb,rgb.filter(ImageFilter.GaussianBlur(8)),-p['clarity']/150)
    if p['dehaze']:rgb=ImageEnhance.Contrast(rgb).enhance(1+p['dehaze']/150)
    if p['blur']:rgb=rgb.filter(ImageFilter.GaussianBlur(p['blur']))
    if p['sharpen']:rgb=rgb.filter(ImageFilter.UnsharpMask(radius=1.2,percent=round(p['sharpen']),threshold=2))
    if alpha is not None:rgb.putalpha(alpha)
    return rgb

def add_image(writer, page, image, original=None):
    rgb=image.convert('RGB');obj=DecodedStreamObject();obj.set_data(rgb.tobytes())
    obj.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Image'),N('/Width'):I(rgb.width),N('/Height'):I(rgb.height),N('/BitsPerComponent'):I(8),N('/ColorSpace'):N('/DeviceRGB')})
    if original is not None:
        source=page['/Resources']['/XObject'][original[0][0]].get_object()
        if '/Interpolate' in source:obj[N('/Interpolate')]=source['/Interpolate']
    if 'A' in image.getbands():
        mask=DecodedStreamObject();mask.set_data(image.getchannel('A').tobytes());mask.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Image'),N('/Width'):I(rgb.width),N('/Height'):I(rgb.height),N('/BitsPerComponent'):I(8),N('/ColorSpace'):N('/DeviceGray')})
        obj[N('/SMask')]=writer._add_object(mask.flate_encode())
    from pypdf.generic import DictionaryObject
    resources=DictionaryObject(dict(page['/Resources']));xs=resources.get('/XObject',{});xs=xs.get_object() if hasattr(xs,'get_object') else xs;xs=DictionaryObject(dict(xs));i=1
    while '/FolioAdjusted'+str(i) in xs:i+=1
    name=N('/FolioAdjusted'+str(i));xs[name]=writer._add_object(obj.flate_encode());resources[N('/XObject')]=xs;page[N('/Resources')]=resources
    return ([name],b'Do')

def preview(args):
    from pathlib import Path
    from pypdf import PdfReader
    from content import map_objects
    from form_compat import reopen
    raw=Path(args['input']).read_bytes() if 'input' in args else base64.b64decode(args['bytes'])
    number=args.get('page',1);data=reopen(raw,[number]);reader=PdfReader(io.BytesIO(data))
    if not isinstance(number,int) or not 1<=number<=len(reader.pages):raise ValueError('页码无效')
    page=reader.pages[number-1];stream,mapped=map_objects(page);index=args.get('index')
    if not isinstance(index,int) or not 0<=index<len(mapped) or mapped[index]['type']!='image':raise ValueError('图片对象编号无效')
    original=stream.operations[mapped[index]['at']]
    if original[1]!=b'Do':raise ValueError('内联图片暂不支持调整')
    image=read_image(page,original,args.get('imageData'));adjusted=process(image,args.get('adjustments',{}))
    def png(im):
        im=im.copy();im.thumbnail((1200,1200));buf=io.BytesIO();im.save(buf,format='PNG');return base64.b64encode(buf.getvalue()).decode()
    return {'original':png(image),'preview':png(adjusted),'width':image.width,'height':image.height,'histogram':image.convert('L').histogram(),'histograms':dict(zip(('r','g','b'),[c.histogram() for c in image.convert('RGB').split()])),'adjustedHistogram':adjusted.convert('L').histogram()}

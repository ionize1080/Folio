"""Deterministic image adjustments shared by preview and full-resolution export.

Operations are applied to an isolated image instance. Alpha is preserved. Drag
previews use a cached bounded proxy; export always processes source pixels.
"""
import base64, io, math, hashlib, time
from collections import OrderedDict
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pypdf.generic import NameObject as N, NumberObject as I, DecodedStreamObject

MAX_PIXELS = 100_000_000

def bounded(value, low, high, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('图像参数无效：' + name)
    return float(value)

from image_color import validate, tonal, colors, dehaze

def validate_dimensions(width, height):
    if width <= 0 or height <= 0 or width > 32768 or height > 32768 or width*height > MAX_PIXELS:
        raise ValueError("图像尺寸超过处理预算（1亿像素，边长32768）")

def read_image(page, original, image_data=None):
    if image_data:
        data = base64.b64decode(image_data,validate=True)
        if len(data)>32*1024**2: raise ValueError('替换图片限 32 MB')
        image = Image.open(io.BytesIO(data))
    else:
        name = original[0][0]
        obj = page['/Resources']['/XObject'][name].get_object()
        if obj.get('/Subtype') != '/Image': raise ValueError('请选择直接图片对象')
        validate_dimensions(int(obj['/Width']),int(obj['/Height']))
        try:
            if str(obj.get('/ColorSpace'))!='/DeviceRGB' or any(k in obj for k in ('/Decode','/SMask','/Mask','/SMaskInData')) or '/JPXDecode' in str(obj.get('/Filter')):
                raise ValueError('Resolve PDF color spaces, Decode and masks with the PDF engine')
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
                pix=doc[0].get_pixmap(alpha=True)
                image=Image.open(io.BytesIO(pix.tobytes('png')))

    validate_dimensions(image.width,image.height)
    image.load()
    if 'A' in image.getbands() and image.getchannel('A').getextrema()==(255,255):image=image.convert('RGB')
    return image.convert('RGBA') if 'A' in image.getbands() else image.convert('RGB')

def process(image, options, spatial_scale=1):
    p = validate(options)
    alpha = image.getchannel('A') if 'A' in image.getbands() else None
    rgb = image.convert('RGB')
    if p['preset'] != 'none':
        # Low clipping budget; do not threshold or remove fine punctuation/table rules.
        rgb = ImageOps.autocontrast(rgb,cutoff=.15,preserve_tone=True)
        if p['preset']=='scan-gray': rgb = ImageOps.grayscale(rgb).convert('RGB')
        rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.2*spatial_scale,percent=110,threshold=3))
    if p['brightness']: rgb=ImageEnhance.Brightness(rgb).enhance(1+p['brightness']/100)
    if p['contrast']: rgb=ImageEnhance.Contrast(rgb).enhance(1+p['contrast']/100)
    rgb=tonal(rgb,p)
    rgb=colors(rgb,p)
    if p['clarity']:
        if p['clarity']>0:rgb=rgb.filter(ImageFilter.UnsharpMask(radius=8*spatial_scale,percent=round(p['clarity']),threshold=3))
        else:rgb=Image.blend(rgb,rgb.filter(ImageFilter.GaussianBlur(8*spatial_scale)),-p['clarity']/150)
    if p['dehaze']:rgb=dehaze(rgb,p['dehaze'])
    if p['blur']:rgb=rgb.filter(ImageFilter.GaussianBlur(p['blur']*spatial_scale))
    if p['sharpen']:rgb=rgb.filter(ImageFilter.UnsharpMask(radius=1.2*spatial_scale,percent=round(p['sharpen']),threshold=2))
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

_proxies = OrderedDict()

def vision_options(value):
    if not isinstance(value, dict):
        raise ValueError('Invalid image preview request')
    detail = value.get('detail', 'auto')
    if detail not in ('auto', 'overview', 'detail'):
        raise ValueError('Use auto, overview or detail')
    x, y, w, h = [bounded(n, 0, 1, 'region') for n in value.get('region', [0, 0, 1, 1])]
    if not w or not h or x+w > 1.000001 or y+h > 1.000001:
        raise ValueError('Invalid normalized image region')
    edge = 1200 if detail == 'detail' or (detail == 'auto' and w*h < .5) else 640
    return (x,y,w,h), edge


def vision_result(image, args, size):
    opts = args['vision']
    (x,y,w,h), edge = vision_options(opts)
    work = process(image, args.get('adjustments', {}), image.width / size[0])
    if opts.get('perspective'):
        from image_geometry import rectify
        work = rectify(work, opts['perspective'])
    l,t,r,b = [bounded(n,0,99,'crop') / 100 for n in opts.get('crop',[0,0,0,0])]
    if l+r >= .99 or t+b >= .99:
        raise ValueError('Crop must retain a visible image')
    width,height = work.size
    left,top = (l+x*(1-l-r))*width, (t+y*(1-t-b))*height
    right,bottom = left+w*(1-l-r)*width, top+h*(1-t-b)*height
    work = work.crop((math.floor(left),math.floor(top),math.ceil(right),math.ceil(bottom)))
    work.thumbnail((edge,edge),Image.Resampling.LANCZOS)
    hist = work.convert('L').histogram()
    total,cumulative = sum(hist),0
    percentiles = []
    ranks = [.01,.5,.99]
    for value,count in enumerate(hist):
        cumulative += count
        while len(percentiles)<len(ranks) and cumulative >= total*ranks[len(percentiles)]:
            percentiles.append(value)
    data = io.BytesIO()
    work.save(data,format='PNG',compress_level=3)
    mime = 'image/png'
    if len(data.getvalue()) > 380_000 and 'A' not in work.getbands():
        data = io.BytesIO()
        work.save(data,format='JPEG',quality=86,optimize=True)
        mime = 'image/jpeg'
    return dict(width=work.width,height=work.height,sourceSize=size,region=[x,y,w,h],
                luminanceP01P50P99=percentiles,mimeType=mime,data=base64.b64encode(data.getvalue()).decode())


def source_image(args):
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
    return read_image(page,original,args.get('imageData'))


def replace_pixels(args):
    source = source_image(args)
    raw = base64.b64decode(args['replacement'], validate=True)
    replacement = Image.open(io.BytesIO(raw))
    validate_dimensions(*replacement.size)
    replacement.load()
    region,_ = vision_options({'region':args.get('region',[0,0,1,1])})
    x,y,w,h = region
    left,top = math.floor(x*source.width),math.floor(y*source.height)
    right,bottom = math.ceil((x+w)*source.width),math.ceil((y+h)*source.height)
    if region == (0,0,1,1):
        result = replacement.convert('RGBA' if 'A' in replacement.getbands() else 'RGB')
    else:
        result = source.copy()
        patch = ImageOps.fit(replacement.convert(result.mode),(right-left,bottom-top),method=Image.Resampling.LANCZOS)
        result.paste(patch,(left,top))
    out=io.BytesIO()
    result.save(out,format='PNG')
    if out.tell()>32*1024**2: raise ValueError('Replacement exceeds 32 MiB; use a smaller source image')
    return {'imageData':base64.b64encode(out.getvalue()).decode(),'size':result.size}

def preview(args):
    from pathlib import Path
    start=time.perf_counter()
    if 'input' in args:
        path=Path(args['input']);stat=path.stat();source=(str(path),stat.st_size,stat.st_mtime_ns)
    else:source=hashlib.sha256(args['bytes'].encode()).hexdigest()
    key=(source,args.get('page',1),args.get('index'),hashlib.sha256((args.get('imageData') or '').encode()).hexdigest())
    proxy_edge = 1200
    if 'vision' in args:
        (_,_,w,h),edge = vision_options(args['vision'])
        proxy_edge = min(2048, max(edge, math.ceil(edge/min(w,h))))
        key += (proxy_edge,)
    entry=_proxies.pop(key,None)
    hit=entry is not None
    if entry is None:
        image=source_image(args);size=image.size
        image.thumbnail((proxy_edge,proxy_edge),Image.Resampling.LANCZOS)
        entry={'image':image,'size':size,'histogram':image.convert('L').histogram(),'histograms':dict(zip(('r','g','b'),[c.histogram() for c in image.convert('RGB').split()]))}
    _proxies[key]=entry
    while len(_proxies)>3:_proxies.popitem(last=False)
    image=entry['image'];width,height=entry['size']
    if 'vision' in args:
        return vision_result(image,args,entry['size'])
    adjusted=process(image,args.get('adjustments',{}),image.width/width)
    def png(im):
        buf=io.BytesIO();im.save(buf,format='PNG',compress_level=1);return base64.b64encode(buf.getvalue()).decode()
    if 'original' not in entry:entry['original']=png(image)
    clipping=None
    if args.get('clipMode') in ('black','white'):
        clipped=adjusted.convert('RGB').point(([0]+[255]*255 if args['clipMode']=='black' else [0]*255+[255])*3)
        if 'A' in adjusted.getbands():clipped.putalpha(adjusted.getchannel('A'))
        clipping=png(clipped)
    return {'original':entry['original'],'preview':png(adjusted),'clippingPreview':clipping,'width':width,'height':height,'histogram':entry['histogram'],'histograms':entry['histograms'],'adjustedHistogram':adjusted.convert('L').histogram(),'proxy':image.size!=entry['size'],'cacheHit':hit,'milliseconds':round((time.perf_counter()-start)*1000,1)}

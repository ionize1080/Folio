"""Recompress image streams while keeping vector/text objects and form fields."""
import base64, io
import fitz
from PIL import Image

def process(args):
    o=args.get('options') or {};presets={'screen':(96,60),'balanced':(150,78),'print':(300,90),'custom':(150,78)}
    preset=o.get('preset','balanced')
    if preset not in presets:raise ValueError('未知图片压缩预设')
    dpi=o.get('dpi',presets[preset][0]);quality=o.get('quality',presets[preset][1])
    if type(dpi)!=int or not 72<=dpi<=600 or type(quality)!=int or not 20<=quality<=100:raise ValueError('分辨率须为 72–600 DPI，质量须为 20–100')
    with fitz.open(args['input']) as doc:
        if doc.needs_pass and not doc.authenticate(o.get('password','')):raise ValueError('需要文档密码')
        images={};changed=0;skipped=0
        for page in doc:
            for image in page.get_images(full=True):
                xref=image[0]
                item=images.setdefault(xref,{'page':page.number,'width':0,'height':0,'mask':image[1]})
                for rect in page.get_image_rects(xref):
                    item['width']=max(item['width'],abs(rect.width));item['height']=max(item['height'],abs(rect.height))
        for xref,item in images.items():
            raw=doc.extract_image(xref)
            if not raw or item['mask'] or raw['width']*raw['height']>40_000_000 or not item['width']:
                skipped+=1;continue
            # Line art and bitonal scans stay lossless; JPEG would introduce ringing.
            if raw.get('bpc',8)==1:skipped+=1;continue
            with Image.open(io.BytesIO(raw['image'])) as im:
                im.load();im=im.convert('L' if o.get('grayscale') else 'RGB')
                scale=min(1,item['width']*dpi/72/im.width,item['height']*dpi/72/im.height)
                if scale<.95:im=im.resize((max(1,round(im.width*scale)),max(1,round(im.height*scale))),Image.Resampling.LANCZOS)
                buf=io.BytesIO();im.save(buf,format='JPEG',quality=quality,optimize=True)
            if len(buf.getvalue())<len(raw['image'])*.95:
                doc[item['page']].replace_image(xref,stream=buf.getvalue());changed+=1
        data=doc.tobytes(garbage=4,deflate=True)
    import pathlib
    original=pathlib.Path(args['input']).read_bytes()
    if len(data)>=len(original):data=original;changed=0
    return {'bytes':base64.b64encode(data).decode(),'extension':'pdf','size':len(data),'originalSize':len(original),
            'reduction':round(1-len(data)/len(original),4),'imagesChanged':changed,'imagesPreserved':skipped,'dpi':dpi,'quality':quality}

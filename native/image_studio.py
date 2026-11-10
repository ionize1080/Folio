"""The studio sees the same oriented, clipped image as the PDF reader.

PDF image samples have their own orientation, unrelated to the page's visual
orientation. Bake only that visual transform into an isolated RGBA image, and
return its inverse placement frame. Applying the result then neither flips it
again nor changes its page position. Other page artwork is never sampled.
"""
import base64
import io
import math

import fitz
from pypdf import PdfWriter
from pypdf.generic import ContentStream, FloatObject, NameObject as N

from image_adjustments import add_image, bounded, process, source_image, validate_dimensions


def source_clips(args):
    """Replay active vector clips in absolute page coordinates, without paints.

    Unlike text layout's rectangular safety bounds, studio pixels can preserve
    curved, rotated and even-odd clips exactly. A path is transformed when it is
    constructed; later cm operators and q/Q must not transform its old points.
    """
    from image_adjustments import source_object
    _,stream,at=source_object(args)
    matrix=(1,0,0,1,0,0);clips=();stack=[];path=[];pending=None
    current=start=None
    def point(x,y):
        a,b,c,d,e,f=matrix
        return (a*float(x)+c*float(y)+e,b*float(x)+d*float(y)+f)
    def emit(values,op):
        path.append(([FloatObject(x) for x in values],op))
    for values,op in stream.operations[:at]:
        if op==b'q':stack.append((matrix,clips))
        elif op==b'Q':matrix,clips=stack.pop() if stack else ((1,0,0,1,0,0),())
        elif op==b'cm':
            a,b,c,d,e,f=map(float,values);A,B,C,D,E,F=matrix
            matrix=(A*a+C*b,B*a+D*b,A*c+C*d,B*c+D*d,A*e+C*f+E,B*e+D*f+F)
        elif op==b're':
            x,y,w,h=map(float,values);points=[point(x,y),point(x+w,y),point(x+w,y+h),point(x,y+h)]
            emit(points[0],b'm')
            for xy in points[1:]:emit(xy,b'l')
            emit([],b'h');current=start=points[0]
        elif op in (b'm',b'l'):
            current=point(*values);emit(current,op)
            if op==b'm':start=current
        elif op==b'c':
            points=[point(*values[n:n+2]) for n in (0,2,4)]
            emit([v for xy in points for v in xy],b'c');current=points[-1]
        elif op in (b'v',b'y'):
            first,last=point(*values[:2]),point(*values[2:])
            points=[current,first,last] if op==b'v' else [first,last,last]
            if current is None:raise ValueError('图片剪裁曲线缺少起点')
            emit([v for xy in points for v in xy],b'c');current=last
        elif op==b'h':emit([],b'h');current=start
        elif op in (b'W',b'W*'):pending=op
        if op in (b'n',b'S',b's',b'f',b'F',b'f*',b'B',b'B*',b'b',b'b*'):
            if pending is not None:clips+=((tuple(path),pending),)
            path=[];pending=None;current=start=None
    return [item for path,rule in clips for item in (*path,([],rule),([],b'n'))]


def export_image(args):
    matrix = args.get('matrix')
    if (not isinstance(matrix, list) or len(matrix) != 6 or
            any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in matrix)):
        raise ValueError('工作室图片变换须含六个有限数字')
    a, b, c, d, e, f = matrix
    if abs(a*d-b*c) < 1e-10:
        raise ValueError('工作室图片变换不可逆')
    rotation = args.get('pageRotation', 0)
    if rotation not in (0, 90, 180, 270):
        raise ValueError('页面旋转角度无效')
    crop = args.get('crop') or [0, 0, 0, 0]
    if not isinstance(crop, list) or len(crop) != 4:
        raise ValueError('裁剪须含四个数值')
    left, top, right, bottom = [bounded(v, 0, 99, 'crop')/100 for v in crop]
    if left+right >= .99 or top+bottom >= .99:
        raise ValueError('裁剪后必须保留可见图片')
    clips = args.get('clipBounds') or []
    for clip in clips:
        if clip is None and args.get('index') is not None:continue
        if (not isinstance(clip, (list, tuple)) or len(clip) != 4 or
                any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in clip) or
                clip[2] <= clip[0] or clip[3] <= clip[1]):
            raise ValueError('图片剪裁路径无效')

    image = process(source_image(args), args.get('adjustments') or {})
    if args.get('perspective'):
        from image_geometry import rectify
        image = rectify(image, args['perspective'])
    points = [(e, f), (e+a, f+b), (e+c, f+d), (e+a+c, f+b+d)]
    x0, y0 = min(x for x, y in points), min(y for x, y in points)
    x1, y1 = max(x for x, y in points), max(y for x, y in points)
    width, height = x1-x0, y1-y0
    density = max(image.width/math.hypot(a, b), image.height/math.hypot(c, d))
    # Respect the same decoded-image budget as all other image edits. Report any
    # reduction, so the caller can tell the user instead of hiding a quality loss.
    scale = min(density, 32768/width, 32768/height, math.sqrt(100_000_000/(width*height)))
    pw, ph = max(1, min(32768, round(width*scale))), max(1, min(32768, round(height*scale)))
    if pw*ph > 100_000_000:
        ph = max(1, 100_000_000//pw)
    validate_dimensions(pw, ph)
    writer = PdfWriter()
    page = writer.add_blank_page(width=pw, height=ph)
    draw = add_image(writer, page, image)
    def values(v):
        return [FloatObject(x) for x in v]
    operations = [([], b'q'), (values([pw/width, 0, 0, ph/height, -x0*pw/width, -y0*ph/height]), b'cm')]
    if None in clips:
        operations.extend(source_clips(args))
    else:
        for l, bot, r, t in clips:
            operations.extend([(values([l, bot, r-l, t-bot]), b're'), ([], b'W'), ([], b'n')])
    operations.extend([(values(matrix), b'cm'),
                       (values([left, bottom, 1-left-right, 1-top-bottom]), b're'), ([], b'W'), ([], b'n')])
    # Replacement images are centered within the original image's axes. Crop
    # percentages belong to those axes, not the replacement's source pixels.
    if args.get('imageData'):
        fit = args.get('imageFit') or 'contain'
        if fit not in ('contain', 'cover', 'stretch'):
            raise ValueError('图片适配方式无效')
        if fit != 'stretch':
            ow, oh = math.hypot(a, b), math.hypot(c, d)
            factor = (max if fit == 'cover' else min)(ow/image.width, oh/image.height)
            sx, sy = image.width*factor/ow, image.height*factor/oh
            operations.append((values([sx, 0, 0, sy, (1-sx)/2, (1-sy)/2]), b'cm'))
    operations.extend([draw, ([], b'Q')])
    content = ContentStream(None, writer)
    content.operations = operations
    page[N('/Contents')] = writer._add_object(content)
    if rotation:
        page.rotate(rotation)
    buffer = io.BytesIO()
    writer.write(buffer)
    with fitz.open(stream=buffer.getvalue(), filetype='pdf') as doc:
        pix = doc[0].get_pixmap(alpha=True)
        data = pix.tobytes('png')
        dimensions = [pix.width, pix.height]
    frames = {
        0: [width, 0, 0, height, x0, y0],
        90: [0, height, -width, 0, x1, y0],
        180: [-width, 0, 0, -height, x1, y1],
        270: [0, -height, width, 0, x0, y1],
    }
    placed = frames[rotation]
    return dict(imageData=base64.b64encode(data).decode(), matrix=placed,
                box=[placed[4], placed[5], math.hypot(*placed[:2]), math.hypot(*placed[2:4])],
                dimensions=dimensions, resolutionReduced=scale < density*(1-1e-9))

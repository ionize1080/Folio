"""Restore monochrome vector Type3 glyphs to an editable OpenType subset.

Skia emits per-character Type3 fonts for synthetic bold text. Their CharProcs
are real embedded outlines, not missing system fonts. Preserve cubic paths,
glyph-space transforms, Unicode and advance widths without rasterization.
Unsupported paint/clip/image programs remain available for explicit fallback.
"""
import hashlib
import io
import math


def restore(font, siblings=None):
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.t2CharStringPen import T2CharStringPen
    from fontTools.misc.transform import Transform
    from pypdf.generic import ContentStream
    from pypdf._cmap import get_encoding
    from text_advance import font_metrics
    matrix=list(map(float,font.get('/FontMatrix',(.001,0,0,.001,0,0))))
    if len(matrix)!=6 or not all(math.isfinite(v) for v in matrix):raise ValueError('Type3 字体矩阵无效')
    if abs(matrix[1])+abs(matrix[2])>1e-9 or matrix[0]<=0:raise ValueError('Type3 斜向字形需选择替代字体')
    mapping={}
    for source in siblings or [font]:
        _,widths,default=font_metrics(source);encoding,cmap=get_encoding(source)
        differences=source['/Encoding'].get_object().get('/Differences',[])
        names={};code=0
        for item in differences:
            if isinstance(item,int):code=int(item)
            else:names[code]=str(item);code+=1
        procs=source['/CharProcs'].get_object()
        for code,name in names.items():
            if not 0<=code<256 or name not in procs:continue
            char=bytes([code]).decode(encoding) if isinstance(encoding,str) else encoding.get(code,'')
            char=cmap.get(char,char)
            width=widths.get(code,default)
            if len(char)!=1 or 0xd800<=ord(char)<=0xdfff or width is None:continue
            raw=procs[name].get_object().get_data()
            previous=mapping.get(ord(char))
            if previous and (previous[0]!=width or previous[1]!=raw):raise ValueError('同名 Type3 字形不一致')
            mapping[ord(char)]=(width,raw,procs[name],source.indirect_reference.pdf)
    if not mapping:raise ValueError('Type3 字体缺少 Unicode 映射')
    glyphs={};metrics={};unicode={};order=['.notdef']
    blank=T2CharStringPen(0,None);glyphs['.notdef']=blank.getCharString();metrics['.notdef']=(0,0)
    base=Transform(*(v*1000 for v in matrix))
    for cp,(width,raw,program,pdf) in sorted(mapping.items()):
        pen=T2CharStringPen(width,None);transform=base;stack=[];opened=False;current=None
        operations=ContentStream(program,pdf).operations
        def point(x,y):return transform.transformPoint((float(x),float(y)))
        for args,op in operations:
            if op in (b'd0',b'd1'):continue
            if op==b'q':stack.append(transform)
            elif op==b'Q':
                if not stack:raise ValueError('Type3 图形状态不平衡')
                transform=stack.pop()
            elif op==b'cm':transform=transform.transform(tuple(map(float,args)))
            elif op==b'm':
                if opened:pen.closePath()
                current=point(*args);pen.moveTo(current);opened=True
            elif op==b'l':current=point(*args);pen.lineTo(current)
            elif op==b'c':
                a,b,c=point(*args[:2]),point(*args[2:4]),point(*args[4:6]);pen.curveTo(a,b,c);current=c
            elif op==b'v':
                b,c=point(*args[:2]),point(*args[2:4]);pen.curveTo(current,b,c);current=c
            elif op==b'y':
                a,c=point(*args[:2]),point(*args[2:4]);pen.curveTo(a,c,c);current=c
            elif op==b'h':
                if opened:pen.closePath();opened=False
            elif op==b're':
                if opened:pen.closePath()
                x,y,w,h=map(float,args);pen.moveTo(point(x,y));pen.lineTo(point(x+w,y));pen.lineTo(point(x+w,y+h));pen.lineTo(point(x,y+h));pen.closePath();opened=False
            elif op in (b'f',b'F'):
                if opened:pen.closePath();opened=False
            else:raise ValueError('Type3 字形包含非单色轮廓绘制：'+op.decode('ascii',errors='replace'))
        if stack:raise ValueError('Type3 图形状态不平衡')
        if opened:pen.closePath()
        key='uni%06X'%cp;order.append(key);glyphs[key]=pen.getCharString();metrics[key]=(round(width),0);unicode[cp]=key
    if not unicode:raise ValueError('Type3 字体没有可恢复字形')
    descriptor=font.get('/FontDescriptor',{});descriptor=descriptor.get_object() if hasattr(descriptor,'get_object') else descriptor
    label=str(descriptor.get('/FontFamily','Type3'))
    ps='FolioType3-'+hashlib.sha256(repr(sorted(mapping)).encode()).hexdigest()[:12]
    builder=FontBuilder(1000,isTTF=False);builder.setupGlyphOrder(order);builder.setupCharacterMap(unicode)
    builder.setupCFF(ps,{'FullName':label,'FamilyName':label,'Weight':'Bold' if descriptor.get('/FontWeight',400)>=600 else 'Regular'},glyphs,{})
    builder.setupHorizontalMetrics(metrics);builder.setupHorizontalHeader(ascent=1000,descent=-300)
    builder.setupNameTable({'familyName':label,'styleName':'Regular','uniqueFontIdentifier':ps,'fullName':label,'psName':ps,'version':'Version 1.0'})
    builder.setupOS2(sTypoAscender=1000,sTypoDescender=-300,usWinAscent=1000,usWinDescent=300,usWeightClass=int(descriptor.get('/FontWeight',400)))
    builder.setupPost()
    # Content-addressed fonts must not change identity merely because another
    # page or process restored the same outlines a second later.
    builder.font['head'].created=builder.font['head'].modified=3786912000
    builder.font.recalcTimestamp=False
    buf=io.BytesIO();builder.save(buf)
    return buf.getvalue(),set(unicode)

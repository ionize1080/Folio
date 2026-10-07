"""Track effective stream clips even when PDFium drops an original no-op clip.

A clip that contains the original glyphs can still truncate replacement ink.
Rectangles are certified; curves/compound paths retain an unknown marker.
"""
def clip_states(operations):
    matrix=(1,0,0,1,0,0);clips=();stack=[];path=[];pending=False;result={}
    def point(x,y):
        a,b,c,d,e,f=matrix
        return (a*float(x)+c*float(y)+e,b*float(x)+d*float(y)+f)
    for i,(args,op) in enumerate(operations):
        if op==b'q':stack.append((matrix,clips))
        elif op==b'Q':matrix,clips=stack.pop() if stack else ((1,0,0,1,0,0),())
        elif op==b'cm':
            a,b,c,d,e,f=map(float,args);A,B,C,D,E,F=matrix
            matrix=(A*a+C*b,B*a+D*b,A*c+C*d,B*c+D*d,A*e+C*f+E,B*e+D*f+F)
        elif op==b're':
            x,y,w,h=map(float,args);path.append([point(x,y),point(x+w,y),point(x+w,y+h),point(x,y+h)])
        elif op in (b'm',b'l',b'c',b'v',b'y',b'h'):path.append(None)
        elif op in (b'W',b'W*'):pending=True
        if op in (b'n',b'S',b's',b'f',b'F',b'f*',b'B',b'B*',b'b',b'b*'):
            if pending:
                rect=None
                if len(path)==1 and path[0]:
                    pts=path[0];xs=sorted(set(x for x,y in pts));ys=sorted(set(y for x,y in pts))
                    if len(xs)==2 and len(ys)==2:rect=(xs[0],ys[0],xs[1],ys[1])
                clips=clips+(rect,)
            pending=False;path=[]
        result[i]=clips
    return result


def validate_ink(boxes, clips):
    if not clips:return
    if any(clip is None for clip in clips) or any(
        box[0]<clip[0]-.01 or box[1]<clip[1]-.01 or box[2]>clip[2]+.01 or box[3]>clip[3]+.01
        for box in boxes for clip in clips):
        raise ValueError('新文字超出原 PDF 裁剪边界，请缩小文字或调整位置；草稿已保留')

def validate_fragment(blob, clips):
    if not clips:return
    import pypdfium2 as pdfium
    with pdfium.PdfDocument(blob) as doc:
        page=doc[0]
        try:validate_ink([o.get_bounds() for o in page.get_objects(max_depth=1)],clips)
        finally:page.close()


def validate_patch(page, stream, index, count, at, patch, clips):
    """Measure original-font replacement ink before the inherited clip is applied.

    Keep the original font/codes when possible. A verified object-order match is
    required; otherwise the caller uses its normal validated fragment path.
    """
    if not clips:return True
    import io
    import pypdfium2 as pdfium
    from pypdf import PdfWriter
    from pypdf.generic import ContentStream, NameObject
    writer=PdfWriter();candidate=writer.add_page(page)
    content=ContentStream(None,writer);operations=[]
    for i,(args,op) in enumerate(stream.operations):
        if op in (b'W',b'W*'):continue
        operations.extend(patch if i==at else [(args,op)])
    content.operations=operations
    candidate[NameObject('/Contents')]=writer._add_object(content)
    output=io.BytesIO();writer.write(output)
    with pdfium.PdfDocument(output.getvalue()) as document:
        rendered=document[0]
        try:
            objects=list(rendered.get_objects(max_depth=1))
            if len(objects)!=count or objects[index].type!=1:return False
            validate_ink([objects[index].get_bounds()],clips)
        finally:rendered.close()
    return True

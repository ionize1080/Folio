"""Justify Story's shaped lines in PDF text space, preserving glyph outlines.

Story wraps CJK correctly but does not distribute inter-character space. Adjust
the actual TJ advances once; SVG, selection geometry and saved PDF all come
from this adjusted fragment. Paragraph-final lines stay left aligned.
"""
import io, math, unicodedata
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, ArrayObject, ByteStringObject, FloatObject, NameObject


def justify_fragment(blob, model, frames, glyphs):
    import fitz
    with fitz.open(stream=blob, filetype='pdf') as doc:
        traces=[(c, span) for span in doc[0].get_texttrace() for c in span['chars']]
    if not traces or not glyphs:return blob
    # Story's output is in source order. Match by origin, not by font bbox
    # height (mixed fonts can have very different ascenders on the same line).
    mapped={}
    for g in glyphs:
        mapped.setdefault((round(g['x'],2),round(g['baseline'],2)),[]).append(g)
    lines=[]
    for i,(c,span) in enumerate(traces):
        x,y=c[2];g=next(iter(mapped.get((round(x,2),round(y,2)),[])),None)
        if g is None:raise ValueError('两端对齐字位映射不完整，请更换字体后重试')
        fi=next((j for j,r in enumerate(frames) if r[0]-.5<=x<=r[2]+.5 and r[1]-model['size']<=y<=r[3]+model['size']),None)
        if fi is None:raise ValueError('两端对齐文字超出文本框')
        if not lines or lines[-1]['frame']!=fi or abs(lines[-1]['y']-y)>.5:
            lines.append({'frame':fi,'y':y,'chars':[]})
        lines[-1]['chars'].append((i,c,g))
    shifts=[0.0]*len(traces)
    def cjk(ch):return unicodedata.east_asian_width(ch) in ('W','F') and not ch.isspace()
    source=model['text'].encode('utf-16-le')
    for li,line in enumerate(lines[:-1]):
        chars=line['chars'];nxt=lines[li+1]['chars']
        end=max(g['end'] for _,_,g in chars);start=min(g['start'] for _,_,g in nxt)
        if b'\n\x00' in source[end*2:start*2]:continue
        # Exclude trailing whitespace from the alignment edge.
        last=next((j for j in range(len(chars)-1,-1,-1) if not chr(chars[j][1][0]).isspace()),-1)
        if last<1:continue
        edge=chars[last][2]['x']+chars[last][2]['w']
        extra=frames[line['frame']][2]-edge
        if extra<=.01:continue
        gaps=[]
        for j in range(last):
            a,b=chr(chars[j][1][0]),chr(chars[j+1][1][0])
            # Word spaces for Latin; character boundaries for CJK. Never
            # insert spacing before a combining mark or split a Latin word.
            if not unicodedata.combining(b) and (a.isspace() or (cjk(a) or cjk(b)) and not b.isspace()):gaps.append(j)
        if not gaps:continue
        amount=extra/len(gaps);used=0;gapset=set(gaps)
        for j,(idx,_,_) in enumerate(chars):
            shifts[idx]=used*amount
            if j in gapset:used+=1
    if not any(shifts):return blob
    reader=PdfReader(io.BytesIO(blob));page=reader.pages[0]
    stream=ContentStream(page.get('/Contents'),reader);fonts=page['/Resources']['/Font']
    size=0;step=2;scale=1;hz=1;current=0;index=0;operations=[]
    for args,op in stream.operations:
        if op==b'Tf':
            size=float(args[1]);font=fonts[args[0]].get_object()
            if font.get('/Subtype')=='/Type0':
                if font.get('/Encoding')!='/Identity-H':raise ValueError('两端对齐字体编码不受支持')
                step=2
            else:step=1
        elif op==b'Tz':hz=float(args[0])/100
        elif op==b'Tm':scale=math.hypot(float(args[0]),float(args[1]));current=0
        elif op in (b'BT',b'Td',b'TD',b'T*'):current=0
        if op not in (b'Tj',b'TJ'):
            if op in (b"'",b'"'):raise ValueError('不支持的排版文字操作符')
            operations.append((args,op));continue
        if size*scale*hz<=0:raise ValueError('两端对齐文字矩阵无效')
        values=args[0] if op==b'TJ' else [args[0]];out=[]
        for v in values:
            if isinstance(v,(str,bytes)):
                raw=v.original_bytes if hasattr(v,'original_bytes') else bytes(v)
                if len(raw)%step:raise ValueError('两端对齐字符编码不完整')
                for j in range(0,len(raw),step):
                    if index>=len(shifts):raise ValueError('两端对齐字形数量不匹配')
                    delta=shifts[index]-current
                    if abs(delta)>.00001:out.append(FloatObject(-delta*1000/(size*scale*hz)))
                    out.append(ByteStringObject(raw[j:j+step]));current=shifts[index];index+=1
            else:out.append(v)
        operations.append(([ArrayObject(out)],b'TJ'))
    if index!=len(shifts):raise ValueError('两端对齐字形数量不匹配')
    stream.operations=operations;page[NameObject('/Contents')]=stream
    writer=PdfWriter();writer.add_page(page);buf=io.BytesIO();writer.write(buf)
    return buf.getvalue()

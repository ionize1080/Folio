"""Encode supplementary scalars emitted by older MuPDF as PDF UTF-16BE.

Only invalid five/six-hex scalar destinations are repaired. Valid multi-codepoint
UTF-16 sequences, source character codes and glyph indices remain untouched.
"""
import re

RANGE=re.compile(rb'(?m)^\s*<([0-9a-fA-F]{1,4})>\s*<([0-9a-fA-F]{1,4})>\s*<([0-9a-fA-F]{5,6})>\s*$')
CHAR=re.compile(rb'(?m)^\s*<([0-9a-fA-F]{1,4})>\s*<([0-9a-fA-F]{5,6})>\s*$')

def scalar(cp):
    if not 0x10000<=cp<=0x10ffff:raise ValueError('生成字体的 Unicode 标量无效')
    return b'<'+chr(cp).encode('utf-16-be').hex().encode()+b'>'

def repair_map(data):
    def interval(m):
        a,b,cp=(int(v,16) for v in m.groups())
        if b<a or b-a>65535:raise ValueError('生成字体的字符范围无效')
        return b'<'+m[1]+b'> <'+m[2]+b'> ['+b' '.join(scalar(cp+i)for i in range(b-a+1))+b']'
    return CHAR.sub(lambda m:b'<'+m[1]+b'> '+scalar(int(m[2],16)),RANGE.sub(interval,data))

def parse_unicode(font, parser):
    from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject
    cmap=font.get('/ToUnicode')
    if cmap:
        raw=cmap.get_object().get_data();fixed=repair_map(raw)
        if fixed!=raw:
            font=DictionaryObject(dict(font));stream=DecodedStreamObject();stream.set_data(fixed)
            font[NameObject('/ToUnicode')]=stream
    return parser(font)

def repair(blob):
    import fitz
    with fitz.open(stream=blob,filetype='pdf') as doc:
        changed=False;seen=set()
        for page in doc:
            for font in page.get_fonts(full=True):
                kind,value=doc.xref_get_key(font[0],'ToUnicode')
                if kind!='xref':continue
                ref=int(value.split()[0])
                if ref in seen:continue
                seen.add(ref);data=doc.xref_stream(ref);fixed=repair_map(data)
                if fixed!=data:doc.update_stream(ref,fixed);changed=True
        return doc.tobytes(garbage=3,deflate=True) if changed else blob

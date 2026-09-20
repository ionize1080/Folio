"""Wrap raw CFF into OpenType without substituting outlines or advances.
Chromium FontFace accepts sfnt/WOFF; PDF standard fonts may be raw CFF.
"""
import io,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'vendor'))
def opentype(blob):
    if blob[:4] in (b'OTTO',b'\0\1\0\0',b'true'):return blob
    if blob[:1]!=b'\x01':raise ValueError('此字体格式尚不能用于快速预览，请使用精排模式')
    import fitz
    from fontTools.cffLib import CFFFontSet
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.t2CharStringPen import T2CharStringPen
    from fontTools.pens.recordingPen import RecordingPen
    cff=CFFFontSet();cff.decompile(io.BytesIO(blob),None);top=cff.topDictIndex[0];order=list(top.charset)
    face=fitz.Font(fontbuffer=blob);cmap={}
    for cp in face.valid_codepoints():
        gid=face.has_glyph(cp)
        if 0<gid<len(order):cmap[cp]=order[gid]
    if not cmap:raise ValueError('字体缺少可核验的 Unicode 映射')
    matrix=top.FontMatrix
    if any(abs(a-b)>1e-8 for a,b in zip(matrix,[.001,0,0,.001,0,0])):raise ValueError('此 CFF 字体采用非常规坐标单位')
    chars={};metrics={}
    for name in order:
        old=top.CharStrings[name];recording=RecordingPen();old.draw(recording);width=round(old.width)
        pen=T2CharStringPen(width,None);recording.replay(pen)
        chars[name]=pen.getCharString();metrics[name]=(width,0)
    bold=bool(face.flags.get('bold'));italic=bool(face.flags.get('italic'));name=face.name
    fb=FontBuilder(1000,isTTF=False);fb.setupGlyphOrder(order);fb.setupCharacterMap(cmap);fb.setupHorizontalMetrics(metrics)
    ascent=round(face.ascender*1000);descent=round(face.descender*1000)
    fb.setupHorizontalHeader(ascent=ascent,descent=descent)
    ps='FolioFast-'+''.join(c for c in name if c.isalnum())[:45]
    fb.setupNameTable({'familyName':name,'styleName':('Bold' if bold else '')+(' Italic' if italic else '') or 'Regular','uniqueFontIdentifier':ps,'fullName':name,'psName':ps})
    fb.setupOS2(sTypoAscender=ascent,sTypoDescender=descent,usWinAscent=max(1000,ascent),usWinDescent=max(250,-descent),usWeightClass=700 if bold else 400,fsSelection=(32 if bold else 0)|(1 if italic else 0)|(64 if not bold and not italic else 0))
    fb.setupPost(italicAngle=-12 if italic else 0);fb.setupCFF(ps,{'FullName':name,'FamilyName':name,'Weight':'Bold' if bold else 'Regular'},chars,{})
    fb.font['head'].macStyle=(1 if bold else 0)|(2 if italic else 0)
    out=io.BytesIO();fb.save(out);return out.getvalue()

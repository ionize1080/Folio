"""Wrap raw CFF into OpenType without substituting outlines or advances.
Chromium FontFace accepts sfnt/WOFF; PDF standard fonts may be raw CFF.
"""
import io,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'vendor'))
def read_cff(blob):
    from fontTools.cffLib import CFFFontSet,CharsetConverter
    cff=CFFFontSet();cff.decompile(io.BytesIO(blob),None);top=cff.topDictIndex[0]
    if 'charset' not in top.rawDict and 'charset' not in top.__dict__:
        # CFF1's omitted charset means the predefined ISOAdobe charset, not
        # an absent Python attribute (fontTools intentionally has no default).
        top.charset=CharsetConverter()._read(top,0)
    if not top.charset:raise ValueError('CFF 字体缺少可核验的字符顺序')
    return cff,top

def opentype(blob,mapping=None):
    if blob[:4] in (b'OTTO',b'\0\1\0\0',b'true'):
        from font_sfnt import normalize,tables,build
        if blob[:4]==b'OTTO':
            parts=tables(blob)
            if b'CFF ' in parts:
                cff,top=read_cff(parts[b'CFF '])
                order=list(top.charset)
                if hasattr(top,'ROS') and any(name!=('.notdef' if gid==0 else 'cid%05d'%gid) for gid,name in enumerate(order)):
                    renamed={name:('.notdef' if gid==0 else 'cid%05d'%gid) for gid,name in enumerate(order)}
                    top.CharStrings.charStrings={renamed[name]:value for name,value in top.CharStrings.charStrings.items()}
                    top.charset=[renamed[name] for name in order];top.ROS=('Adobe','Identity',0);top.CIDCount=len(order)
                    from types import SimpleNamespace
                    out=io.BytesIO();cff.compile(out,SimpleNamespace(recalcBBoxes=False,getGlyphOrder=lambda:top.charset))
                    parts[b'CFF ']=out.getvalue();blob=build(blob[:4],parts)
        return normalize(blob)
    if blob.startswith((b'%!', b'\x80\x01')):
        from type1_restore import restore_type1
        return restore_type1(blob,None,'Embedded Type1')[0]
    if blob[:1]!=b'\x01':raise ValueError('此字体格式尚不能用于快速预览，请使用精排模式')
    import fitz
    from fontTools.fontBuilder import FontBuilder
    from fontTools.ttLib import newTable
    from fontTools.pens.boundsPen import BoundsPen
    cff,top=read_cff(blob);order=list(top.charset)
    if hasattr(top,'ROS'):
        # MuPDF's PDF writer emits the OpenType GID as the character code.
        # A nonidentity CID charset would make PDF readers paint a different
        # outline. Canonicalize only CID names; retain GID order, programs,
        # FDSelect/FDArray, hinting and subroutines byte-for-byte in meaning.
        renamed={name:('.notdef' if gid==0 else 'cid%05d'%gid) for gid,name in enumerate(order)}
        top.CharStrings.charStrings={renamed[name]:value for name,value in top.CharStrings.charStrings.items()}
        top.charset=[renamed[name] for name in order];order=list(top.charset)
        top.ROS=('Adobe','Identity',0);top.CIDCount=len(order)
    face=fitz.Font(fontbuffer=blob);cmap={}
    source=mapping if mapping is not None else {cp:face.has_glyph(cp) for cp in face.valid_codepoints()}
    for cp,gid in source.items():
        if 0<gid<len(order):cmap[cp]=order[gid]
    if not cmap:raise ValueError('字体缺少可核验的 Unicode 映射')
    matrix=top.FontMatrix
    if any(abs(a-b)>1e-8 for a,b in zip(matrix,[.001,0,0,.001,0,0])):raise ValueError('此 CFF 字体采用非常规坐标单位')
    metrics={}
    for name in order:
        old=top.CharStrings[name];pen=BoundsPen(None);old.draw(pen);width=round(old.width)
        metrics[name]=(width,round(pen.bounds[0]) if pen.bounds else 0)
    bold=bool(face.flags.get('bold'));italic=bool(face.flags.get('italic'));name=face.name
    fb=FontBuilder(1000,isTTF=False);fb.setupGlyphOrder(order);fb.setupCharacterMap(cmap);fb.setupHorizontalMetrics(metrics)
    ascent=round(face.ascender*1000);descent=round(face.descender*1000)
    fb.setupHorizontalHeader(ascent=ascent,descent=descent)
    ps='FolioFast-'+''.join(c for c in name if c.isalnum())[:45]
    fb.setupNameTable({'familyName':name,'styleName':('Bold' if bold else '')+(' Italic' if italic else '') or 'Regular','uniqueFontIdentifier':ps,'fullName':name,'psName':ps})
    fb.setupOS2(sTypoAscender=ascent,sTypoDescender=descent,usWinAscent=max(1000,ascent),usWinDescent=max(250,-descent),usWeightClass=700 if bold else 400,fsSelection=(32 if bold else 0)|(1 if italic else 0)|(64 if not bold and not italic else 0))
    fb.setupPost(italicAngle=-12 if italic else 0)
    # Preserve the original CharStrings, hints, FDSelect, FDArray and all local
    # and global subroutines. CID is mapped via charset, never treated as GID.
    cff.otFont=fb.font;fb.font.sfntVersion='OTTO'
    fb.font['CFF ']=newTable('CFF ');fb.font['CFF '].cff=cff
    fb.font['head'].macStyle=(1 if bold else 0)|(2 if italic else 0)
    out=io.BytesIO();fb.save(out);return out.getvalue()

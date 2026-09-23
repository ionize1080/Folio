"""Rebuild verified simple Type1 Unicode mappings with original cubic outlines.
No guessed coverage: only PDF ToUnicode -> encoding -> existing glyph mappings.
"""
import io, tempfile, os, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'vendor'))
def restore_type1(blob,unicode_map,name,segments=None):
    from fontTools.t1Lib import T1Font
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.t2CharStringPen import T2CharStringPen
    if segments and not blob.startswith(b'\x80\x01'):
        a,b,c=segments
        # A PDF FontFile may deliberately omit the PFA padding/trailer. Accept
        # that form only when the descriptor lengths bound the entire program.
        if c==0 and a>0 and b>0 and a+b==len(blob) and b'eexec' in blob[max(0,a-64):a]:
            blob+=b'\n'+b'0'*512+b'\ncleartomark\n'
    with tempfile.NamedTemporaryFile(suffix='.pfa',delete=False) as f:
        f.write(blob);path=f.name
    try:
        font=T1Font(path);font.parse()
    finally:os.unlink(path)
    matrix=font['FontMatrix']
    if any(abs(a-b)>1e-8 for a,b in zip(matrix,[.001,0,0,.001,0,0])):raise ValueError('Nonstandard Type1 matrix')
    glyphs=font.getGlyphSet();order=['.notdef']+[g for g in glyphs if g!='.notdef'];encoding=font['Encoding'];cmap={}
    if unicode_map is None:
        from fontTools.agl import toUnicode
        unicode_map={chr(i):toUnicode(g) for i,g in enumerate(encoding) if g in glyphs and g!='.notdef'}
    for code,char in unicode_map.items():
        if not isinstance(code,str) or len(code)!=1 or not isinstance(char,str) or len(char)!=1:continue
        n=ord(code)
        if n<len(encoding) and encoding[n] in glyphs and encoding[n]!='.notdef':cmap[ord(char)]=encoding[n]
    if not cmap:raise ValueError('No verified Unicode mapping')
    chars={};metrics={}
    for g in order:
        pen=T2CharStringPen(None,glyphs);glyphs[g].draw(pen);width=round(glyphs[g].width)
        pen.width=width;chars[g]=pen.getCharString();metrics[g]=(width,0)
    fb=FontBuilder(1000,isTTF=False);fb.setupGlyphOrder(order);fb.setupCharacterMap(cmap)
    fb.setupHorizontalMetrics(metrics);fb.setupHorizontalHeader(ascent=1000,descent=-250)
    ps='FolioRestored-'+''.join(c for c in name.split('+')[-1] if c.isalnum())[:45]
    info=font.font.get('FontInfo',{});weight=str(info.get('Weight','Regular'))
    angle=float(info.get('ItalicAngle',0));bold=any(v in weight.lower() for v in ('bold','demi','black'));italic=bool(angle)
    style=' '.join(v for v,on in [('Bold',bold),('Italic',italic)] if on) or 'Regular'
    fb.setupNameTable({'familyName':name.split('+')[-1],'styleName':style,'uniqueFontIdentifier':ps,'fullName':name.split('+')[-1],'psName':ps})
    fb.setupOS2(sTypoAscender=1000,sTypoDescender=-250,usWinAscent=1100,usWinDescent=300,usWeightClass=700 if bold else 400,fsSelection=(32 if bold else 0)|(1 if italic else 0)|(64 if not bold and not italic else 0))
    fb.setupPost(italicAngle=angle);fb.setupCFF(ps,{'FullName':name.split('+')[-1],'FamilyName':name.split('+')[-1],'Weight':weight,'ItalicAngle':angle},chars,{})
    fb.font['head'].macStyle=(1 if bold else 0)|(2 if italic else 0)
    out=io.BytesIO();fb.save(out)
    return out.getvalue(),set(cmap)

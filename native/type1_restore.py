"""Rebuild verified simple Type1 Unicode mappings with original cubic outlines.
No guessed coverage: only PDF ToUnicode -> encoding -> existing glyph mappings.
"""
import io, tempfile, os, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'vendor'))
def restore_type1(blob,unicode_map,name):
    from fontTools.t1Lib import T1Font
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.t2CharStringPen import T2CharStringPen
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
    fb.setupNameTable({'familyName':name.split('+')[-1],'styleName':'Regular','uniqueFontIdentifier':ps,'fullName':name.split('+')[-1],'psName':ps})
    fb.setupOS2(sTypoAscender=1000,sTypoDescender=-250,usWinAscent=1100,usWinDescent=300)
    fb.setupPost();fb.setupCFF(ps,{'FullName':name.split('+')[-1],'FamilyName':name.split('+')[-1],'Weight':'Regular'},chars,{})
    out=io.BytesIO();fb.save(out)
    return out.getvalue(),set(cmap)

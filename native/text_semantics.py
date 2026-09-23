"""Preserve text scalars when several Unicode characters share one font glyph.

ActualText is the PDF semantic replacement for marked content. It leaves the
original outline and metrics intact, unlike guessing a cmap inverse by GID.
"""
def mark_text(page,text):
    refs=page.get_contents()
    if not refs:return
    doc=page.parent;ref=refs[-1];raw=doc.xref_stream(ref)
    actual=('FEFF'+text.encode('utf-16-be').hex().upper()).encode('ascii')
    doc.update_stream(ref,b'/Span << /ActualText <'+actual+b'> >> BDC\n'+raw+b'\nEMC\n')

def expand_preview(page):
    """Expose overflow for mapping/preview, then callers restore the PDF page.

    Preserve the top-left coordinate system while extending the bottom/right.
    The exported page stays its original size; the UI keeps an explicit warning.
    """
    import fitz,math
    left=top=0
    right,bottom=page.rect.width,page.rect.height
    for span in page.get_texttrace():
        box=span['bbox']
        if all(math.isfinite(v) for v in box):
            left=min(left,box[0]-2);top=min(top,box[1]-2)
            right=max(right,box[2]+2);bottom=max(bottom,box[3]+2)
    left=max(-14400,left);top=max(-14400,top)
    width=min(28800,right-left);height=min(28800,bottom-top)
    original=fitz.Rect(page.mediabox)
    page.set_mediabox(fitz.Rect(left,original.y1-top-height,left+width,original.y1-top))
    return original,{'x':left,'y':top,'width':width,'height':height}

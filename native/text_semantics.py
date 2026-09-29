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

def mark_shows(blob,text):
    """Give each generated show its own semantics, so reopening remains editable.

    The source and decoded non-whitespace scalars must match exactly. Whitespace
    belongs to the adjacent show; no whole-paragraph shared ActualText scope is
    created. Foreign shared semantic scopes retain their existing protection.
    """
    import io
    from pypdf import PdfReader,PdfWriter
    from pypdf.generic import ContentStream,NameObject,DictionaryObject,TextStringObject
    from content import decoded_texts,raw_strings,TEXT
    reader=PdfReader(io.BytesIO(blob));writer=PdfWriter();page=writer.add_page(reader.pages[0])
    stream=ContentStream(page.get('/Contents'),writer);decoded=decoded_texts(page,stream)
    compact=lambda s:''.join(c for c in s if not c.isspace())
    if compact(''.join(decoded.values()))!=compact(text):
        # Shaped ligatures already have the repaired ToUnicode map. Do not
        # invent per-show ownership when the scalar alignment is ambiguous.
        return blob
    cursor=0;actual={}
    for at,value in decoded.items():
        start=cursor
        for ch in value:
            if ch.isspace():continue
            while cursor<len(text) and text[cursor].isspace():cursor+=1
            if cursor>=len(text) or text[cursor]!=ch:return blob
            cursor+=1
        while cursor<len(text) and text[cursor].isspace():cursor+=1
        actual[at]=text[start:cursor]
    operations=[]
    for at,(args,op) in enumerate(stream.operations):
        if actual.get(at):operations.append(([NameObject('/Span'),DictionaryObject({NameObject('/ActualText'):TextStringObject(actual[at])})],b'BDC'))
        operations.append(([raw_strings(v) for v in args] if op in TEXT else args,op))
        if actual.get(at):operations.append(([],b'EMC'))
    stream.operations=operations;page[NameObject('/Contents')]=writer._add_object(stream)
    out=io.BytesIO();writer.write(out);return out.getvalue()

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


def mark_paragraph(blob,text):
    import io
    from pypdf import PdfReader,PdfWriter
    from pypdf.generic import ContentStream,NameObject,DictionaryObject,TextStringObject
    reader=PdfReader(io.BytesIO(blob));writer=PdfWriter();page=writer.add_page(reader.pages[0])
    stream=ContentStream(page.get('/Contents'),writer)
    stream.operations=[([NameObject('/FolioParagraph'),DictionaryObject({NameObject('/FolioText'):TextStringObject(text)})],b'BDC')]+stream.operations+[([],b'EMC')]
    page[NameObject('/Contents')]=writer._add_object(stream);out=io.BytesIO();writer.write(out);return out.getvalue()

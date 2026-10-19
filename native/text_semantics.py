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

    The source and decoded non-whitespace scalars must match exactly. Keep the
    generated show's own whitespace: an old source newline may now lie inside
    one newly wrapped line, and placing that newline in ActualText makes some
    readers repeat the replacement text. FolioParagraph stores source breaks.
    Only shows with an actual scalar correction need a semantic replacement.
    """
    import io
    from pypdf import PdfReader,PdfWriter
    from pypdf.generic import ContentStream,NameObject,DictionaryObject,TextStringObject
    from content import decoded_texts,raw_strings,TEXT
    reader=PdfReader(io.BytesIO(blob));writer=PdfWriter();page=writer.add_page(reader.pages[0])
    stream=ContentStream(page.get('/Contents'),writer);decoded=decoded_texts(page,stream)
    # MuPDF Story may encode a visible ASCII hyphen as U+00AD. Restore the
    # submitted scalar through ActualText, without changing its painted glyph.
    canonical=lambda c:'-' if c=='\u00ad' else c
    compact=lambda s:''.join(canonical(c) for c in s if not c.isspace())
    if compact(''.join(decoded.values()))!=compact(text):
        # Shaped ligatures already have the repaired ToUnicode map. Do not
        # invent per-show ownership when the scalar alignment is ambiguous.
        return blob
    cursor=0;actual={}
    for at,value in decoded.items():
        replacement=[]
        for ch in value:
            if ch.isspace():
                replacement.append(ch)
                continue
            while cursor<len(text) and text[cursor].isspace():cursor+=1
            if cursor>=len(text) or canonical(text[cursor])!=canonical(ch):return blob
            replacement.append(text[cursor])
            cursor+=1
        corrected=''.join(replacement)
        if corrected!=value:actual[at]=corrected
    if not actual:return blob
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


def soft_break_offsets(text,values):
    """Read bounded UTF-16 newline offsets; invalid foreign metadata is ignored."""
    if not isinstance(text,str) or len(text)>100000 or not isinstance(values,(list,tuple)) or len(values)>len(text):return None
    positions=set();offset=0
    for ch in text:
        cp=ord(ch)
        if 0xd800<=cp<=0xdfff:return None
        if ch=='\n':positions.add(offset)
        offset+=2 if cp>0xffff else 1
    if any(isinstance(n,bool) or not isinstance(n,int) or n not in positions for n in values):return None
    return sorted(set(int(n)for n in values))


def paragraph_operations(operations,text,soft_breaks=None,actual_text=False):
    from pypdf.generic import NameObject,DictionaryObject,TextStringObject,ArrayObject,NumberObject
    properties=DictionaryObject({NameObject('/FolioText'):TextStringObject(text)})
    if soft_breaks is not None:
        validated=soft_break_offsets(text,soft_breaks)
        if validated is None:raise ValueError('软换行位置无效')
        properties[NameObject('/FolioSoftBreaks')]=ArrayObject([NumberObject(n)for n in validated])
    if actual_text:properties[NameObject('/ActualText')]=TextStringObject(text)
    return [([NameObject('/FolioParagraph'),properties],b'BDC')]+operations+[([],b'EMC')]


def mark_paragraph(blob,text,soft_breaks=None):
    import io
    from pypdf import PdfReader,PdfWriter
    from pypdf.generic import ContentStream,NameObject
    reader=PdfReader(io.BytesIO(blob));writer=PdfWriter();page=writer.add_page(reader.pages[0])
    stream=ContentStream(page.get('/Contents'),writer)
    stream.operations=paragraph_operations(stream.operations,text,soft_breaks)
    page[NameObject('/Contents')]=writer._add_object(stream);out=io.BytesIO();writer.write(out);return out.getvalue()

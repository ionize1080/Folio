"""Preserve document structure with a bounded object-graph recursion budget.

pypdf's documented cloning limit is Python's recursion limit, not a page limit.
Keep the complete root (tags, forms, outlines, attachments); never discard it to
make a difficult file save. Worker processes isolate this setting from the UI.
"""
import sys
from pypdf import PdfWriter

def clone_document(reader):
    before=sys.getrecursionlimit()
    try:
        sys.setrecursionlimit(max(before,5000))
        return PdfWriter(clone_from=reader)
    except RecursionError as exc:
        raise ValueError('PDF 对象层级超过安全写入预算；原文件和编辑草稿已保留') from exc
    finally:
        sys.setrecursionlimit(before)


def remove_orphans(writer):
    """Trace references without decoding images or recompressing untouched streams."""
    from pypdf.generic import IndirectObject, DictionaryObject, ArrayObject
    live=set();seen=set();pending=[writer._root_object,writer._info]
    if getattr(writer,'_encrypt_entry',None) is not None:pending.append(writer._encrypt_entry)
    while pending:
        value=pending.pop()
        if isinstance(value,IndirectObject):
            if value.pdf is not writer:continue
            if value.idnum in live:continue
            live.add(value.idnum);value=value.get_object()
        identity=id(value)
        if identity in seen:continue
        seen.add(identity)
        ref=getattr(value,'indirect_reference',None)
        if ref is not None and ref.pdf is writer:live.add(ref.idnum)
        if isinstance(value,DictionaryObject):pending.extend(value.values())
        elif isinstance(value,ArrayObject):pending.extend(value)
    for i in range(len(writer._objects)):
        if i+1 not in live:writer._objects[i]=None

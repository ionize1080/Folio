"""Preserve document structure with a bounded object-graph recursion budget.

pypdf's documented cloning limit is Python's recursion limit, not a page limit.
Keep the complete root (tags, forms, outlines, attachments); never discard it to
make a difficult file save. Worker processes isolate this setting from the UI.
"""
import sys
from decimal import Decimal
from math import isfinite
from pypdf import PdfWriter
from pypdf.generic import FloatObject, DictionaryObject, ArrayObject


class SourceFloat(FloatObject):
    """Serialize a cloned PDF real without pypdf's significant-digit rounding."""
    def myrepr(self):
        value=float(self)
        if not isfinite(value):
            raise ValueError('PDF 数值必须为有限数值')
        # PDF numbers cannot use exponent notation. Decimal expands the shortest
        # round-trip float representation without inventing further precision.
        return format(Decimal(repr(value)), 'f')

    def clone(self, pdf_dest, force_duplicate=False, ignore_fields=()):
        return self._reference_clone(SourceFloat(self), pdf_dest, force_duplicate)


def preserve_source_numbers(writer):
    """Keep untouched numeric values, including indirect and shared destinations.

    Walk only the already cloned graph: no stream decoding, reader mutation or
    process-wide patch to pypdf's number formatting is needed.
    """
    numbers={}
    def preserve(value):
        if not isinstance(value,FloatObject) or isinstance(value,SourceFloat):return value
        identity=id(value)
        if identity not in numbers:
            exact=SourceFloat(value)
            if hasattr(value,'indirect_reference'):exact.indirect_reference=value.indirect_reference
            numbers[identity]=exact
        return numbers[identity]
    for i,value in enumerate(writer._objects):writer._objects[i]=preserve(value)
    seen=set();pending=list(writer._objects)
    while pending:
        value=pending.pop()
        if id(value) in seen:continue
        seen.add(id(value))
        if isinstance(value,DictionaryObject):
            for key,child in list(value.items()):
                value[key]=preserve(child)
                if isinstance(child,(DictionaryObject,ArrayObject)):pending.append(child)
        elif isinstance(value,ArrayObject):
            for i,child in enumerate(value):
                value[i]=preserve(child)
                if isinstance(child,(DictionaryObject,ArrayObject)):pending.append(child)
    return writer

def clone_document(reader):
    before=sys.getrecursionlimit()
    try:
        sys.setrecursionlimit(max(before,5000))
        return preserve_source_numbers(PdfWriter(clone_from=reader))
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

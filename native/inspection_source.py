"""A bounded single-page source for read-only native object inspection.

Writing still reopens the complete document. Page contents and resources retain
their operator order, so the signatures and indices inspected here are checked
again against that complete source before any edit is applied.
"""
import hashlib
import io
from collections import OrderedDict

import pikepdf
from form_compat import reopen

_cache = OrderedDict()
MAX_BYTES = 64*1024**2


def inspection_source(data, number):
    if isinstance(number, bool) or not isinstance(number, int) or number < 1:
        raise ValueError('页码无效')
    key = (hashlib.sha256(data).digest(), number)
    cached = _cache.pop(key, None)
    if cached is not None:
        _cache[key] = cached
        return cached, 1
    with pikepdf.open(io.BytesIO(data)) as original:
        if number > len(original.pages):
            raise ValueError('页码无效')
        with pikepdf.Pdf.new() as selected:
            selected.add_pages_from(original, [number-1])
            # The structure tree controls whether foreign wrapper forms may be
            # expanded. Keep that decision identical without traversing its
            # back-references to every page just to inspect one page.
            if '/StructTreeRoot' in original.Root:
                selected.Root.StructTreeRoot = pikepdf.Dictionary(
                    Type=pikepdf.Name.StructTreeRoot, K=pikepdf.Array())
            # Optional-content visibility and color intent can influence native
            # extraction. These catalog entries do not need the full page tree.
            for name in ('/OCProperties', '/OutputIntents', '/MarkInfo', '/Extensions'):
                if name in original.Root:
                    value = original.Root[name]
                    selected.Root[name] = selected.copy_foreign(original.make_indirect(value))
            buffer = io.BytesIO()
            selected.save(buffer)
    result = reopen(buffer.getvalue(), [1])
    if len(result) <= MAX_BYTES:
        _cache[key] = result
        while len(_cache) > 4 or sum(map(len, _cache.values())) > MAX_BYTES:
            _cache.popitem(last=False)
    return result, 1

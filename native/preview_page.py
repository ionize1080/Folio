"""Bounded page copies shared by successive preview requests in one worker."""
import base64, hashlib, io
from pathlib import Path
from collections import OrderedDict
import pikepdf
from form_compat import reopen
_cache=OrderedDict()

def preview_source(args):
    """Keep a tagged document intact until replacements validate its owners."""
    number=args.get('page',1)
    if 'input' in args:
        path=Path(args['input']);stat=path.stat();key=(str(path),stat.st_size,stat.st_mtime_ns,number)
    else:key=(hashlib.sha256(args['bytes'].encode()).hexdigest(),number)
    cached=_cache.pop(key,None)
    if cached is None:
        raw=path.read_bytes() if 'input' in args else base64.b64decode(args['bytes'])
        raw=reopen(raw,[number])
        with pikepdf.open(io.BytesIO(raw)) as original:
            if not isinstance(number,int) or not 1<=number<=len(original.pages):raise ValueError('页码无效')
            tagged='/StructTreeRoot' in original.Root or '/StructParents' in original.pages[number-1].obj
            if tagged:data=raw
            else:
                buf=io.BytesIO()
                with pikepdf.Pdf.new() as selected:
                    selected.add_pages_from(original,[number-1]);selected.save(buf)
                data=buf.getvalue()
        cached=(data,number if tagged else 1,tagged)
    if len(cached[0])<=32*1024**2:
        _cache[key]=cached
        while len(_cache)>2 or sum(len(v[0]) for v in _cache.values())>32*1024**2:_cache.popitem(last=False)
    return cached

def render_page(data,number):
    """Extract the display-only page after full-document validation is done."""
    buf=io.BytesIO()
    with pikepdf.open(io.BytesIO(data)) as original, pikepdf.Pdf.new() as selected:
        selected.add_pages_from(original,[number-1]);selected.save(buf)
    return buf.getvalue()

def selected_page(args):
    data,number,tagged=preview_source(args)
    return render_page(data,number) if tagged else data

def compact_preview(data):
    buf=io.BytesIO()
    with pikepdf.open(io.BytesIO(base64.b64decode(data))) as pdf:
        pdf.remove_unreferenced_resources();pdf.save(buf)
    return base64.b64encode(buf.getvalue()).decode()

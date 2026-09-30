"""Bounded page copies shared by successive preview requests in one worker."""
import base64, hashlib, io
from pathlib import Path
from collections import OrderedDict
import pikepdf
from form_compat import reopen
_cache=OrderedDict()

def selected_page(args):
    number=args.get('page',1)
    if 'input' in args:
        path=Path(args['input']);stat=path.stat();key=(str(path),stat.st_size,stat.st_mtime_ns,number)
    else:key=(hashlib.sha256(args['bytes'].encode()).hexdigest(),number)
    data=_cache.pop(key,None)
    if data is None:
        raw=path.read_bytes() if 'input' in args else base64.b64decode(args['bytes'])
        raw=reopen(raw,[number]);buf=io.BytesIO()
        with pikepdf.open(io.BytesIO(raw)) as original:
            if not isinstance(number,int) or not 1<=number<=len(original.pages):raise ValueError('页码无效')
            selected=pikepdf.Pdf.new();selected.add_pages_from(original,[number-1]);selected.save(buf)
        data=buf.getvalue()
    if len(data)<=32*1024**2:
        _cache[key]=data
        while len(_cache)>2 or sum(map(len,_cache.values()))>32*1024**2:_cache.popitem(last=False)
    return data

def compact_preview(data):
    buf=io.BytesIO()
    with pikepdf.open(io.BytesIO(base64.b64decode(data))) as pdf:
        pdf.remove_unreferenced_resources();pdf.save(buf)
    return base64.b64encode(buf.getvalue()).decode()

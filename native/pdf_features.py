"""Minimum versions for reachable graphics features; no blanket version bump."""
from pypdf.generic import NameObject

def graphics_version(pages):
    required=(1,0);seen=set();pending=[];remaining=100000
    def obj(value):return value.get_object() if hasattr(value,'get_object') else value
    def group(value):
        value=obj(value)
        return isinstance(value,dict) and value.get('/S')=='/Transparency'
    for page in pages:
        content=page.get_contents()
        if content and b'/ActualText' in content.get_data():required=max(required,(1,4))
        if group(page.get('/Group',{})):required=max(required,(1,4))
        pending.append(page.get('/Resources',{}))
    while pending:
        scope=obj(pending.pop())
        if not isinstance(scope,dict):continue
        ref=getattr(scope,'indirect_reference',None)
        ident=(ref.idnum,ref.generation) if ref else id(scope)
        if ident in seen:continue
        seen.add(ident);remaining-=1
        if remaining<0:raise ValueError('PDF 图形资源超过安全分析预算')
        for kind in ('/XObject','/ExtGState','/Properties'):
            values=obj(scope.get(kind,{}))
            if not isinstance(values,dict):continue
            for ref in values.values():
                value=obj(ref)
                if not isinstance(value,dict):continue
                if '/ActualText' in value or (hasattr(value,'get_data') and value.get('/Subtype')=='/Form' and b'/ActualText' in value.get_data()):required=max(required,(1,4))
                if group(value.get('/Group',{})) or any(k in value for k in ('/SMask','/BM','/ca','/CA')):required=max(required,(1,4))
                if '/OC' in value or value.get('/Type') in ('/OCG','/OCMD'):required=max(required,(1,5))
                if '/Resources' in value:pending.append(value['/Resources'])
    return required


def ensure_version(writer):
    required=graphics_version(writer.pages)
    def version(value):
        try:return tuple(int(n) for n in str(value).replace('%PDF-','').strip('/').split('.'))
        except ValueError:return (1,0)
    header=writer.pdf_header
    if isinstance(header,bytes):header=header.decode('ascii')
    effective=max(version(header),version(writer._root_object.get('/Version','/1.0')))
    if required>effective:
        writer._root_object[NameObject('/Version')]=NameObject('/%d.%d'%required)

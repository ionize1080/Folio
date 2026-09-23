"""Re-enter Folio content layers without flattening external forms or OCR.

Generated text remains ordinary PDF content on the next edit. Resource names
are scoped per invocation; clipping and graphics state survive expansion.
"""
import io
import math
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, NameObject, DictionaryObject, FloatObject

RESOURCE_OPERATORS = {b'Tf':('/Font',0),b'Do':('/XObject',0),b'gs':('/ExtGState',0),
    b'CS':('/ColorSpace',0),b'cs':('/ColorSpace',0),b'sh':('/Shading',0),
    b'SCN':('/Pattern',-1),b'scn':('/Pattern',-1),b'BDC':('/Properties',1),b'DP':('/Properties',1)}

def eligible(form):
    return (form.get('/Subtype')=='/Form' and form.get('/FolioLayerVersion')==2
        and form.get('/FolioLayerKind')=='/Content'
        and not any(k in form for k in ('/Group','/OC','/Ref','/StructParent')))

def expand_page(page):
    resources=page.get('/Resources',DictionaryObject()).get_object()
    xobjects=resources.get('/XObject',{}).get_object() if hasattr(resources.get('/XObject',{}),'get_object') else resources.get('/XObject',{})
    if not any(eligible(ref.get_object()) for ref in xobjects.values()):return False
    resources=DictionaryObject(dict(resources));page[NameObject('/Resources')]=resources
    stream=ContentStream(page.get('/Contents'),page.pdf);output=[];serial=0;text_depth=0
    for args,op in stream.operations:
        if op==b'BT':text_depth+=1
        elif op==b'ET':text_depth=max(0,text_depth-1)
        form=xobjects.get(args[0]).get_object() if op==b'Do' and args and args[0] in xobjects else None
        if not form or not eligible(form):output.append((args,op));continue
        matrix=list(form.get('/Matrix',[1,0,0,1,0,0]));box=list(form.get('/BBox',[]))
        if len(matrix)!=6 or len(box)!=4 or not all(math.isfinite(float(v)) for v in matrix+box):
            output.append((args,op));continue
        # Inlining a call inside an open text object would change text matrices.
        # Our writer emits calls outside BT/ET; foreign malformed layers stay opaque.
        if text_depth:output.append((args,op));continue
        content=ContentStream(form,page.pdf)
        if len(content.operations)>200000:output.append((args,op));continue
        depth=0;in_text=False;balanced=True
        for _,operator in content.operations:
            if operator==b'q':depth+=1
            elif operator==b'Q':
                depth-=1
                if depth<0:balanced=False;break
            elif operator==b'BT':
                if in_text:balanced=False;break
                in_text=True
            elif operator==b'ET':
                if not in_text:balanced=False;break
                in_text=False
        if not balanced or depth or in_text:output.append((args,op));continue
        serial+=1;renames={};local=form.get('/Resources',DictionaryObject()).get_object()
        for kind,values in local.items():
            values=values.get_object()
            if not isinstance(values,dict):continue
            dest=DictionaryObject(dict(resources.get(kind,{}).get_object() if hasattr(resources.get(kind,{}),'get_object') else resources.get(kind,{})))
            resources[kind]=dest
            for name,ref in values.items():
                stem='/FolioP5_%d_%s'%(serial,str(name).lstrip('/'));candidate=NameObject(stem);suffix=0
                while candidate in dest:
                    suffix+=1;candidate=NameObject(stem+'_'+str(suffix))
                dest[candidate]=ref;renames[(str(kind),str(name))]=candidate
        output.extend([([],b'q'),([FloatObject(v) for v in matrix],b'cm'),
            ([FloatObject(box[0]),FloatObject(box[1]),FloatObject(box[2]-box[0]),FloatObject(box[3]-box[1])],b're'),([],b'W'),([],b'n')])
        for values,operator in content.operations:
            values=list(values)
            if operator in RESOURCE_OPERATORS:
                kind,index=RESOURCE_OPERATORS[operator]
                if (len(values)>index if index>=0 else bool(values)):
                    value=values[index]
                    if isinstance(value,NameObject):values[index]=renames.get((kind,str(value)),value)
            output.append((values,operator))
        output.append(([],b'Q'))
    if not serial:return False
    from content import raw_strings
    stream.operations=[([raw_strings(v) for v in values],op) for values,op in output]
    page[NameObject('/Contents')]=page.pdf._add_object(stream)
    return True

def reopen(data,numbers):
    if b'/FolioLayerVersion' not in data:return data
    from pdf_writer import clone_document
    reader=PdfReader(io.BytesIO(data));writer=clone_document(reader);changed=False
    for n in sorted(set(numbers)):
        if 1<=n<=len(writer.pages):changed=expand_page(writer.pages[n-1]) or changed
    if not changed:return data
    output=io.BytesIO();writer.write(output);return output.getvalue()

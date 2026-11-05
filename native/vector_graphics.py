"""Store an editable SVG source alongside a vector PDF Form XObject."""
import io
import math
import re
from uuid import UUID
from xml.etree import ElementTree as ET

import fitz
from pypdf import PdfReader
from pypdf.generic import (ArrayObject, ContentStream, DecodedStreamObject, DictionaryObject,
                           FloatObject, NameObject as N, TextStringObject)

TAGS = set('svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath'.split())
ATTRS = set('id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry fx fy d points transform fill fill-rule stroke stroke-width stroke-linejoin stroke-linecap stroke-dasharray stroke-opacity fill-opacity opacity font-family font-size font-weight font-style text-anchor dx dy offset stop-color stop-opacity gradientUnits gradientTransform clip-path preserveAspectRatio'.split())

def validate_svg(source):
    if not isinstance(source,str) or len(source.encode()) > 160000 or '<!' in source or '<?' in source:
        raise ValueError('Use a plain, self-contained SVG under 160 KB')
    root = ET.fromstring(source)
    if root.tag.split('}')[-1] != 'svg':
        raise ValueError('Expected an SVG root')
    for i,el in enumerate(root.iter()):
        if i>=1500 or el.tag.split('}')[-1] not in TAGS:
            raise ValueError('Unsupported SVG element')
        for key,value in el.attrib.items():
            if key not in ATTRS or (re.search(r'url\s*\(',value,re.I) and not re.fullmatch(r'url\(#[\w.-]+\)',value)):
                raise ValueError('Unsupported or external SVG attribute: '+key)
    return source


def objects(page):
    xs=page.get('/Resources',{}).get('/XObject',{})
    return xs.get_object() if hasattr(xs,'get_object') else xs


def list_graphics(page):
    return [dict(id=str(form['/FolioVectorID']),svg=str(form['/FolioSVG']),box=list(map(float,form['/FolioVectorBox'])))
            for ref in objects(page).values() for form in [ref.get_object()]
            if form.get('/FolioLayerKind')=='/Vector' and '/FolioSVG' in form]


def place(writer,page,edits):
    resources=DictionaryObject(dict(page['/Resources']))
    xs=DictionaryObject(dict(objects(page)))
    resources[N('/XObject')]=xs
    page[N('/Resources')]=resources
    new_calls=[]
    for edit in edits:
        uid=str(UUID(edit['id']))
        name=N('/FolioVector'+uid.replace('-',''))
        if name in xs and xs[name].get('/FolioVectorID')!=uid:
            raise ValueError('Vector resource name already in use')
        source=validate_svg(edit['svg'])
        x,y,w,h=map(float,edit['box'])
        if not all(math.isfinite(v) and abs(v)<=100000 for v in (x,y,w,h)) or min(w,h)<=0:
            raise ValueError('Invalid vector placement [left,bottom,width,height] in PDF points')
        with fitz.open(stream=source.encode('utf-8'),filetype='svg') as svg:
            data=svg.convert_to_pdf()
        vector=PdfReader(io.BytesIO(data)).pages[0]
        vw,vh=float(vector.mediabox.width),float(vector.mediabox.height)
        if min(vw,vh)<=0:raise ValueError('SVG has no visible dimensions')
        scale=min(w/vw,h/vh)
        form=DecodedStreamObject()
        form.set_data(vector.get_contents().get_data())
        form.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Form'),
                     N('/BBox'):ArrayObject([FloatObject(v) for v in (0,0,vw,vh)]),
                     N('/Matrix'):ArrayObject([FloatObject(v) for v in (scale,0,0,scale,x+(w-vw*scale)/2,y+(h-vh*scale)/2)]),
                     N('/Resources'):vector['/Resources'].clone(writer),
                     N('/FolioLayerKind'):N('/Vector'),N('/FolioVectorID'):TextStringObject(uid),
                     N('/FolioSVG'):TextStringObject(source),N('/FolioVectorBox'):ArrayObject([FloatObject(v) for v in (x,y,w,h)])})
        if name not in xs:new_calls.append(([name],b'Do'))
        xs[name]=writer._add_object(form)
    if new_calls:
        start=ContentStream(None,writer);start.operations=[([],b'q')]
        end=ContentStream(None,writer);end.operations=[([],b'Q'),*new_calls]
        old=page.raw_get('/Contents') if '/Contents' in page else None
        refs=list(old.get_object()) if old and isinstance(old.get_object(),ArrayObject) else ([old] if old else [])
        page[N('/Contents')]=ArrayObject([writer._add_object(start),*refs,writer._add_object(end)])

"""Store an editable SVG source alongside a vector PDF Form XObject."""
import io
import math
import re
from uuid import UUID
from xml.etree import ElementTree as ET

import fitz
from pypdf import PdfReader
from pypdf.generic import (ArrayObject, ContentStream, DecodedStreamObject, DictionaryObject,
                           FloatObject, NameObject as N, TextStringObject, BooleanObject)

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
    return [dict(id=str(form['/FolioVectorID']),svg=str(form['/FolioSVG']),box=list(map(float,form['/FolioVectorBox'])),rotation=float(form.get('/FolioRotation',0)),opacity=float(form.get('/FolioOpacity',1)))
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
        if edit.get('delete'):
            stream=ContentStream(page.get('/Contents'),writer)
            stream.operations=[(a,o) for a,o in stream.operations if not(o==b'Do' and a and a[0]==name)]
            page[N('/Contents')]=writer._add_object(stream)
            xs.pop(name,None)
            continue
        source=validate_svg(edit['svg'])
        x,y,w,h=map(float,edit['box'])
        if not all(math.isfinite(v) and abs(v)<=100000 for v in (x,y,w,h)) or min(w,h)<=0:
            raise ValueError('Invalid vector placement [left,bottom,width,height] in PDF points')
        from svg_gradients import prepare,restore
        converted,markers=prepare(source)
        with fitz.open(stream=converted.encode('utf-8'),filetype='svg') as svg:
            data=svg.convert_to_pdf()
        # Work on a writer so alpha gradient masks can own indirect streams.
        from pypdf import PdfWriter
        temporary=PdfWriter();temporary.append(PdfReader(io.BytesIO(data)))
        vector=temporary.pages[0];restore(vector,markers,temporary)
        vw,vh=float(vector.mediabox.width),float(vector.mediabox.height)
        if min(vw,vh)<=0:raise ValueError('SVG has no visible dimensions')
        sx,sy=w/vw,h/vh
        rotation=float(edit.get('rotation',0));opacity=float(edit.get('opacity',1))
        if not math.isfinite(rotation) or not math.isfinite(opacity) or not 0<=opacity<=1:raise ValueError('Invalid rotation or opacity')
        angle=math.radians(rotation);c,s=math.cos(angle),math.sin(angle)
        matrix=[sx*c,sx*s,-sy*s,sy*c,x+w/2-(c*w-s*h)/2,y+h/2-(s*w+c*h)/2]
        # Apply whole-object opacity to an isolated transparency group. Applying
        # it inside the SVG stream lets child fill-opacity overwrite the value.
        inner=DecodedStreamObject();inner.set_data(vector.get_contents().get_data())
        inner.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Form'),
                      N('/BBox'):ArrayObject([FloatObject(v) for v in (0,0,vw,vh)]),
                      N('/Resources'):vector['/Resources'].clone(writer),
                      N('/Group'):DictionaryObject({N('/S'):N('/Transparency'),N('/CS'):N('/DeviceRGB'),N('/I'):BooleanObject(True)})})
        form=DecodedStreamObject()
        form.set_data(b'q /FolioOpacity gs /FolioArtwork Do Q')
        resources=DictionaryObject({
            N('/XObject'):DictionaryObject({N('/FolioArtwork'):writer._add_object(inner)}),
            N('/ExtGState'):DictionaryObject({N('/FolioOpacity'):DictionaryObject({N('/Type'):N('/ExtGState'),N('/ca'):FloatObject(opacity),N('/CA'):FloatObject(opacity)})})})
        form.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Form'),
                     N('/BBox'):ArrayObject([FloatObject(v) for v in (0,0,vw,vh)]),
                     N('/Matrix'):ArrayObject([FloatObject(v) for v in matrix]),
                     N('/Resources'):resources,N('/FolioRotation'):FloatObject(rotation),N('/FolioOpacity'):FloatObject(opacity),
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

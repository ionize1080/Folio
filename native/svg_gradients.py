"""Keep SVG gradient fills as native PDF shadings through MuPDF conversion.

MuPDF converts path geometry reliably but omits SVG paint servers. Unique solid
markers let us retain its exact paths, clips and transforms, then replace only
their fill paint with axial/radial shadings (and an alpha soft mask if needed).
"""
import math,re
from xml.etree import ElementTree as ET
from PIL import ImageColor
from pypdf.generic import (ArrayObject as A,DictionaryObject as D,FloatObject as F,
                           NameObject as N,NumberObject as I,BooleanObject as B,
                           DecodedStreamObject,ContentStream)
from object_style import mul
def arr(values):return A([F(v) for v in values])
def prepare(source):
    root=ET.fromstring(source);gradients={e.get('id'):e for e in root.iter() if e.tag.split('}')[-1] in ('linearGradient','radialGradient')}
    markers={};used={v.lower() for e in root.iter() for v in e.attrib.values()}
    for el in root.iter():
        match=re.fullmatch(r'url\(#([\w.-]+)\)',el.get('fill',''))
        if not match:continue
        gradient=gradients.get(match[1])
        if gradient is None:raise ValueError('Unknown SVG gradient')
        marker=0x010101+len(markers)
        while '#%06x'%marker in used:marker+=1
        color='#%06x'%marker;used.add(color);rgb=tuple(int(color[i:i+2],16)/255 for i in (1,3,5))
        markers[rgb]=gradient;el.set('fill',color)
    return ET.tostring(root,encoding='unicode'),markers
def transform(value):
    result=[1,0,0,1,0,0];tail=value or ''
    pattern=r'\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?'
    while tail.strip():
        match=re.match(pattern,tail)
        if not match:raise ValueError('Invalid gradientTransform')
        name=match[1];v=[float(x) for x in re.split(r'[\s,]+',match[2].strip()) if x];tail=tail[match.end():]
        if not all(math.isfinite(x) for x in v):raise ValueError('Invalid gradientTransform')
        if name=='matrix' and len(v)==6:m=v
        elif name=='translate' and len(v) in (1,2):m=[1,0,0,1,v[0],v[1] if len(v)==2 else 0]
        elif name=='scale' and len(v) in (1,2):m=[v[0],0,0,v[-1],0,0]
        elif name=='rotate' and len(v) in (1,3):
            c,s=math.cos(math.radians(v[0])),math.sin(math.radians(v[0]));m=[c,s,-s,c,0,0]
            if len(v)==3:m=mul(mul([1,0,0,1,v[1],v[2]],m),[1,0,0,1,-v[1],-v[2]])
        elif name in ('skewX','skewY') and len(v)==1:m=[1,0,math.tan(math.radians(v[0])),1,0,0] if name=='skewX' else [1,math.tan(math.radians(v[0])),0,1,0,0]
        else:raise ValueError('Invalid gradientTransform arity')
        result=mul(result,m)
    return result
def stops(gradient):
    values=[]
    for stop in gradient:
        if stop.tag.split('}')[-1]!='stop':continue
        raw=stop.get('offset','0');offset=float(raw.rstrip('%'))/(100 if raw.endswith('%') else 1)
        offset=max(values[-1][0] if values else 0,min(1,offset))
        color=ImageColor.getrgb(stop.get('stop-color','black'));alpha=float(stop.get('stop-opacity','1'))
        if not math.isfinite(offset) or not 0<=alpha<=1:raise ValueError('Invalid gradient stop')
        values.append((offset,[v/255 for v in color[:3]],alpha))
    if not values:raise ValueError('A gradient needs color stops')
    if values[0][0]>0:values.insert(0,(0,values[0][1],values[0][2]))
    if values[-1][0]<1:values.append((1,values[-1][1],values[-1][2]))
    if len(values)==1:values=[(0,values[0][1],values[0][2]),(1,values[0][1],values[0][2])]
    return values
def function(values,alpha=False):
    # Repeated offsets encode hard transitions. Each interval interpolates from
    # the last stop at its start to the first stop at its end, with strict bounds.
    groups=[]
    for value in values:
        if groups and groups[-1][0][0]==value[0]:groups[-1].append(value)
        else:groups.append([value])
    functions=[]
    for left,right in zip(groups,groups[1:]):
        a,b=left[-1],right[0]
        functions.append(D({N('/FunctionType'):I(2),N('/Domain'):arr([0,1]),N('/C0'):arr([a[2]] if alpha else a[1]),N('/C1'):arr([b[2]] if alpha else b[1]),N('/N'):I(1)}))
    return D({N('/FunctionType'):I(3),N('/Domain'):arr([0,1]),N('/Functions'):A(functions),N('/Bounds'):arr([g[0][0] for g in groups[1:-1]]),N('/Encode'):arr([0,1]*len(functions))})

def bounds(path):
    points=[];current=(0,0)
    for args,op in path:
        v=list(map(float,args))
        if op in (b'm',b'l'):current=tuple(v);points.append(current)
        elif op==b're':x,y,w,h=v;points.extend([(x,y),(x+w,y+h)]);current=(x,y)
        elif op in (b'c',b'v',b'y'):
            if op==b'v':v=[*current,*v]
            if op==b'y':v=[*v,*v[-2:]]
            p=[current,tuple(v[:2]),tuple(v[2:4]),tuple(v[4:])];points.extend([p[0],p[3]])
            for axis in (0,1):
                a=-p[0][axis]+3*p[1][axis]-3*p[2][axis]+p[3][axis];b=2*(p[0][axis]-2*p[1][axis]+p[2][axis]);c=p[1][axis]-p[0][axis]
                roots=[]
                if abs(a)<1e-12:
                    if abs(b)>1e-12:roots=[-c/b]
                elif b*b-4*a*c>=0:roots=[(-b+sign*math.sqrt(b*b-4*a*c))/(2*a) for sign in (-1,1)]
                for t in roots:
                    if 0<t<1:points.append(tuple((1-t)**3*p[0][j]+3*(1-t)**2*t*p[1][j]+3*(1-t)*t*t*p[2][j]+t**3*p[3][j] for j in (0,1)))
            current=p[-1]
    if not points:raise ValueError('Gradient fill has no path')
    x,y=min(p[0] for p in points),min(p[1] for p in points)
    return x,y,max(p[0] for p in points)-x,max(p[1] for p in points)-y
def restore(page,markers,writer):
    if not markers:return
    stream=page.get_contents();out=[];color=None;stack=[];path=[];serial=0
    resources=page['/Resources'];shadings=D(dict(resources.get('/Shading',{})));states=D(dict(resources.get('/ExtGState',{})))
    for args,op in stream.operations:
        if op==b'q':stack.append(color)
        elif op==b'Q':color=stack.pop() if stack else None
        elif op==b'rg':color=tuple(map(float,args))
        elif op in (b'g',b'k'):color=None
        if op in (b'm',b'l',b'c',b'v',b'y',b're',b'h'):path.append((args,op))
        paint=op in (b'f',b'f*',b'B',b'B*',b'b',b'b*')
        gradient=next((g for rgb,g in markers.items() if color and all(abs(a-b)<1e-6 for a,b in zip(rgb,color))),None)
        if paint and gradient is not None:
            x,y,w,h=bounds(path)
            if min(w,h)<=0:out.append(([],b'n'));path=[];continue
            box=gradient.get('gradientUnits','objectBoundingBox')=='objectBoundingBox'
            matrix=mul([w,0,0,h,x,y] if box else [1,0,0,1,0,0],transform(gradient.get('gradientTransform','')))
            def coord(name,default,axis=0):
                value=gradient.get(name,default);percent=value.endswith('%');n=float(value.rstrip('%'))/(100 if percent else 1)
                return n*(float(page.mediabox.width if axis==0 else page.mediabox.height) if percent and not box else 1)
            radial=gradient.tag.split('}')[-1]=='radialGradient'
            if radial:
                cx,cy,r=coord('cx','50%'),coord('cy','50%',1),coord('r','50%');coords=[coord('fx',gradient.get('cx','50%')),coord('fy',gradient.get('cy','50%'),1),0,cx,cy,r]
                if r<=0:raise ValueError('Gradient radius must be positive')
            else:coords=[coord('x1','0%'),coord('y1','0%',1),coord('x2','100%'),coord('y2','0%',1)]
            values=stops(gradient);serial+=1;name=N('/FolioGradient'+str(serial))
            def shading(alpha=False):return D({N('/ShadingType'):I(3 if radial else 2),N('/ColorSpace'):N('/DeviceGray' if alpha else '/DeviceRGB'),N('/Coords'):arr(coords),N('/Function'):function(values,alpha),N('/Extend'):A([B(True),B(True)])})
            shadings[name]=shading();extra=[]
            if any(v[2]!=1 for v in values):
                mask=DecodedStreamObject();mask.set_data(b'/Alpha sh')
                mask.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Form'),N('/BBox'):arr([-100000,-100000,100000,100000]),N('/Resources'):D({N('/Shading'):D({N('/Alpha'):shading(True)})}),N('/Group'):D({N('/S'):N('/Transparency'),N('/CS'):N('/DeviceGray')})})
                gs=N('/FolioGradientAlpha'+str(serial));states[gs]=D({N('/SMask'):D({N('/S'):N('/Luminosity'),N('/G'):writer._add_object(mask)})});extra=[([gs],b'gs')]
            out.extend([([],b'q'),([],b'W*' if op in (b'f*',b'B*',b'b*') else b'W'),([],b'n'),(arr(matrix),b'cm'),*extra,([name],b'sh'),([],b'Q')])
            if op in (b'B',b'B*',b'b',b'b*'):out.extend(path+[( [],b's' if op in (b'b',b'b*') else b'S')])
        else:out.append((args,op))
        if paint or op in (b'n',b'S',b's'):path=[]
    resources[N('/Shading')]=shadings;resources[N('/ExtGState')]=states
    stream.operations=out;page[N('/Contents')]=stream

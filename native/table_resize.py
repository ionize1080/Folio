"""Piecewise translation of simple ruled-table objects, preserving source operators.
No image repainting, white overlays or changes to objects outside the table.
"""
import math
from pypdf.generic import FloatObject
from content import TEXT

def changes(edits):
    rows={}
    for e in edits:
        g=(e.get('model') or {}).get('tableGrowth')
        if not g:continue
        b=g.get('bounds',[]);delta=g.get('delta',0);y=g.get('y')
        if len(b)!=4 or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in [*b,delta,y]) or not 0<=delta<=14400:raise ValueError('表格行高参数无效')
        key=(g['tableId'],y)
        if delta>rows.get(key,{}).get('delta',0):rows[key]=g
    return list(rows.values())

def transform(stream,mapped,descriptions,height,growths):
    if not growths:return
    ctm=[1,0,0,1,0,0];stack=[];pending=[];before={};after={};paint={m['at']:d for m,d in zip(mapped,descriptions)}
    def point(x,y,m):a,b,c,d,e,f=m;return a*x+c*y+e,b*x+d*y+f
    def inv(x,y,m):
        a,b,c,d,e,f=m;det=a*d-b*c
        if abs(det)<1e-10:raise ValueError('表格含不可逆坐标变换')
        return (d*(x-e)-c*(y-f))/det,(-b*(x-e)+a*(y-f))/det
    def dy(x,y):
        top=height-y
        return sum(g['delta'] for g in growths if g['bounds'][0]-2<=x<=g['bounds'][2]+2 and g['y']-.5<=top<=g['bounds'][3]+2)
    def apply_path(items):
        for index,args,op,m in items:
            args=list(map(float,args))
            def move(x,y):
                X,Y=point(x,y,m);return inv(X,Y-dy(X,Y),m)
            if op==b're':
                x,y,w,h=args;pts=[move(x,y),move(x+w,y),move(x+w,y+h),move(x,y+h)]
                # Rectangles remain rectangles under the supported axis-aligned transforms.
                if abs(pts[0][1]-pts[1][1])>.01 or abs(pts[1][0]-pts[2][0])>.01:raise ValueError('倾斜表格暂不支持自动行高')
                args=[pts[0][0],pts[0][1],pts[1][0]-pts[0][0],pts[2][1]-pts[1][1]]
            else:args=[v for j in range(0,len(args),2) for v in move(args[j],args[j+1])]
            stream.operations[index]=([FloatObject(v) for v in args],op)
    for i,(args,op) in enumerate(stream.operations):
        if op==b'q':stack.append(ctm[:])
        elif op==b'Q':ctm=stack.pop() if stack else [1,0,0,1,0,0]
        elif op==b'cm':
            a,b,c,d,e,f=map(float,args);A,B,C,D,E,F=ctm;ctm=[A*a+C*b,B*a+D*b,A*c+C*d,B*c+D*d,A*e+C*f+E,B*e+D*f+F]
        elif op in (b'm',b'l',b'c',b'v',b'y',b're'):pending.append((i,args,op,ctm[:]))
        if i in paint:
            obj=paint[i];bounds=obj['bounds'];x=(bounds[0]+bounds[2])/2;top=height-bounds[3];bottom=height-bounds[1]
            contained=any(bounds[0]>=g['bounds'][0]-2 and bounds[2]<=g['bounds'][2]+2 and top>=g['bounds'][1]-2 and bottom<=g['bounds'][3]+2 for g in growths)
            if contained and obj['type']=='path':apply_path(pending)
            elif contained and obj['type']=='text':
                delta=dy(x,(bounds[1]+bounds[3])/2)
                if delta:
                    # Conjugate a page-space translation through the active CTM.
                    a,b,c,d,e,f=ctm;det=a*d-b*c
                    if abs(det)<1e-10:raise ValueError('表格文字变换不可逆')
                    tx=c*delta/det;ty=-a*delta/det
                    before[i]=[([],b'q'),([FloatObject(v) for v in [1,0,0,1,tx,ty]],b'cm')];after[i]=[([],b'Q')]
            if obj['type']=='path':pending=[]
        elif op==b'n':pending=[]
    return before,after

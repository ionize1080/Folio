"""Transform/recolor selected original text paints without replacing fonts or glyph codes."""
import math
from pypdf.generic import FloatObject

def mul(m,n):
    a,b,c,d,e,f=m;A,B,C,D,E,F=n
    return [a*A+c*B,b*A+d*B,a*C+c*D,b*C+d*D,a*E+c*F+e,b*E+d*F+f]
def inverse(m):
    a,b,c,d,e,f=m;det=a*d-b*c
    if abs(det)<1e-12:raise ValueError('对象变换不可逆')
    return [d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det]
def wrappers(stream,position,description,edit):
    style=edit['objectStyle'];scale=style.get('scale',1)
    matrix=edit.get('matrix',description['matrix'])
    if not isinstance(scale,(int,float)) or not math.isfinite(scale) or not .001<=scale<=1000:raise ValueError('字号缩放无效')
    if len(matrix)!=6 or any(not isinstance(v,(int,float)) or not math.isfinite(v) or abs(v)>1e7 for v in matrix):raise ValueError('对象变换无效')
    desired=mul(matrix,[scale,0,0,scale,0,0]);delta=mul(desired,inverse(description['matrix']))
    ctm=[1,0,0,1,0,0];stack=[]
    for args,op in stream.operations[:position]:
        if op==b'q':stack.append(ctm[:])
        elif op==b'Q':ctm=stack.pop() if stack else [1,0,0,1,0,0]
        elif op==b'cm':ctm=mul(ctm,list(map(float,args)))
    local=mul(mul(inverse(ctm),delta),ctm)
    before=[([],b'q'),([FloatObject(v) for v in local],b'cm')]
    if 'fill' in style:
        rgb=style['fill']
        if len(rgb)!=3 or any(not isinstance(v,int) or not 0<=v<=255 for v in rgb):raise ValueError('文字颜色无效')
        before.append(([FloatObject(v/255) for v in rgb],b'rg'))
        before.append(([FloatObject(v/255) for v in rgb],b'RG'))
    return before,[([],b'Q')]

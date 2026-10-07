"""Track effective stream clips even when PDFium drops an original no-op clip.

A clip that contains the original glyphs can still truncate replacement ink.
Rectangles are certified; curves/compound paths retain an unknown marker.
"""
def clip_states(operations):
    matrix=(1,0,0,1,0,0);clips=();stack=[];path=[];pending=False;result={}
    def point(x,y):
        a,b,c,d,e,f=matrix
        return (a*float(x)+c*float(y)+e,b*float(x)+d*float(y)+f)
    for i,(args,op) in enumerate(operations):
        if op==b'q':stack.append((matrix,clips))
        elif op==b'Q':matrix,clips=stack.pop() if stack else ((1,0,0,1,0,0),())
        elif op==b'cm':
            a,b,c,d,e,f=map(float,args);A,B,C,D,E,F=matrix
            matrix=(A*a+C*b,B*a+D*b,A*c+C*d,B*c+D*d,A*e+C*f+E,B*e+D*f+F)
        elif op==b're':
            x,y,w,h=map(float,args);path.append([point(x,y),point(x+w,y),point(x+w,y+h),point(x,y+h)])
        elif op in (b'm',b'l',b'c',b'v',b'y',b'h'):path.append(None)
        elif op in (b'W',b'W*'):pending=True
        if op in (b'n',b'S',b's',b'f',b'F',b'f*',b'B',b'B*',b'b',b'b*'):
            if pending:
                rect=None
                if len(path)==1 and path[0]:
                    pts=path[0];xs=sorted(set(x for x,y in pts));ys=sorted(set(y for x,y in pts))
                    if len(xs)==2 and len(ys)==2:rect=(xs[0],ys[0],xs[1],ys[1])
                clips=clips+(rect,)
            pending=False;path=[]
        result[i]=clips
    return result

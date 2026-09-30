"""Perspective crop via an inverse projective mapping; isolated RGBA pixels."""
import math
import numpy as np
from PIL import Image

def rectify(image, points):
    if not isinstance(points,list) or len(points)!=4 or any(not isinstance(p,list) or len(p)!=2 for p in points):
        raise ValueError('透视裁剪需要四个角点')
    if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=1 for p in points for v in p):
        raise ValueError('透视角点超出图片')
    p=np.array(points,dtype=float)
    cross=[np.linalg.det(np.stack([p[(i+1)%4]-p[i],p[(i+2)%4]-p[(i+1)%4]])) for i in range(4)]
    if min(cross)<=.0001:raise ValueError('透视四边形不能交叉或过窄')
    p*=np.array(image.size)
    w=max(2,round((np.linalg.norm(p[1]-p[0])+np.linalg.norm(p[2]-p[3]))/2))
    h=max(2,round((np.linalg.norm(p[3]-p[0])+np.linalg.norm(p[2]-p[1]))/2))
    if w*h>100_000_000 or max(w,h)>32768:raise ValueError('透视输出超过预算')
    destination=[(0,0),(w,0),(w,h),(0,h)];a=[];b=[]
    for (x,y),(u,v) in zip(destination,p):
        a.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);b.extend([u,v])
    try:coeff=np.linalg.solve(np.array(a),np.array(b))
    except np.linalg.LinAlgError:raise ValueError('透视变换不可逆')
    return image.transform((w,h),Image.Transform.PERSPECTIVE,coeff,Image.Resampling.BICUBIC)

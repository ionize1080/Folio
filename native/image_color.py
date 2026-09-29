"""Deterministic RGB adjustments, bounded floating-point tiles; not Adobe math."""
import math
import numpy as np
from PIL import Image, ImageFilter

def number(v,lo,hi,name):
    if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or not lo<=v<=hi:raise ValueError('图像参数无效：'+name)
    return float(v)
def vec(v,n,lo,hi,name):
    if not isinstance(v,list) or len(v)!=n:raise ValueError('图像参数无效：'+name)
    return [number(x,lo,hi,name) for x in v]
def curve(v):
    if not isinstance(v,list) or not 2<=len(v)<=16:raise ValueError('曲线需要 2–16 个控制点')
    v=[vec(x,2,0,255,'curve') for x in v]
    if v[0][0]!=0 or v[-1][0]!=255 or any(a[0]>=b[0] for a,b in zip(v,v[1:])):raise ValueError('曲线输入必须从 0 到 255 严格递增')
    return v
def validate(o):
    if not isinstance(o,dict):raise ValueError('图像参数无效')
    ranges={'brightness':(-100,100,0),'contrast':(-100,100,0),'black':(0,254,0),'white':(1,255,255),'gamma':(.1,10,1),'outputBlack':(0,255,0),'outputWhite':(0,255,255),'blur':(0,30,0),'sharpen':(0,300,0),'exposure':(-10,10,0),'offset':(-.5,.5,0),'exposureGamma':(.1,10,1),'hue':(-180,180,0),'saturation':(-100,100,0),'lightness':(-100,100,0),'vibrance':(-100,100,0),'temperature':(-100,100,0),'tint':(-100,100,0),'clarity':(-100,100,0),'dehaze':(-100,100,0),'grain':(0,100,0),'photoDensity':(0,100,0),'threshold':(0,255,128),'posterize':(2,256,256),'lutAmount':(0,100,100)}
    extra={'preset','curves','channelCurves','interpolation','levels','balance','blackWhite','bwMix','photoColor','photoLuminosity','mixer','monochrome','lookup','cube','selective','selectiveAbsolute','invert','thresholdEnabled','gradient','gradientEnabled'}
    if set(o)-set(ranges)-extra:raise ValueError('未知图像参数')
    p={k:number(o.get(k,d),lo,hi,k) for k,(lo,hi,d) in ranges.items()}
    if p['black']>=p['white'] or p['outputBlack']>p['outputWhite']:raise ValueError('色阶黑场必须小于白场')
    p['preset']=o.get('preset','none')
    if p['preset'] not in ('none','scan-color','scan-gray'):raise ValueError('未知增强预设')
    p['curves']=curve(o.get('curves',[[0,0],[255,255]]));p['interpolation']=o.get('interpolation','linear')
    if p['interpolation'] not in ('linear','smooth'):raise ValueError('曲线插值无效')
    for key in ['channelCurves','levels','balance','selective']:
        if not isinstance(o.get(key,{}),dict):raise ValueError(key+' 参数无效')
    cc=o.get('channelCurves',{})
    if set(cc)-{'r','g','b'}:raise ValueError('曲线通道无效')
    p['channelCurves']={k:curve(v) for k,v in cc.items()};p['levels']={}
    for k,v in o.get('levels',{}).items():
        if k not in ('r','g','b') or not isinstance(v,list) or len(v)!=5:raise ValueError('色阶通道无效')
        v=[number(v[0],0,254,k),number(v[1],.1,10,k),number(v[2],1,255,k),number(v[3],0,255,k),number(v[4],0,255,k)]
        if v[0]>=v[2] or v[3]>v[4]:raise ValueError('通道色阶范围无效')
        p['levels'][k]=v
    p['balance']={}
    for k,v in o.get('balance',{}).items():
        if k not in ('shadows','midtones','highlights'):raise ValueError('色彩平衡范围无效')
        p['balance'][k]=vec(v,3,-100,100,k)
    for k in ['blackWhite','monochrome','selectiveAbsolute','invert','thresholdEnabled','gradientEnabled','photoLuminosity']:
        p[k]=o.get(k,k=='photoLuminosity')
        if not isinstance(p[k],bool):raise ValueError(k+' 必须为布尔值')
    p['bwMix']=vec(o.get('bwMix',[40,60,40,60,20,80]),6,-200,300,'bwMix');p['photoColor']=vec(o.get('photoColor',[255,160,70]),3,0,255,'photoColor')
    matrix=o.get('mixer',[[100,0,0,0],[0,100,0,0],[0,0,100,0]])
    if not isinstance(matrix,list) or len(matrix)!=3:raise ValueError('通道混合矩阵无效')
    p['mixer']=[vec(v,4,-200,200,'mixer') for v in matrix];p['lookup']=o.get('lookup','none')
    if p['lookup'] not in ('none','warm','cool','cinema','cube'):raise ValueError('颜色查找无效')
    p['cube']=o.get('cube')
    if p['cube'] is not None:
        c=p['cube']
        if not isinstance(c,dict) or set(c)!={'size','data'}:raise ValueError('LUT 格式无效')
        n=c['size']
        if isinstance(n,bool) or not isinstance(n,int) or not 2<=n<=33:raise ValueError('3D LUT 边长限 2–33')
        p['cube']={'size':n,'data':vec(c['data'],n**3*3,0,1,'cube')}
    if p['lookup']=='cube' and p['cube'] is None:raise ValueError('请先导入 .cube LUT')
    p['selective']={}
    for k,v in o.get('selective',{}).items():
        if k not in ('reds','yellows','greens','cyans','blues','magentas','whites','neutrals','blacks'):raise ValueError('可选颜色范围无效')
        p['selective'][k]=vec(v,4,-100,100,k)
    stops=o.get('gradient',[[0,0,0,0],[255,255,255,255]])
    if not isinstance(stops,list) or not 2<=len(stops)<=16:raise ValueError('渐变需要 2–16 个色标')
    p['gradient']=[vec(v,4,0,255,'gradient') for v in stops]
    if p['gradient'][0][0]!=0 or p['gradient'][-1][0]!=255 or any(a[0]>=b[0] for a,b in zip(p['gradient'],p['gradient'][1:])):raise ValueError('渐变位置须递增且包含 0 和 255')
    return p

def curve_lut(points,smooth=False):
    x=np.array([p[0] for p in points]);y=np.array([p[1] for p in points]);xx=np.arange(256)
    if not smooth:return np.interp(xx,x,y)
    h=np.diff(x);d=np.diff(y)/h;m=np.zeros(len(x));m[0]=d[0];m[-1]=d[-1]
    for i in range(1,len(x)-1):
        if d[i-1]*d[i]>0:
            w1=2*h[i]+h[i-1];w2=h[i]+2*h[i-1];m[i]=(w1+w2)/(w1/d[i-1]+w2/d[i])
    j=np.clip(np.searchsorted(x,xx,side='right')-1,0,len(x)-2);t=(xx-x[j])/h[j]
    return np.clip((2*t**3-3*t*t+1)*y[j]+(t**3-2*t*t+t)*h[j]*m[j]+(-2*t**3+3*t*t)*y[j+1]+(t**3-t*t)*h[j]*m[j+1],0,255)
def lum(a):return a@np.array([.2126,.7152,.0722],np.float32)
def hue_weights(a):
    mx=a.max(2);mn=a.min(2);d=mx-mn;safe=np.maximum(d,1e-7);h=np.zeros_like(mx);r,g,b=np.moveaxis(a,-1,0)
    h=np.where(mx==r,((g-b)/safe)%6,h);h=np.where((mx==g)&(mx!=r),(b-r)/safe+2,h);h=np.where((mx==b)&(mx!=r)&(mx!=g),(r-g)/safe+4,h)
    return [np.maximum(0,1-np.minimum(abs(h-i),6-abs(h-i))) for i in range(6)],d,mn

def color_tile(a,p,y_start):
    if p['exposure'] or p['offset'] or p['exposureGamma']!=1:
        linear=np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4);linear=np.clip(linear*2**p['exposure']+p['offset'],0,1)**(1/p['exposureGamma']);a=np.where(linear<=.0031308,linear*12.92,1.055*linear**(1/2.4)-.055)
    a=np.clip(a+np.array([p['temperature']*.001,-p['tint']*.001,-p['temperature']*.001]),0,1)
    if p['hue']:
        mx=a.max(2);mn=a.min(2);d=mx-mn;safe=np.maximum(d,1e-7);r,g,b=np.moveaxis(a,-1,0)
        h=np.where(mx==r,((g-b)/safe)%6,np.where(mx==g,(b-r)/safe+2,(r-g)/safe+4));h=(h+p['hue']/60)%6
        xx=d*(1-np.abs(h%2-1));zero=np.zeros_like(d);sector=np.floor(h).astype(int)
        triples=[(d,xx,zero),(xx,d,zero),(zero,d,xx),(zero,xx,d),(xx,zero,d),(d,zero,xx)]
        a=np.stack([np.choose(sector,[t[c] for t in triples])+mn for c in range(3)],2)
    if p['saturation'] or p['vibrance']:
        l=lum(a)[...,None];sat=a.max(2)-a.min(2);factor=1+p['saturation']/100+p['vibrance']/100*(1-sat);a=np.clip(l+(a-l)*factor[...,None],0,1)
    if p['lightness']:
        t=p['lightness']/100;a=a+(1-a)*t if t>0 else a*(1+t)
    if p['balance']:
        l=lum(a);weights={'shadows':(1-l)**2,'highlights':l*l,'midtones':2*l*(1-l)}
        for k,v in p['balance'].items():a=a+weights[k][...,None]*np.array(v)/255
        a=np.clip(a,0,1)
    if p['blackWhite']:
        weights,d,mn=hue_weights(a);a=np.repeat(np.clip(mn+d*sum(w*v/100 for w,v in zip(weights,p['bwMix'])),0,1)[...,None],3,axis=2)
    if p['photoDensity']:
        before=lum(a);color=np.array(p['photoColor'])/255;t=p['photoDensity']/100;a=a*((1-t)+t*color)
        if p['photoLuminosity']:a=np.clip(a*before[...,None]/np.maximum(lum(a)[...,None],1e-6),0,1)
    matrix=np.array(p['mixer'])/100
    if not np.array_equal(matrix,np.column_stack((np.eye(3),np.zeros(3)))):a=np.clip(a@matrix[:,:3].T+matrix[:,3],0,1)
    if p['monochrome']:a=np.repeat(a[:,:,:1],3,axis=2)
    if p['selective']:
        weights,d,mn=hue_weights(a);mx=a.max(2);maps=dict(zip(['reds','yellows','greens','cyans','blues','magentas'],[w*d for w in weights]));l=lum(a);maps.update(whites=np.clip((mn-.5)*2,0,1),blacks=np.clip((.5-mx)*2,0,1),neutrals=1-abs(2*l-1));original=a.copy()
        for k,v in p['selective'].items():a=a+maps[k][...,None]*(-(np.array(v[:3])+v[3])/100)*(1 if p['selectiveAbsolute'] else original)
        a=np.clip(a,0,1)
    if p['lookup']!='none':
        old=a
        if p['lookup']=='warm':a=np.clip(a*np.array([1.08,1,.9])+np.array([.015,0,0]),0,1)
        elif p['lookup']=='cool':a=np.clip(a*np.array([.9,1,1.08])+np.array([0,0,.015]),0,1)
        elif p['lookup']=='cinema':a=np.clip((a-.5)*1.12+.5+np.array([-.025,.015,.035])*(1-lum(a))[...,None],0,1)
        else:
            n=p['cube']['size'];lut=np.array(p['cube']['data'],np.float32).reshape(n,n,n,3);pos=np.clip(a,0,1)*(n-1);lo=np.floor(pos).astype(int);hi=np.minimum(lo+1,n-1);f=pos-lo;a=np.zeros_like(old)
            for r in (0,1):
                for g in (0,1):
                    for b in (0,1):
                        ix=np.where([r,g,b],hi,lo);w=np.prod(np.where([r,g,b],f,1-f),axis=2);a+=lut[ix[:,:,2],ix[:,:,1],ix[:,:,0]]*w[...,None]
        a=old+(a-old)*p['lutAmount']/100
    if p['invert']:a=1-a
    if p['posterize']<256:a=np.round(a*(round(p['posterize'])-1))/(round(p['posterize'])-1)
    if p['thresholdEnabled']:a=np.repeat((lum(a)*255>=p['threshold'])[...,None],3,axis=2).astype(np.float32)
    if p['gradientEnabled']:
        l=lum(a)*255;st=p['gradient'];a=np.stack([np.interp(l,[s[0] for s in st],[s[c]/255 for s in st]) for c in (1,2,3)],axis=2)
    if p['grain']:
        yy,xx=np.indices(a.shape[:2],dtype=np.uint32);seed=xx*374761393+(yy+y_start)*668265263;seed=(seed^(seed>>13))*1274126177;noise=((seed^(seed>>16))%65536)/65535-.5;a=np.clip(a+noise[...,None]*p['grain']/255,0,1)
    return np.uint8(np.clip(np.rint(a*255),0,255))
def tonal(rgb,p):
    tables=[];master=curve_lut(p['curves'],p['interpolation']=='smooth')
    for k in ('r','g','b'):
        v=np.arange(256,dtype=float);v=np.clip((v-p['black'])/(p['white']-p['black']),0,1)**(1/p['gamma']);v=p['outputBlack']+v*(p['outputWhite']-p['outputBlack']);v=np.interp(v,np.arange(256),master)
        if k in p['levels']:
            black,gamma,white,low,high=p['levels'][k];v=low+np.clip((v-black)/(white-black),0,1)**(1/gamma)*(high-low)
        if k in p['channelCurves']:v=np.interp(v,np.arange(256),curve_lut(p['channelCurves'][k],p['interpolation']=='smooth'))
        tables.extend(np.clip(np.rint(v),0,255).astype(int).tolist())
    return rgb.point(tables)
def colors(rgb,p):
    defaults=validate({});keys=['exposure','offset','exposureGamma','hue','saturation','lightness','vibrance','temperature','tint','balance','blackWhite','photoDensity','mixer','monochrome','selective','lookup','invert','posterize','thresholdEnabled','gradientEnabled','grain']
    if all(p[k]==defaults[k] for k in keys):return rgb
    result=Image.new('RGB',rgb.size);rows=max(1,min(256,262144//rgb.width))
    for y in range(0,rgb.height,rows):
        box=(0,y,rgb.width,min(y+rows,rgb.height));a=np.asarray(rgb.crop(box),dtype=np.float32)/255;result.paste(Image.fromarray(color_tile(a,p,y)),box)
    return result


def dehaze(rgb, amount):
    """Dark-channel atmospheric veil estimate; negative values add haze."""
    sample=rgb.copy();sample.thumbnail((512,512));arr=np.asarray(sample,dtype=np.float32)/255
    dark=np.min(arr,axis=2);count=max(1,dark.size//1000);indices=np.argpartition(dark.ravel(),-count)[-count:]
    candidates=arr.reshape(-1,3)[indices];air=candidates[np.argmax(candidates.mean(1))];air=np.maximum(air,.1)
    if amount>0:
        minimum=Image.fromarray(np.uint8(np.clip(np.min(arr/air,axis=2),0,1)*255)).filter(ImageFilter.MinFilter(7))
        transmission=Image.fromarray(np.uint8(np.clip(1-(amount/100)*.9*np.asarray(minimum)/255,.15,1)*255)).resize(rgb.size,Image.Resampling.BILINEAR)
    result=Image.new('RGB',rgb.size);rows=max(1,min(256,262144//rgb.width))
    for y in range(0,rgb.height,rows):
        box=(0,y,rgb.width,min(y+rows,rgb.height));a=np.asarray(rgb.crop(box),dtype=np.float32)/255
        if amount>0:
            t=np.asarray(transmission.crop(box),dtype=np.float32)[...,None]/255;a=(a-air)/np.maximum(t,.15)+air
        else:a=a*(1+amount/150)+air*(-amount/150)
        result.paste(Image.fromarray(np.uint8(np.clip(np.rint(a*255),0,255))),box)
    return result


def neutral(options):
    p=validate(options);d=validate({})
    p['interpolation']=d['interpolation']
    p['channelCurves']={k:v for k,v in p['channelCurves'].items() if v!=[[0,0],[255,255]]}
    p['levels']={k:v for k,v in p['levels'].items() if v!=[0,1,255,0,255]}
    p['balance']={k:v for k,v in p['balance'].items() if any(v)}
    p['selective']={k:v for k,v in p['selective'].items() if any(v)}
    if not p['blackWhite']:p['bwMix']=d['bwMix']
    if not p['photoDensity']:p['photoColor']=d['photoColor'];p['photoLuminosity']=d['photoLuminosity']
    if p['lookup']=='none':p['cube']=None;p['lutAmount']=d['lutAmount']
    if not p['thresholdEnabled']:p['threshold']=d['threshold']
    if not p['gradientEnabled']:p['gradient']=d['gradient']
    return p==d

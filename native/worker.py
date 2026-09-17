"""Local JSON-lines service: native PDFium objects, offline OCR, Windows atomic replace."""
import sys,os,json,base64,io,ctypes as C,math,hashlib,traceback,time
from pathlib import Path
from functools import lru_cache
@lru_cache(maxsize=4)
def font_bytes(name):return (ROOT/"fonts"/name).read_bytes()
ROOT=Path(__file__).resolve().parent
# Windows embeddable Python uses python312._pth and excludes the script directory.
# Resolve only trusted modules shipped beside this service, independent of CWD.
if str(ROOT) not in sys.path:sys.path.insert(0,str(ROOT))
def sample_memory():
 try:
  from memory import resident_bytes
  return resident_bytes()
 except Exception as exc:
  print('Memory statistics unavailable: '+str(exc),file=sys.stderr,flush=True)
  return 0
ENGINES={};SUPPORTED=None;CACHED_PDF=None;CACHED_PATH=None
FALLBACK=None;ALL_SUPPORTED=None
IGNORABLE="\u200b\ufeff"
def clean_text(text):return str(text).translate({ord(c):None for c in IGNORABLE})
def supported():
 global SUPPORTED,FALLBACK,ALL_SUPPORTED
 if SUPPORTED is None:SUPPORTED=set(json.loads((ROOT/"fonts/codepoints.json").read_text()))
 if FALLBACK is None:FALLBACK=set(json.loads((ROOT/"fonts/fallback-codepoints.json").read_text()))
 if ALL_SUPPORTED is None:ALL_SUPPORTED=SUPPORTED|FALLBACK
 return ALL_SUPPORTED
def preflight(blocks):
 allowed=supported();issues=[];count=0;normalized=0
 for i,b in enumerate(blocks):
  if b.get("excluded"):continue
  t=str(b.get("text",""));normalized+=sum(c in IGNORABLE for c in t);missing=sorted({c for c in t if ord(c) not in allowed and c not in "\n\r\t"+IGNORABLE})
  if missing:
   count+=1
   if len(issues)<200:issues.append({"id":b.get("id",str(i)),"page":b.get("page",1),"text":t[:100],"characters":[{"text":c,"code":f"U+{ord(c):04X}"} for c in missing]})
 return {"count":count,"issues":issues,"normalized":normalized}
def read_blocks(args):
 if args.get("ocrFile"):
  with open(args["ocrFile"],encoding="utf-8") as f:
   for line in f:
    if line.strip():yield json.loads(line)
 else:yield from sorted(args.get("ocr",[]),key=lambda x:x["page"])

def number(v,lo=-100000,hi=100000):
 v=float(v)
 if not math.isfinite(v) or not lo<=v<=hi:raise ValueError('参数超出有效范围')
 return v

def replace(source,target):
 if os.name!='nt':os.replace(source,target);return True
 dll=C.WinDLL('kernel32',use_last_error=True)
 if os.path.exists(target):
  fn=dll.ReplaceFileW;fn.argtypes=[C.c_wchar_p,C.c_wchar_p,C.c_wchar_p,C.c_uint32,C.c_void_p,C.c_void_p];ok=fn(target,source,None,0,None,None)
 else:
  fn=dll.MoveFileExW;fn.argtypes=[C.c_wchar_p,C.c_wchar_p,C.c_uint32];ok=fn(source,target,8)
 if not ok:
  n=C.get_last_error();raise OSError(n,{5:'目标只读或没有写入权限',32:'目标文件被其他程序占用',33:'目标文件被锁定'}.get(n,'Windows 文件替换失败')+f' (Windows {n})')
 return True

def get_color(r,obj,stroke=False):
 vals=[C.c_uint() for _ in range(4)];(r.FPDFPageObj_GetStrokeColor if stroke else r.FPDFPageObj_GetFillColor)(obj,*map(C.byref,vals));return [v.value for v in vals]
def contains_ink_clip(r,clip,bounds):
 """Only closed, axis-aligned rectangles which contain the complete ink.
 Keep curves, holes, partial glyph clipping and unknown paths read-only.
 PDFium clip segments and object bounds are both in page coordinates.
 """
 if not clip or r.FPDFClipPath_CountPaths(clip)<=0:return True
 for i in range(r.FPDFClipPath_CountPaths(clip)):
  n=r.FPDFClipPath_CountPathSegments(clip,i)
  if n not in (4,5):return False
  pts=[]
  for j in range(n):
   s=r.FPDFClipPath_GetPathSegment(clip,i,j)
   if r.FPDFPathSegment_GetType(s)!=(r.FPDF_SEGMENT_MOVETO if j==0 else r.FPDF_SEGMENT_LINETO):return False
   x,y=C.c_float(),C.c_float()
   if not r.FPDFPathSegment_GetPoint(s,C.byref(x),C.byref(y)):return False
   pts.append((x.value,y.value))
  if not r.FPDFPathSegment_GetClose(s):return False
  if n==5:
   if math.dist(pts[0],pts[-1])>.001:return False
   pts.pop()
  xs=sorted(set(p[0] for p in pts));ys=sorted(set(p[1] for p in pts))
  if len(xs)!=2 or len(ys)!=2 or set(pts)!={(x,y) for x in xs for y in ys}:return False
  if any(a[0]!=b[0] and a[1]!=b[1] for a,b in zip(pts,pts[1:]+pts[:1])):return False
  if not (xs[0]<=bounds[0]+.001 and ys[0]<=bounds[1]+.001 and xs[1]>=bounds[2]-.001 and ys[1]>=bounds[3]-.001):return False
 return True
def describe(r,obj,i,tp):
 typ=r.FPDFPageObj_GetType(obj);m=r.FS_MATRIX();r.FPDFPageObj_GetMatrix(obj,C.byref(m));b=[C.c_float() for _ in range(4)];r.FPDFPageObj_GetBounds(obj,*map(C.byref,b))
 out={'index':i,'type':{1:'text',2:'path',3:'image',4:'shading',5:'form'}.get(typ,'other'),'bounds':[v.value for v in b],'matrix':[m.a,m.b,m.c,m.d,m.e,m.f],'fill':get_color(r,obj),'stroke':get_color(r,obj,True)}
 if typ==1:
  n=r.FPDFTextObj_GetText(obj,tp,None,0);buf=(C.c_ushort*((n+1)//2))();r.FPDFTextObj_GetText(obj,tp,buf,n);size=C.c_float();r.FPDFTextObj_GetFontSize(obj,C.byref(size));out.update(text=bytes(buf)[:n].decode('utf-16-le',errors='replace').rstrip('\0'),size=size.value,renderMode=r.FPDFTextObj_GetTextRenderMode(obj))
 if typ==2:
  segs=[]
  for j in range(r.FPDFPath_CountSegments(obj)):
   seg=r.FPDFPath_GetPathSegment(obj,j);x,y=C.c_float(),C.c_float();r.FPDFPathSegment_GetPoint(seg,C.byref(x),C.byref(y));segs.append({'type':r.FPDFPathSegment_GetType(seg),'x':x.value,'y':y.value,'close':bool(r.FPDFPathSegment_GetClose(seg))})
  width=C.c_float();r.FPDFPageObj_GetStrokeWidth(obj,C.byref(width));fill,stroke=C.c_int(),C.c_int();r.FPDFPath_GetDrawMode(obj,C.byref(fill),C.byref(stroke));n=max(0,r.FPDFPageObj_GetDashCount(obj));dash=(C.c_float*n)();r.FPDFPageObj_GetDashArray(obj,dash,n);phase=C.c_float();r.FPDFPageObj_GetDashPhase(obj,C.byref(phase));out.update(segments=segs,width=width.value,fillMode=fill.value,stroked=bool(stroke.value),cap=r.FPDFPageObj_GetLineCap(obj),join=r.FPDFPageObj_GetLineJoin(obj),dash=list(dash),dashPhase=phase.value)
 clip=r.FPDFPageObj_GetClipPath(obj);out['editable']=typ in (1,2,3) and (typ!=1 or out['renderMode']==0) and (not clip or r.FPDFClipPath_CountPaths(clip)<=0)
 out['simpleText']=typ==1 and out['renderMode'] in (0,2) and contains_ink_clip(r,clip,out['bounds'])
 if not out['editable']:out['reason']='复杂裁剪、嵌套或特殊绘制模式暂为只读'
 out['signature']=hashlib.sha256(json.dumps({k:out[k] for k in ['type','matrix','bounds']+(['text'] if typ==1 else [])},sort_keys=True).encode()).hexdigest()[:20];return out

def setmatrix(r,obj,m):
 if len(m)!=6:raise ValueError('变换矩阵须含六个数字')
 v=r.FS_MATRIX(*[number(x) for x in m])
 if not r.FPDFPageObj_SetMatrix(obj,C.byref(v)):raise ValueError('对象变换失败')
def settext(r,obj,text):
 global SUPPORTED
 if SUPPORTED is None:SUPPORTED=set(json.loads((ROOT/'fonts/codepoints.json').read_text()))
 text=clean_text(text)
 missing={c for c in text if ord(c) not in supported() and c not in '\n\r\t'}
 if missing:raise ValueError('内置字体暂不支持：'+''.join(sorted(missing))[:30])
 if len(text)>20000:raise ValueError('单个文字对象过长')
 data=text.encode('utf-16-le')+b'\0\0';buf=(C.c_ushort*(len(data)//2)).from_buffer_copy(data)
 if not r.FPDFText_SetText(obj,buf):raise ValueError('无法写入文字')

def render_fragment(pdf,r,edits,blocks):
 pages={};objects={};font=None;buffers=[];seen=set();font_cache={}
 pdf._folio_fonts=font_cache
 def page_for(p,inspect=True):
  if not isinstance(p,int) or not 1<=p<=len(pdf):raise ValueError('页码无效')
  if p not in pages:
   page=pdf[p-1];pages[p]=page
   if inspect:
    tp=page.get_textpage();objects[p]=[(r.FPDFPage_GetObject(page,i),describe(r,r.FPDFPage_GetObject(page,i),i,tp)) for i in range(r.FPDFPage_CountObjects(page))];tp.close()
  return pages[p]
 def font_for(fallback=False):
  key='DejaVuSans.ttf' if fallback else 'NotoSansSC.ttf'
  if key not in font_cache:
   data=font_bytes(key);buf=(C.c_ubyte*len(data)).from_buffer_copy(data);buffers.append(buf);f=r.FPDFText_LoadFont(pdf,buf,len(data),r.FPDF_FONT_TRUETYPE,True)
   if not f:raise ValueError('加载内置字体失败')
   font_cache[key]=f
  return font_cache[key]
 def text_objects(text,size):
  supported();runs=[]
  for c in clean_text(text).replace('\n',' ').replace('\r',' ').replace('\t',' '):
   fallback=ord(c) not in SUPPORTED
   if runs and runs[-1][0]==fallback:runs[-1][1]+=c
   else:runs.append([fallback,c])
  out=[];x=0
  for fallback,t in runs:
   f=font_for(fallback);obj=r.FPDFPageObj_CreateTextObj(pdf,f,size);settext(r,obj,t)
   b=[C.c_float() for _ in range(4)];r.FPDFPageObj_GetBounds(obj,*map(C.byref,b))
   # Advances use glyph metrics where available, bounds as conservative fallback.
   advance=0
   for c in t:
    width=C.c_float()
    if r.FPDFFont_GetGlyphWidth(f,ord(c),size,C.byref(width)):advance+=width.value
    else:advance+=size
   out.append((obj,x));x+=max(advance,.1)
  return out,max(x,.1)
 for e in edits:
  p=e['page'];page=page_for(p);idx=e.get('index');old=None;d={}
  if idx is not None:
   if not isinstance(idx,int) or idx<0 or idx>=len(objects[p]) or (p,idx) in seen:raise ValueError('对象编号无效或重复')
   seen.add((p,idx));old,d=objects[p][idx]
   if e.get('signature')!=d['signature']:raise ValueError('对象已变化，无法安全应用修改')
   if not d['editable']:raise ValueError(d['reason'])
  if e.get('delete'):
   if old:r.FPDFPage_RemoveObject(page,old);r.FPDFPageObj_Destroy(old)
   continue
  typ=e.get('type',d.get('type'));obj=old
  if typ=='text':
   size=number(e.get('size',d.get('size',12)),1,1000);matrix=e.get('matrix',d.get('matrix',[1,0,0,1,72,720]));text=str(e.get('text',d.get('text','')))
   width=float(e.get('boxWidth',0) or 0);lines=[]
   if width>0:
    line='';advance=0
    for c in clean_text(text):
     f=font_for(ord(c) not in supported() or ord(c) not in SUPPORTED);cw=C.c_float();r.FPDFFont_GetGlyphWidth(f,ord(c),size,C.byref(cw));w=cw.value or size
     if c=='\n' or (line and advance+w>width):lines.append(line);line='';advance=0
     if c!='\n':line+=c;advance+=w
    if line:lines.append(line)
   else:lines=text.splitlines() or ['']
   if len(lines)*size*float(e.get('lineHeight',1.4))>float(e.get('boxHeight',100000)):raise ValueError('文字超出文本框高度，请扩大范围或减少内容')
   for row,line in enumerate(lines):
    runs,_=text_objects(line,size)
    for item,x in runs:
     a,b,c,d0,tx,ty=matrix;y=-row*size*float(e.get('lineHeight',1.4));setmatrix(r,item,[a,b,c,d0,tx+a*x+c*y,ty+b*x+d0*y]);color=e.get('fill',[0,0,0,255]);r.FPDFPageObj_SetFillColor(item,*color);r.FPDFPage_InsertObject(page,item)
   continue
  elif typ=='path' and (old is None or e.get('segments',d.get('segments'))!=d.get('segments')):
   segs=e.get('segments',[])
   if not segs or len(segs)>10000 or segs[0]['type']!=2:raise ValueError('路径须以移动节点(2)开始')
   obj=r.FPDFPageObj_CreateNewPath(number(segs[0]['x']),number(segs[0]['y']));i=1
   while i<len(segs):
    q=segs[i];t=q['type']
    if t==0:r.FPDFPath_LineTo(obj,number(q['x']),number(q['y']))
    elif t==2:r.FPDFPath_MoveTo(obj,number(q['x']),number(q['y']))
    elif t==1:
     group=segs[i:i+3]
     if len(group)!=3 or any(q['type']!=1 for q in group):raise ValueError('贝塞尔曲线须含三个连续控制点')
     r.FPDFPath_BezierTo(obj,*[number(q[k]) for q in group for k in ('x','y')]);q=group[-1];i+=2
    else:raise ValueError('路径节点类型无效')
    if q.get('close'):r.FPDFPath_Close(obj)
    i+=1
   setmatrix(r,obj,e.get('matrix',d.get('matrix',[1,0,0,1,0,0])));r.FPDFPageObj_SetLineCap(obj,d.get('cap',0));r.FPDFPageObj_SetLineJoin(obj,d.get('join',0));dash=d.get('dash',[]);r.FPDFPageObj_SetDashArray(obj,(C.c_float*len(dash))(*dash),len(dash),d.get('dashPhase',0))
  if not obj:raise ValueError('不支持的对象')
  if 'matrix' in e:setmatrix(r,obj,e['matrix'])
  for key,fn in [('fill',r.FPDFPageObj_SetFillColor),('stroke',r.FPDFPageObj_SetStrokeColor)]:
   vals=e.get(key,d.get(key,[0,0,0,255]))
   if len(vals)!=4 or any(not isinstance(x,int) or not 0<=x<=255 for x in vals):raise ValueError('RGBA 颜色无效')
   fn(obj,*vals)
  if typ=='path':r.FPDFPageObj_SetStrokeWidth(obj,number(e.get('width',d.get('width',1)),0,1000));r.FPDFPath_SetDrawMode(obj,int(e.get('fillMode',d.get('fillMode',0))),bool(e.get('stroked',d.get('stroked',True))))
  if obj!=old:
   if old:
    place=next(i for i in range(r.FPDFPage_CountObjects(page)) if C.cast(r.FPDFPage_GetObject(page,i),C.c_void_p).value==C.cast(old,C.c_void_p).value);r.FPDFPage_RemoveObject(page,old);r.FPDFPageObj_Destroy(old);tail=[]
    while r.FPDFPage_CountObjects(page)>place:
     q=r.FPDFPage_GetObject(page,place);r.FPDFPage_RemoveObject(page,q);tail.append(q)
    r.FPDFPage_InsertObject(page,obj)
    for q in tail:r.FPDFPage_InsertObject(page,q)
   else:r.FPDFPage_InsertObject(page,obj)
 last_ocr_page=None
 for b in sorted(blocks,key=lambda b:b['page']):
  if last_ocr_page is not None and b['page']!=last_ocr_page and last_ocr_page in pages:
   prev=pages.pop(last_ocr_page)
   if not r.FPDFPage_GenerateContent(prev):raise ValueError('页面内容生成失败')
   prev.close();objects.pop(last_ocr_page,None)
  last_ocr_page=b['page']
  if b.get('excluded') or not b.get('text'):continue
  page=page_for(b['page'],inspect=False);quad=b['quad']
  if len(quad)!=4:raise ValueError('OCR 四角坐标无效')
  a,b2,c,d=[[number(x),number(y)] for x,y in quad];runs,total=text_objects(b['text'],10)
  if not runs:continue
  bounds=[]
  for obj,x in runs:
   bb=[C.c_float() for _ in range(4)];r.FPDFPageObj_GetBounds(obj,*map(C.byref,bb));bounds.append([bb[0].value+x,bb[1].value,bb[2].value+x,bb[3].value])
  # Fit the typographic box, not the ink of this particular word. Punctuation
  # and short Latin strings can have very little ink; using it as the vertical
  # denominator creates enormous selectable em boxes in PDF viewers.
  ascents=[];descents=[]
  for obj,x in runs:
   font=r.FPDFTextObj_GetFont(obj);asc,desc=C.c_float(),C.c_float()
   if not r.FPDFFont_GetAscent(font,10,C.byref(asc)) or not r.FPDFFont_GetDescent(font,10,C.byref(desc)):raise ValueError('OCR 字体度量不可用')
   ascents.append(asc.value);descents.append(desc.value)
  l=0;bot=min(descents);top=max(ascents);w=max(.1,total);h=max(.1,top-bot);xx,xy=(c[0]-d[0])/w,(c[1]-d[1])/w;yx,yy=(a[0]-d[0])/h,(a[1]-d[1])/h
  for obj,x in runs:
   setmatrix(r,obj,[xx,xy,yx,yy,d[0]+xx*(x-l)-yx*bot,d[1]+xy*(x-l)-yy*bot]);r.FPDFTextObj_SetTextRenderMode(obj,3);r.FPDFPage_InsertObject(page,obj)

 for page in pages.values():
  if not r.FPDFPage_GenerateContent(page):raise ValueError('页面内容生成失败')
 for page in pages.values():page.close()
 out=io.BytesIO();pdf.save(out);return out.getvalue()

def recognize(pdf,r,args):
 import numpy as np
 import onnxruntime as ort
 ort.disable_telemetry_events()
 started=time.perf_counter();page=pdf[args['page']-1];tp=page.get_textpage();text=tp.get_text_range().strip();tp.close()
 if args.get('skipText',True) and not args.get('region'):
  # A page number or header alone is not evidence of a complete searchable page.
  complete=len(text)>4 if args.get('skipMode')=='any' else False
  if args.get('skipMode')!='any' and len(text)>80:
   tp=page.get_textpage();w,h=page.get_size();middle=tp.get_text_bounded(0,h*.15,w,h*.85).strip();tp.close();complete=len(middle)>50
  if complete:
   page.close();return {'blocks':[],'skipped':True,'skipReason':'existing-text-coverage'}
 profile='v5' if args.get('profile')=='v5' else 'v6'
 threads=max(1,min(os.cpu_count() or 1,int(args.get('threads',4))));batch=max(1,min(32,int(args.get('batch',6))));key=(profile,threads,batch)
 if key not in ENGINES:
  ENGINES.clear()
  from rapidocr import RapidOCR,OCRVersion,ModelType
  names=['ch_PP-OCRv5_det_mobile','ch_PP-OCRv5_rec_mobile'] if profile=='v5' else ['multi_PP-OCRv6_det_small','multi_PP-OCRv6_rec_small'];params={'Global.log_level':'error','Global.max_side_len':3200,'Global.text_score':.3,'Rec.rec_batch_num':batch,'EngineConfig.onnxruntime.intra_op_num_threads':threads,'EngineConfig.onnxruntime.inter_op_num_threads':1}
  for task,name in zip(['Det','Rec','Cls'],names+['ch_ppocr_mobile_v2.0_cls_mobile']):
   file=ROOT/'models'/f'{name}.onnx'
   if not file.exists():raise ValueError('离线模型缺失：'+file.name)
   params[task+'.model_path']=str(file)
   if task!='Cls':params[task+'.ocr_version']=OCRVersion.PPOCRV5 if profile=='v5' else OCRVersion.PPOCRV6;params[task+'.model_type']=ModelType.MOBILE if profile=='v5' else ModelType.SMALL
  ENGINES[key]=RapidOCR(params=params)
 loaded=time.perf_counter()
 bmp=page.render(scale=number(args.get('dpi',180),72,300)/72);img=bmp.to_pil().convert('RGB');w,h=img.size;rx=ry=0;region=args.get('region')
 if region:
  x,y,rw,rh=[number(v,0,1) for v in region];rx=int(x*w);ry=int(y*h);img=img.crop((rx,ry,min(w,int((x+rw)*w)),min(h,int((y+rh)*h))))
 rendered=time.perf_counter();result=ENGINES[key](np.asarray(img));recognized=time.perf_counter();blocks=[]
 def native(pt):
  x,y=C.c_double(),C.c_double();r.FPDF_DeviceToPage(page,0,0,w,h,0,round(float(pt[0])+rx),round(float(pt[1])+ry),C.byref(x),C.byref(y));return [x.value,y.value]
 if result.txts:
  for q,t,s in zip(result.boxes,result.txts,result.scores):blocks.append({'page':args['page'],'text':str(t),'confidence':float(s),'quad':[native(v) for v in q]})
 # Spatial duplicate suppression preserves legitimate repeated words at distinct locations.
 unique=[];buckets={}
 for b in blocks:
  k=''.join(b['text'].split());seen=buckets.setdefault(k,[])
  if any(max(abs(b['quad'][j][v]-x['quad'][j][v]) for j in range(4) for v in (0,1))<2 for x in seen):continue
  seen.append(b);unique.append(b)
 img.close();bmp.close();page.close()
 return {'rss':sample_memory(),'blocks':unique,'skipped':False,'seconds':result.elapse,'profile':profile,'timing':{'load':loaded-started,'render':rendered-loaded,'recognize':recognized-rendered,'total':time.perf_counter()-started},'engine':'RapidOCR / ONNX Runtime CPU','threads':threads,'batch':batch}

def run(args):
 global CACHED_PDF,CACHED_PATH
 if args.get('command') in ('qpdf-status','qpdf-decrypt'):
  from qpdf_tools import process
  return process(args)
 if args.get('command')=='replace':return replace(args['source'],args['target'])
 if args.get('command')=='preflight':return preflight(read_blocks(args))
 if args.get('command')=='font-recommend':
  from font_similarity import recommend
  return {'fonts':recommend(args.get('fontKey'),str(args.get('missing',''))[:100000],str(args.get('sample',''))[:500])}
 if args.get('command')=='font-catalog':
  from system_fonts import list_fonts
  return list_fonts()
 if args.get('command')=='font-data':
  from font_match import load_font
  font=load_font(args.get('fontKey'))
  if not font:raise ValueError('字体不可用')
  label=str(args.get('previewText',''))[:160]
  if label:
   from font_preview import preview_font
   return {'base64':preview_font(font['path'],label)}
  sample=''.join(c for c in '文字示例中文测试 Aa 123' if ord(c) in font['coverage'])
  if len(sample.strip())<4:sample=''.join(chr(c) for c in sorted(font['coverage']) if c>=0x4e00 and c<=0x9fff)[:8] or sample
  return {'base64':base64.b64encode(Path(font['path']).read_bytes()).decode(),'sample':sample or 'Aa'}
 if args.get('command')=='font-select':
  from system_fonts import select_font
  return select_font(args.get('fontId'))
 if args.get('command')=='table-export':
  from table_export import export
  return export(args['table'],args['format'])
 if args.get('command')=='table-render':
  from table_render import render
  return render(args['table'])
 if args.get('command')=='flow-layout':
  from story import layout
  return layout(args['model'])
 if args.get('command')=='layout':
  from story import analyze
  return analyze(Path(args['input']).read_bytes(),args.get('page',1))
 if args.get('command')=='flow-background':
  # PDF.js renders the exact same PDF color spaces / Decode arrays as the reader.
  data=run({**args,'command':'apply'})['bytes']
  from pypdf import PdfReader,PdfWriter
  reader=PdfReader(io.BytesIO(base64.b64decode(data)));writer=PdfWriter()
  writer.add_page(reader.pages[args.get('page',1)-1]);buf=io.BytesIO();writer.write(buf)
  return {'pdf':base64.b64encode(buf.getvalue()).decode()}
 import pypdfium2 as p
 if args.get('command')=='ocr' and 'input' in args:
  if CACHED_PATH!=args['input']:
   if CACHED_PDF:CACHED_PDF.close()
   CACHED_PDF=p.PdfDocument(args['input']);CACHED_PATH=args['input']
  page=args.get('page',1)
  if not isinstance(page,int) or not 1<=page<=len(CACHED_PDF):raise ValueError('页码无效')
  return recognize(CACHED_PDF,p.raw,args)
 data=Path(args['input']).read_bytes() if 'input' in args else base64.b64decode(args['bytes'])
 with p.PdfDocument(data) as pdf:
  cmd=args['command'];page=args.get('page',1)
  if not isinstance(page,int) or not 1<=page<=len(pdf):raise ValueError('页码无效')
  if cmd=='inspect':
   page_no=page;page=pdf[page-1];tp=page.get_textpage();out={'objects':[describe(p.raw,p.raw.FPDFPage_GetObject(page,i),i,tp) for i in range(p.raw.FPDFPage_CountObjects(page))],'size':page.get_size()};
   from original_layout import inspect as inspect_origins
   inspect_origins(p.raw,page,tp,out['objects'],out['size'][1]);tp.close();page.close()
   from content import check_editable
   from pypdf import PdfReader
   pg=PdfReader(io.BytesIO(data)).pages[page_no-1]
   mapped=check_editable(pg,out['objects'])
   from content import map_objects
   from font_match import inspect_fonts
   out['fonts']=inspect_fonts(data,page_no,out['objects'],mapped,map_objects(pg)[0])
   from table_geometry import inspect_tables
   out['tables']=inspect_tables(data,page_no)
   return out
  if cmd=='apply':
   from content import compose
   report=preflight(read_blocks(args));editreport=preflight([e for e in args.get('edits',[]) if e.get('type')=='text' and not e.get('delete')])
   if report['count'] or editreport['count']:
    bad=(report['issues']+editreport['issues'])[0];raise ValueError(f"第 {bad['page']} 页有字体未覆盖字符："+' '.join(c['code'] for c in bad['characters'])+'；请在 OCR 问题列表校对或排除此条')
   def inspect(number):
    page=pdf[number-1];tp=page.get_textpage();des=[describe(p.raw,p.raw.FPDFPage_GetObject(page,i),i,tp) for i in range(p.raw.FPDFPage_CountObjects(page))];tp.close();page.close();return des
   def fragment(width,height,edits,bs):
    d=p.PdfDocument.new();pg=d.new_page(width,height);pg.close()
    try:return render_fragment(d,p.raw,[{**e,'page':1} for e in edits],bs)
    finally:
     for font in getattr(d,"_folio_fonts",{}).values():p.raw.FPDFFont_Close(font)
     d.close()
   def progress(number):
    if args.get('progress'):print(json.dumps({'progress':{'page':number,'stage':'write'}}),file=sys.__stdout__,flush=True)
   data=compose(data,args.get('edits',[]),read_blocks(args),inspect,fragment,progress)
   if 'output' in args:Path(args['output']).write_bytes(data);return {'bytes':len(data)}
   return {'bytes':base64.b64encode(data).decode()}
  if cmd=='ocr':return recognize(pdf,p.raw,args)
  raise ValueError('未知命令')
if __name__=='__main__':
 from contextlib import redirect_stdout
 for line in sys.stdin:
  try:
   with redirect_stdout(sys.stderr):result=run(json.loads(line))
   print(json.dumps({'result':result},ensure_ascii=True),flush=True)
  except Exception as e:traceback.print_exc(file=sys.stderr);print(json.dumps({'error':str(e)},ensure_ascii=True),flush=True)

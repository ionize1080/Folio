"""File-level utilities. All transformations return a new file, never overwrite input."""
import base64,io,json,zipfile

def process(args):
 import pikepdf
 action=args.get('action');options=args.get('options') or {}
 if action in ('inspect','metadata','linearize','compress','encrypt'):
  with pikepdf.open(args['input'],password=options.get('password','')) as pdf:
   info={'pages':len(pdf.pages),'metadata':{str(k).lstrip('/'):str(v) for k,v in pdf.docinfo.items()},'encrypted':pdf.is_encrypted,'linearized':pdf.is_linearized}
   if action=='inspect':return info
   if action=='metadata':
    fields=options.get('fields',{})
    if not isinstance(fields,dict) or len(fields)>200:raise ValueError('元数据字段无效')
    for key,value in fields.items():
     key='/'+str(key).lstrip('/')
     if key=='/' or len(key)>256 or (value is not None and (not isinstance(value,str) or len(value)>65536)):raise ValueError('元数据字段无效')
     if value is None:
      if key in pdf.docinfo:del pdf.docinfo[key]
     else:pdf.docinfo[key]=value
    # Keep mapped XMP fields synchronized without overwriting custom creator/producer.
    mapping={'Title':'dc:title','Author':'dc:creator','Subject':'dc:description','Keywords':'pdf:Keywords','Creator':'xmp:CreatorTool','Producer':'pdf:Producer','CreationDate':'xmp:CreateDate','ModDate':'xmp:ModifyDate'}
    with pdf.open_metadata(set_pikepdf_as_editor=False,update_docinfo=False) as xmp:
     for key,tag in mapping.items():
      if key not in fields:continue
      value=fields[key]
      if value is None:
       if tag in xmp:del xmp[tag]
      elif key in ('CreationDate','ModDate'):
       import re,datetime
       m=re.fullmatch(r"D:(\d{14})(Z|[+-]\d{2}'?\d{2}'?)?",value)
       if not m:raise ValueError('日期请使用 D:YYYYMMDDHHmmSSZ 或带时区的 PDF 日期')
       dt=datetime.datetime.strptime(m[1],'%Y%m%d%H%M%S');zone=m[2] or ''
       xmp[tag]=dt.isoformat()+('Z' if zone=='Z' else zone.replace("'",'')[:3]+':'+zone.replace("'",'')[3:] if zone else '')
      else:xmp[tag]=[value] if key=='Author' else value
   save={'linearize':action=='linearize','encryption':True if pdf.is_encrypted else False}
   if action=='compress':
    level=options.get('level',6)
    if type(level)!=int or not 1<=level<=9:raise ValueError('压缩级别必须为 1–9')
    # qpdf compression remains lossless, retaining searchable text and forms.
    pikepdf.settings.set_flate_compression_level(level)
    save.update(compress_streams=True,recompress_flate=True,object_stream_mode=pikepdf.ObjectStreamMode.generate)
   if action=='encrypt':
    owner=options.get('ownerPassword','');user=options.get('userPassword','')
    if not isinstance(owner,str) or not owner or not isinstance(user,str):raise ValueError('请设置所有者密码')
    save['encryption']=pikepdf.Encryption(owner=owner,user=user,R=6)
   buf=io.BytesIO()
   try:pdf.save(buf,**save)
   finally:
    if action=='compress':pikepdf.settings.set_flate_compression_level(6)
   data=buf.getvalue()
   with pikepdf.open(io.BytesIO(data),password=options.get('ownerPassword',options.get('password',''))) as check:
    if len(check.pages)!=info['pages']:raise ValueError('页数校验失败')
    if action=='linearize' and not check.is_linearized:raise ValueError('线性化校验失败')
   return {**info,'bytes':base64.b64encode(data).decode(),'extension':'pdf','size':len(data)}
 if action in ('forms','fill','create-form','export-images','export-text'):
  import fitz
  with fitz.open(args['input']) as doc:
   if doc.needs_pass and not doc.authenticate(options.get('password','')):raise ValueError('需要正确的文档密码')
   if action=='forms':return {'fields':[{'page':i+1,'name':w.field_name,'type':w.field_type_string,'value':w.field_value,'rect':list(w.rect)} for i,p in enumerate(doc) for w in p.widgets() or []]}
   if action=='fill':
    fields=options.get('fields',{});found=set()
    for page in doc:
     for w in page.widgets() or []:
      if w.field_name in fields:w.field_value=fields[w.field_name];w.update();found.add(w.field_name)
    if set(fields)-found:raise ValueError('表单字段不存在: '+', '.join(set(fields)-found))
   if action=='create-form':
    fields=options.get('fields',[])
    if not isinstance(fields,list) or not 1<=len(fields)<=200:raise ValueError('一次创建 1–200 个字段')
    names={w.field_name for p in doc for w in p.widgets() or []}
    for field in fields:
     name=field['name'];number=field['page'];rect=fitz.Rect(field['rect'])
     if not name or name in names or type(number)!=int or not 1<=number<=len(doc):raise ValueError('字段名称或页码无效')
     page=doc[number-1]
     if rect.is_empty or rect.is_infinite or not page.rect.contains(rect):raise ValueError('字段矩形超出页面')
     names.add(name);w=fitz.Widget();w.field_name=name;w.field_type={'text':fitz.PDF_WIDGET_TYPE_TEXT,'checkbox':fitz.PDF_WIDGET_TYPE_CHECKBOX}.get(field.get('type','text'))
     if w.field_type is None:raise ValueError('支持文本框和复选框')
     w.rect=rect;w.field_value=field.get('value','');w.field_label=field.get('label',name);w.field_flags=0;page.add_widget(w)
   if action=='export-images':
    dpi=options.get('dpi',150);pages=options.get('pages',list(range(1,len(doc)+1)))
    if type(dpi)!=int or not 72<=dpi<=600 or not 1<=len(pages)<=100:raise ValueError('图像导出限 1–100 页、72–600 DPI')
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
     for number in pages:
      if type(number)!=int or not 1<=number<=len(doc):raise ValueError('导出页码无效')
      page=doc[number-1]
      if page.rect.width*page.rect.height*(dpi/72)**2>40_000_000:raise ValueError('单页像素超出限制，请降低 DPI')
      z.writestr(f'page-{number:04}.png',page.get_pixmap(dpi=dpi).tobytes('png'))
      if buf.tell()>256*1024*1024:raise ValueError('导出超过 256 MB，请缩小范围')
    return {'bytes':base64.b64encode(buf.getvalue()).decode(),'extension':'zip'}
   if action=='export-text':
    text='\n\n'.join(p.get_text(sort=True) for p in doc)
    return {'bytes':base64.b64encode(text.encode('utf-8')).decode(),'extension':'txt','note':'扫描页需先 OCR；这是文字提取，不包含版式重建。'}
   return {'bytes':base64.b64encode(doc.tobytes(garbage=3,deflate=True)).decode(),'extension':'pdf'}
 raise ValueError('未知文档工具')

"""Reorder pages with original resources, annotations and remapped outlines."""
import base64,io,math,tempfile
from pathlib import Path
from pypdf import PdfReader,PdfWriter,Transformation
from pypdf.generic import RectangleObject,ArrayObject,NameObject,NumberObject,Fit

def process(args):
    options=args.get('options') or {};order=options.get('order')
    current=PdfReader(args['input']);readers={'current':current}
    for item in options.get('sources',[]):
        data=base64.b64decode(item['data'],validate=True);extension=Path(item.get('name','file.pdf')).suffix.lower().lstrip('.')
        if extension!='pdf':
            from conversion_engines import office
            with tempfile.TemporaryDirectory(prefix='folio-organize-') as directory:
                file=Path(directory)/('input.'+extension);file.write_bytes(data)
                data=base64.b64decode(office({'input':str(file),'options':{'extension':extension}})['bytes'])
        readers[item['id']]=PdfReader(io.BytesIO(data))
    if not isinstance(order,list) or not 1<=len(order)<=100000:raise ValueError('至少保留一页；每份文档最多 100000 页')
    writer=PdfWriter();i=0
    def dimension(v):
        v=float(v)
        if not math.isfinite(v) or not 1<=v<=14400:raise ValueError('页面尺寸必须为 1–14400 pt')
        return v
    while i<len(order):
        entry=order[i]
        if entry.get('blank'):
            writer.add_blank_page(dimension(entry.get('width',595.276)),dimension(entry.get('height',841.89)));i+=1;continue
        source=entry.get('source','current');reader=readers.get(source)
        if reader is None:raise ValueError('页面来源不存在')
        group=[]
        while i<len(order) and not order[i].get('blank') and order[i].get('source','current')==source:
            entry=order[i];number=entry.get('page')
            if type(number)!=int or not 1<=number<=len(reader.pages):raise ValueError('页面编号无效')
            group.append(entry);i+=1
        start=len(writer.pages);writer.append(reader,pages=[e['page']-1 for e in group],import_outline=source!='current')
    # append() remaps links only within each imported group. A target can be in
    # another group after insertion/reordering, so rebuild internal links using
    # the final page map before any scale/crop changes their annotation rectangles.
    page_map={}
    ref_maps={source:{(p.indirect_reference.idnum,p.indirect_reference.generation):n for n,p in enumerate(reader.pages) if p.indirect_reference} for source,reader in readers.items()}
    for index,item in enumerate(order):
        if not item.get('blank'):page_map.setdefault((item.get('source','current'),item['page']-1),index)
        if item.get('replaces'):
            old=item['replaces'];page_map[(old.get('source','current'),old['page']-1)]=index
    # Import current outlines once against the final map. This preserves the
    # targets of replaced pages and avoids duplicating outlines per page group.
    def outlines(items,parent=None):
        previous=parent
        for item in items:
            if isinstance(item,list):outlines(item,previous);continue
            number=current.get_destination_page_number(item)
            target=page_map.get(('current',number))
            if target is None:previous=parent;continue
            previous=writer.add_outline_item(str(item.title),target,parent=parent,
                color=item.get('/C'),bold=bool(int(item.get('/F',0))&2),italic=bool(int(item.get('/F',0))&1),
                fit=Fit(str(item.typ),list(item.dest_array)[2:]),is_open=int(item.get('/Count',0))>=0)
    outlines(current.outline)
    for index,item in enumerate(order):
        if item.get('blank'):continue
        source=item.get('source','current');reader=readers[source];original=reader.pages[item['page']-1];page=writer.pages[index]
        links=[]
        for ref in original.get('/Annots',[]):
            annotation=ref.get_object();action=annotation.get('/A',{}).get_object() if hasattr(annotation.get('/A',{}),'get_object') else annotation.get('/A',{})
            if annotation.get('/Subtype')!='/Link' or ('/Dest' not in annotation and action.get('/S')!='/GoTo'):continue
            destination=annotation.get('/Dest',action.get('/D'))
            if isinstance(destination,str):destination=reader.named_destinations.get(destination)
            if hasattr(destination,'dest_array'):destination=destination.dest_array
            if hasattr(destination,'get_object'):destination=destination.get_object()
            if not isinstance(destination,list) or not destination:continue
            first=destination[0]
            target=ref_maps[source].get((first.idnum,first.generation)) if hasattr(first,'idnum') else None
            if target is None and isinstance(first,(int,NumberObject)):target=int(first)
            mapped=page_map.get((source,target))
            if mapped is None:continue
            clone=annotation.clone(writer,force_duplicate=True);clone.pop('/A',None)
            clone[NameObject('/Dest')]=ArrayObject([writer.pages[mapped].indirect_reference,*destination[1:]])
            clone[NameObject('/P')]=page.indirect_reference;links.append(writer._add_object(clone))
        existing=[]
        for ref in page.get('/Annots',[]):
            a=ref.get_object();act=a.get('/A',{}).get_object() if hasattr(a.get('/A',{}),'get_object') else a.get('/A',{})
            if not (a.get('/Subtype')=='/Link' and ('/Dest' in a or act.get('/S')=='/GoTo')):existing.append(ref)
        if existing or links:page[NameObject('/Annots')]=ArrayObject(existing+links)
        else:page.pop('/Annots',None)
    for offset,item in enumerate(order):
        page=writer.pages[offset];page.pdf=writer;rotation=item.get('rotation',0)
        if item.get('copyAnnotations') is False or item.get('copyForms') is False:
            kept=[]
            for ref in page.get('/Annots',[]):
                a=ref.get_object();widget=a.get('/Subtype')=='/Widget'
                if (widget and item.get('copyForms') is not False) or (not widget and item.get('copyAnnotations') is not False):kept.append(ref)
            page[NameObject('/Annots')]=ArrayObject(kept)
        if item.get('keepTargetAnnotations') and item.get('replaces'):
            old=item['replaces'];target=readers[old.get('source','current')].pages[old['page']-1]
            kept=list(page.get('/Annots',[]))
            for ref in target.get('/Annots',[]):
                a=ref.get_object().clone(writer,force_duplicate=True);a[NameObject('/P')]=page.indirect_reference
                kept.append(writer._add_object(a))
            page[NameObject('/Annots')]=ArrayObject(kept)
        if type(rotation)!=int or rotation%90:raise ValueError('页面旋转须为 90° 的倍数')
        if rotation:page.rotate(rotation)
        if item.get('size'):
            width,height=map(dimension,item['size']);resize=item.get('resize') or {}
            if resize.get('canvasOnly'):
                b=page.mediabox;page.mediabox=RectangleObject([b.left,b.bottom,b.left+width,b.bottom+height]);page.cropbox=page.mediabox
            elif resize.get('keepAspect'):
                b=page.mediabox;scale=min(width/float(b.width),height/float(b.height))
                dx=(width-float(b.width)*scale)/2-float(b.left)*scale;dy=(height-float(b.height)*scale)/2-float(b.bottom)*scale
                page.scale(scale,scale);page.add_transformation(Transformation().translate(dx,dy))
                # scale() updates annotation rectangles; move their geometry with the content.
                for ref in page.get('/Annots',[]):
                    a=ref.get_object()
                    for key in ['/Rect','/QuadPoints']:
                        if key in a:
                            from pypdf.generic import FloatObject
                            a[NameObject(key)]=ArrayObject([FloatObject(float(v)+(dx if i%2==0 else dy)) for i,v in enumerate(a[key])])
                page.mediabox=RectangleObject([0,0,width,height]);page.cropbox=page.mediabox
            else:page.scale_to(width,height)
        if item.get('crop'):
            left,top,right,bottom=map(float,item['crop']);box=page.cropbox
            if not all(math.isfinite(v) and v>=0 for v in (left,top,right,bottom)) or left+right>=box.width or top+bottom>=box.height:raise ValueError('裁剪须保留可见页面')
            page.cropbox=RectangleObject([box.left+left,box.bottom+bottom,box.right-right,box.top-top])
    if current.metadata:writer.add_metadata({str(k):str(v) for k,v in current.metadata.items()})
    buf=io.BytesIO();writer.write(buf);data=buf.getvalue()
    marks=options.get('marks')
    if marks:
        import fitz
        with fitz.open(stream=data,filetype='pdf') as doc:
            pages=marks.get('pages',list(range(1,len(doc)+1)))
            for number in pages:
                if type(number)!=int or not 1<=number<=len(doc):raise ValueError('标记页码无效')
                p=doc[number-1];text=str(marks.get('text','{page}')).replace('{page}',str(number)).replace('{pages}',str(len(doc)))
                size=dimension(marks.get('size',12));margin=float(marks.get('margin',24));kind=marks.get('kind','footer')
                if not math.isfinite(margin) or not 0<=margin<min(p.rect.width,p.rect.height)/2:raise ValueError('标记边距无效')
                color=str(marks.get('color','#667085')).lstrip('#')
                if len(color)!=6:raise ValueError('颜色须为 #RRGGBB')
                rgb=tuple(int(color[j:j+2],16)/255 for j in (0,2,4))
                if kind=='background':p.draw_rect(p.rect,color=None,fill=rgb,overlay=False)
                else:
                    y=margin if kind=='header' else (p.rect.height/2-size if kind=='watermark' else p.rect.height-margin-size*1.5)
                    rect=fitz.Rect(margin,y,p.rect.width-margin,y+size*2)
                    opacity=float(marks.get('opacity',.2 if kind=='watermark' else 1))
                    if not 0<=opacity<=1:raise ValueError('不透明度应为 0–1')
                    remaining=p.insert_textbox(rect,text,fontsize=size,fontname='china-s' if any(ord(c)>255 for c in text) else 'helv',color=rgb,align=1,overlay=True,fill_opacity=opacity)
                    if remaining<0:raise ValueError('标记文字放不下，请缩小字号或减少文字')
            data=doc.tobytes(garbage=3,deflate=True)
    return {'bytes':base64.b64encode(data).decode(),'extension':'pdf','pageCount':len(order),'size':len(data)}

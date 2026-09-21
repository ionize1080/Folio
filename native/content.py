"""Preserve untouched content operators; isolate generated content in form XObjects."""
import io,hashlib,base64,time
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (ContentStream,DecodedStreamObject,NameObject,ArrayObject,
    FloatObject,NumberObject,DictionaryObject,ByteStringObject,TextStringObject,IndirectObject,StreamObject)

TEXT={b'Tj',b'TJ',b"'",b'"'}
PAINT={b'S',b's',b'f',b'F',b'f*',b'B',b'B*',b'b',b'b*'}
def raw_strings(v):
    if isinstance(v,TextStringObject): return ByteStringObject(v.original_bytes)
    if isinstance(v,ArrayObject): return ArrayObject([raw_strings(x) for x in v])
    return v

def map_objects(page):
    stream=ContentStream(page.get('/Contents'),page.pdf)
    objects=[]; start=None; shown=[];path_started=False
    fonts=page['/Resources'].get('/XObject',{});fonts=fonts.get_object() if hasattr(fonts,'get_object') else fonts
    for i,(args,op) in enumerate(stream.operations):
        if op in (b'm',b'l',b'c',b'v',b'y',b're'):path_started=True
        if op==b'BT':start=i;shown=[]
        if op in TEXT:
            strings=args[0] if op==b'TJ' else [args[-1]]
            if any(isinstance(x,(str,bytes)) and len(x) for x in strings):
                objects.append({'type':'text','at':i,'begin':start,'end':None});shown.append(objects[-1])
        elif op==b'ET':
            for o in shown:o['end']=i;o['single']=len(shown)==1
            start=None;shown=[]
        elif op in PAINT:
            # Empty paint operators create no PDFium object. Counting them
            # shifts every following index (common in SVG-generated PDFs).
            if path_started:objects.append({'type':'path','at':i})
            path_started=False
        elif op==b'n':path_started=False
        elif op==b'Do':
            ob=fonts.get(args[0]);ob=ob.get_object() if ob else {}
            objects.append({'type':'form' if ob.get('/Subtype')=='/Form' else 'image','at':i})
        elif op in (b'sh',b'INLINE IMAGE'):objects.append({'type':'shading' if op==b'sh' else 'image','at':i})
    return stream,objects

def check_editable(page,descriptions):
    try:
        stream,mapped=map_objects(page)
        from text_advance import advances
        safe=advances(page,stream)
        if len(mapped)!=len(descriptions) or any(a['type']!=b['type'] for a,b in zip(mapped,descriptions)):
            raise ValueError('页面对象与内容流无法可靠对应，暂不修改原对象；仍可新增文字')
        for a,b in zip(mapped,descriptions):
            b['flowEditable']=bool((b['editable'] or b.get('simpleText')) and a['type']=='text')
            if a['type']=='text':
                b['textGroup']=a.get('begin')
                b['independentFlow']=bool(a.get('single') or safe.get(a['at']) is not None)
                b['flowEditable']=b['flowEditable'] and b['independentFlow']
            if a['type']=='text' and not (a.get('single') and a.get('end') is not None):
                b['editable']=False;b['reason']='此文字与其他片段共用文字组，暂不能安全单独替换；可新增文本框'
        return mapped
    except Exception as e:
        for b in descriptions:
            b['editable']=False;b['flowEditable']=False;b['reason']=str(e)
        return None

def compose(data,edits,blocks,inspect,fragment,progress=None):
    reader=PdfReader(io.BytesIO(data));writer=PdfWriter(clone_from=reader)
    bypage={};stream_cache={}
    for e in edits:bypage.setdefault(e['page'],{'edits':[],'blocks':[]})['edits'].append(e)
    # blocks can be an iterator read from a JSON-lines file. At most one page's result is held per fragment.
    def form(page,blob,align_top=False,ocr_layer=False):
        from generated_cmaps import repair
        blob=repair(blob)
        source=PdfReader(io.BytesIO(blob));p=source.pages[0]
        # Reuse identical font/CMap streams without retaining one complete source reader per page.
        visited=set()
        def intern(value):
            if isinstance(value,IndirectObject):
                if value.idnum in visited:return
                visited.add(value.idnum);obj=value.get_object()
                if isinstance(obj,StreamObject):
                    digest=hashlib.sha256(obj.get_data()).hexdigest()
                    if digest in stream_cache:
                        writer._id_translated.setdefault(id(source),{'PreventGC':source})[value.idnum]=stream_cache[digest]
                    else:stream_cache[digest]=value.clone(writer).idnum
                    return
                value=obj
            if isinstance(value,DictionaryObject):
                for v in value.values():intern(v)
            elif isinstance(value,(ArrayObject,list)):
                for v in value:intern(v)
        intern(p['/Resources'])
        resources_clone=p['/Resources'].clone(writer)
        writer._id_translated.pop(id(source),None)
        x=DecodedStreamObject();x.set_data(p.get_contents().get_data())
        x.update({NameObject('/Type'):NameObject('/XObject'),NameObject('/Subtype'):NameObject('/Form'),
          NameObject('/BBox'):ArrayObject([FloatObject(x) for x in page.mediabox]),
          NameObject('/Resources'):resources_clone})
        if align_top:
            # Preserve intentional outside-page text in the form; the page itself remains the visible crop.
            x[NameObject('/BBox')]=ArrayObject([FloatObject(v) for v in [-14400,-14400,28800,28800]])
            x[NameObject('/Matrix')]=ArrayObject([FloatObject(v) for v in [1,0,0,1,0,float(page.mediabox.top)-float(p.mediabox.top)]])
        x[NameObject("/FolioLayerVersion")]=NumberObject(2)
        x[NameObject("/FolioLayerKind")]=NameObject("/OCR" if ocr_layer else "/Content")
        if ocr_layer:x[NameObject("/FolioOCRVersion")]=NumberObject(1)
        ref=writer._add_object(x)
        resources=DictionaryObject(dict(page['/Resources']));page[NameObject('/Resources')]=resources
        old=resources.get('/XObject',{});old=old.get_object() if hasattr(old,'get_object') else old
        xs=DictionaryObject(dict(old));resources[NameObject('/XObject')]=xs
        j=1
        while NameObject(f'/FolioEdit{j}') in xs:j+=1
        name=NameObject(f'/FolioEdit{j}');xs[name]=ref
        return [([],b'q'),([name],b'Do'),([],b'Q')]
    def process(number,bs):
        if not isinstance(number,int) or not 1<=number<=len(writer.pages):raise ValueError('页码无效')
        page=writer.pages[number-1];es=bypage.pop(number,{'edits':[]})['edits']
        if not es and not bs:return
        width,height=float(page.mediabox.width),float(page.mediabox.height)
        flows=sorted([e for e in es if e.get('type')=='flow' and not e.get('delete')],key=lambda e:float((e.get('model') or {}).get('layerOrder',0)))
        replace=[e for e in es if e.get('index') is not None]
        appended=[e for e in es if e.get('index') is None and not e.get('delete') and e.get('type')!='flow']
        flow_indices=set(); flow_blobs=[]; original_patches={}
        if flows:
            desc=inspect(number);mapped=check_editable(page,desc)
            for flow in flows:
                sources=flow.get('sources',[]);indices={e.get('index') for e in sources}
                if len(indices)!=len(sources) or indices & flow_indices:raise ValueError('文本流包含重复原对象')
                if any(e.get('index') in indices for e in replace):raise ValueError('文本流与已有对象修改重叠，请先撤销重叠修改')
                for source in sources:
                    idx=source.get('index')
                    if mapped is None or not isinstance(idx,int) or not 0<=idx<len(desc):raise ValueError('段落对象映射不可靠')
                    d=desc[idx];m=mapped[idx]
                    if not d.get('flowEditable') or d['signature']!=source.get('signature'):raise ValueError('段落包含不可安全替换或已变化的对象')
                patch=None
                if len(sources)==1:
                    from original_patch import correction
                    original_stream,_=map_objects(page)
                    patch=correction(page,original_stream,mapped[sources[0]['index']],desc[sources[0]['index']],flow)
                if patch is not None:
                    original_patches[mapped[sources[0]['index']]['at']]=patch
                    flow_indices.update(indices)
                    continue
                for source in sources:replace.append({**source,'delete':True,'_flowDelete':True})
                flow_indices.update(indices)
                blob=base64.b64decode(flow.get('fragment',''),validate=True)
                if len(blob)>32*1024*1024:raise ValueError('排版片段过大')
                layout=PdfReader(io.BytesIO(blob))
                if len(layout.pages)!=1:raise ValueError('排版片段须为单页')
                lp=layout.pages[0]
                if abs(float(lp.mediabox.width)-width)>2.5 or abs(float(lp.mediabox.height)-height)>2.5:raise ValueError('排版页面尺寸与原件不一致')
                if any(abs(float(v))>.01 for v in page.mediabox[:2]):raise ValueError('此页坐标原点暂不支持流式替换')
                flow_blobs.append((blob,True,bool((flow.get('model') or {}).get('behindPage')),False))
        from table_resize import changes,transform
        growths=changes(es)
        if growths and not replace:
            desc=inspect(number);mapped=check_editable(page,desc)
            if mapped is None:raise ValueError('此表格的内容映射暂不支持自动行高')
            stream,_=map_objects(page);wraps=transform(stream,mapped,desc,height,growths) or ({},{})
            ops=[]
            for i,(args,op) in enumerate(stream.operations):ops.extend(wraps[0].get(i,[]));ops.append((args,op));ops.extend(wraps[1].get(i,[]))
            stream.operations=ops;page[NameObject('/Contents')]=writer._add_object(stream)
        if replace:
            desc=inspect(number);mapped=check_editable(page,desc)
            if mapped is None:raise ValueError(desc[0]['reason'] if desc else '内容流不支持安全编辑')
            stream,_=map_objects(page);omit=set();after={};used=set()
            table_before,table_after=transform(stream,mapped,desc,height,growths) or ({},{})
            from text_advance import advances
            safe=advances(page,stream)
            replacements=dict(original_patches)
            omit.update(original_patches)
            for e in replace:
                idx=e['index']
                if idx in used or not isinstance(idx,int) or not 0<=idx<len(desc):raise ValueError('对象编号无效或重复')
                used.add(idx);d=desc[idx];m=mapped[idx]
                if d['signature']!=e.get('signature'):raise ValueError('对象已变化，请重新选择')
                if not d['editable'] and not (e.get('_flowDelete') and idx in flow_indices and d.get('flowEditable')):raise ValueError(d.get('reason','此对象不能安全修改'))
                if m['type']=='image':
                    if stream.operations[m['at']][1]!=b'Do':raise ValueError('内联图片暂不支持替换')
                    if e.get('delete'):omit.add(m['at']);continue
                    ctm=[1,0,0,1,0,0];stack=[]
                    for ar,op in stream.operations[:m['at']+1]:
                        if op==b'q':stack.append(ctm[:])
                        elif op==b'Q':ctm=stack.pop() if stack else [1,0,0,1,0,0]
                        elif op==b'cm':
                            a,b,c,d0,e0,f=map(float,ar);A,B,C,D,E,F=ctm
                            ctm=[A*a+C*b,B*a+D*b,A*c+C*d0,B*c+D*d0,A*e0+C*f+E,B*e0+D*f+F]
                    from image_edit import operations as image_operations
                    after[m['at']]=image_operations(writer,page,stream.operations[m['at']],e.get('matrix',d['matrix']),ctm,e.get('crop'),e.get('imageData'),e.get('imageFit','contain'))
                    omit.add(m['at']);continue
                if m['type']=='text':
                    omit.add(m['at']);position=m['end']
                    # Keep advances and quote side effects, without retaining the source strings.
                    if safe.get(m['at']) is not None:replacements[m['at']]=safe[m['at']]
                    elif not m.get('single'):raise ValueError('此文字不能安全独立替换')
                else:position=m['at'];stream.operations[position]=([],b'n')
                if not e.get('delete'):
                    # Undo the active outer transform before placing native-coordinate content.
                    # The fragment matrix already uses native page coordinates.
                    ctm=[1,0,0,1,0,0];stack=[]
                    for ar,op in stream.operations[:position+1]:
                        if op==b'q':stack.append(ctm[:])
                        elif op==b'Q':ctm=stack.pop() if stack else [1,0,0,1,0,0]
                        elif op==b'cm':
                            a,b,c,d0,e0,f=map(float,ar);A,B,C,D,E,F=ctm
                            ctm=[A*a+C*b,B*a+D*b,A*c+C*d0,B*c+D*d0,A*e0+C*f+E,B*e0+D*f+F]
                    a,b,c,d0,e0,f=ctm;det=a*d0-b*c
                    if abs(det)<1e-12:raise ValueError('页面变换不可逆')
                    inv=[d0/det,-b/det,-c/det,a/det,(c*f-d0*e0)/det,(b*e0-a*f)/det]
                    patch={**d,**e,'index':None}
                    calls=form(page,fragment(width,height,[patch],[]))
                    after.setdefault(position,[]).extend([([],b'q'),([FloatObject(v) for v in inv],b'cm')]+calls+[([],b'Q')])
            operations=[]
            for i,(args,op) in enumerate(stream.operations):
                operations.extend(table_before.get(i,[]))
                if i not in omit:operations.append(([raw_strings(v) for v in args] if op in TEXT else args,op))
                operations.extend(replacements.get(i,[]))
                operations.extend(after.get(i,[]))
                operations.extend(table_after.get(i,[]))
            stream.operations=operations;page[NameObject('/Contents')]=writer._add_object(stream)
        if original_patches and not replace:
            stream,_=map_objects(page);operations=[]
            for i,(args,op) in enumerate(stream.operations):operations.extend(original_patches.get(i,[(args,op)]))
            stream.operations=operations;page[NameObject('/Contents')]=writer._add_object(stream)
        if bs:
            # Replace only our own identified layer. Unknown third-party hidden
            # text and original vector content remain untouched.
            resources=page.get('/Resources',{});xs=resources.get('/XObject',{});xs=xs.get_object() if hasattr(xs,'get_object') else xs
            owned={name for name,ref in xs.items() if ref.get_object().get('/FolioOCRVersion')==1}
            if owned:
                stream=ContentStream(page.get('/Contents'),writer)
                stream.operations=[(a,o) for a,o in stream.operations if not(o==b'Do' and a and a[0] in owned)]
                page[NameObject('/Contents')]=writer._add_object(stream)
                for name in owned:del xs[name]
        if appended or bs or flow_blobs:
            blobs=([(fragment(width,height,appended,[]),False,False,False)] if appended else [])+([(fragment(width,height,[],bs),False,False,True)] if bs else [])+flow_blobs
            # Enclose original content so its leftover text/graphics state cannot leak into additions.
            before=ContentStream(None,writer);before.operations=[]
            end=ContentStream(None,writer);end.operations=[([],b'Q')]
            for blob,align_top,behind,is_ocr in blobs:
                if behind:before.operations+=form(page,blob,align_top,is_ocr)
                else:end.operations+=form(page,blob,align_top,is_ocr)
            before.operations.append(([],b'q'))
            oldref=page.raw_get('/Contents') if '/Contents' in page else None
            old=oldref.get_object() if oldref is not None else None
            refs=list(old) if isinstance(old,ArrayObject) else ([oldref] if oldref is not None else [])
            page[NameObject('/Contents')]=ArrayObject([writer._add_object(before),*refs,writer._add_object(end)])
        if progress:progress(number)
    current=None;group=[]
    for b in blocks:
        p=b['page']
        if current is not None and p!=current:process(current,group);group=[]
        current=p;group.append({**b,'page':1})
    if current is not None:process(current,group)
    for number in sorted(list(bypage)):process(number,[])
    output=io.BytesIO();writer.write(output);return output.getvalue()

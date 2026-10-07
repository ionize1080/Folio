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
    from clip_contract import clip_states
    clipping=clip_states(stream.operations)
    objects=[]; start=None; shown=[];path_started=False;marks=[];graphics={};graphics_stack=[]
    fonts=page['/Resources'].get('/XObject',{});fonts=fonts.get_object() if hasattr(fonts,'get_object') else fonts
    for i,(args,op) in enumerate(stream.operations):
        previous_count=len(objects)
        if op==b'q':graphics_stack.append(graphics.copy())
        elif op==b'Q':graphics=graphics_stack.pop() if graphics_stack else {}
        elif op==b'gs' and args:
            gs=page['/Resources'].get('/ExtGState',{});gs=gs.get_object() if hasattr(gs,'get_object') else gs
            state=gs.get(args[0],{});state=state.get_object() if hasattr(state,'get_object') else state
            graphics.update(state)
        if op in (b'BDC',b'BMC'):
            properties=args[1] if op==b'BDC' and len(args)>1 else {}
            if isinstance(properties,NameObject):
                table=page['/Resources'].get('/Properties',{});table=table.get_object() if hasattr(table,'get_object') else table
                properties=table.get(properties,{})
            properties=properties.get_object() if hasattr(properties,'get_object') else properties
            value=properties.get('/ActualText') if isinstance(properties,dict) else None
            if isinstance(value,ByteStringObject):
                try:value=bytes(value).decode('utf-16')
                except UnicodeError:value=None
            marks.append({'flowText':properties.get('/FolioText') if isinstance(properties,dict) and args[0]=='/FolioParagraph' else None,'text':value,'mcid':properties.get('/MCID') if isinstance(properties,dict) else None,'objects':[],'at':i})
        elif op==b'EMC' and marks:
            mark=marks.pop()
            if isinstance(mark.get('flowText'),str):
                for obj in mark['objects']:
                    obj.setdefault('flowGroup',mark['at']);obj.setdefault('flowText',mark['flowText'])
            if mark['mcid'] is not None:
                for obj in mark['objects']:obj.setdefault('structureScopes',[]).append({'at':mark['at'],'end':i,'count':len(mark['objects']),'mcid':int(mark['mcid'])})
            if isinstance(mark['text'],str):
                for obj in mark['objects']:obj.setdefault('semanticScopes',[]).append({'at':mark['at'],'end':i,'count':len(mark['objects']),'text':mark['text']})
                if len(mark['objects'])==1:mark['objects'][0]['actualText']=mark['text']
        if op in (b'm',b'l',b'c',b'v',b'y',b're'):path_started=True
        if op==b'BT':start=i;shown=[]
        if op in TEXT:
            strings=args[0] if op==b'TJ' else [args[-1]]
            if any(isinstance(x,(str,bytes)) and len(x) for x in strings):
                complex_state=(str(graphics.get('/BM','/Normal')) not in ('/Normal','/Compatible') or str(graphics.get('/SMask','/None'))!='/None' or any(float(graphics.get(k,1))!=1 for k in ('/ca','/CA')) or any(k in graphics for k in ('/TR','/TR2','/HT')))
                objects.append({'type':'text','at':i,'begin':start,'end':None,'complexGraphics':complex_state});shown.append(objects[-1])
                for mark in marks:mark['objects'].append(objects[-1])
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
        if op not in TEXT and len(objects)>previous_count:
            for mark in marks:mark['objects'].extend(objects[previous_count:])
    for obj in objects:obj['clipBounds']=clipping.get(obj['at'],())
    return stream,objects

def decoded_texts(page,stream):
    from pypdf._cmap import get_encoding
    fonts=page['/Resources'].get('/Font',{});fonts=fonts.get_object() if hasattr(fonts,'get_object') else fonts
    cache={};decoded={};font=None;stack=[]
    for at,(args,op) in enumerate(stream.operations):
        if op==b'q':stack.append(font)
        elif op==b'Q':font=stack.pop() if stack else None
        elif op==b'Tf':font=args[0]
        elif op in TEXT:
            if font not in cache:cache[font]=get_encoding(fonts[font].get_object())
            encoding,cmap=cache[font];out=[]
            values=args[0] if op==b'TJ' else [args[-1]]
            for v in values:
                if not isinstance(v,(str,bytes)):continue
                raw=v.original_bytes if isinstance(v,TextStringObject) else bytes(v)
                text=raw.decode(encoding,errors='strict') if isinstance(encoding,str) else ''.join(encoding[c] for c in raw)
                out.append(''.join(cmap.get(c,c) for c in text))
            decoded[at]=''.join(out)
    return decoded

def align_text_objects(page,stream,mapped,descriptions):
    """Recover text ownership only when non-path order AND decoded text agree.
    PDFium may coalesce path paints. Those paths remain read-only; no guessed
    operator is ever deleted to make object counts agree.
    """
    from pypdf._cmap import get_encoding
    left=[m for m in mapped if m['type']!='path']
    right=[d for d in descriptions if d['type']!='path']
    if len(left)!=len(right) or any(a['type']!=b['type'] for a,b in zip(left,right)):
        raise ValueError('页面对象与内容流无法可靠对应，仍可新增文字')
    decoded=decoded_texts(page,stream)
    # PDFium synthesizes spaces from TJ offsets and reverses RTL extraction.
    # Only space-equivalent strings receive writable ownership. Unsupported
    # encodings/RTL objects keep their original stream and remain read-only.
    compact=lambda text: ''.join(c for c in text if c not in ' \r\n')
    verified=[]
    for a,b in zip(left,right):
        ok=a['type']=='text' and bool(compact(b.get('text',''))) and compact(decoded.get(a['at'],''))==compact(b.get('text',''))
        verified.append(a if ok else {**a,'unmapped':True})
    if not any(not a.get('unmapped') for a in verified):raise ValueError('无法验证文字与内容流的对应关系')
    remaining=iter(verified)
    return [{'type':d['type'],'at':None,'unmapped':True} if d['type']=='path' else next(remaining) for d in descriptions]

def check_editable(page,descriptions):
    try:
        stream,mapped=map_objects(page)
        from text_advance import advances
        safe=advances(page,stream)
        try:decoded=decoded_texts(page,stream)
        except Exception:decoded={}
        if len(mapped)!=len(descriptions) or any(a['type']!=b['type'] for a,b in zip(mapped,descriptions)):
            mapped=align_text_objects(page,stream,mapped,descriptions)
        for position,(a,b) in enumerate(zip(mapped,descriptions)):
            if a['type']!='text' and a.get('semanticScopes'):
                b['editable']=False;b['flowEditable']=False;b['reason']='此图形对象属于替代文字语义范围，保留原对象';continue
            if a.get('unmapped'):
                b['editable']=False;b['flowEditable']=False;b['reason']='此对象无法验证内容流对应关系，保留原对象；已验证的文字可独立编辑';continue
            b['clipBounds']=a.get('clipBounds',())
            b['flowEditable']=bool((b['editable'] or b.get('simpleText')) and a['type']=='text' and None not in b['clipBounds'])
            if a['type']=='text':
                if a.get('complexGraphics'):
                    b['editable']=False;b['flowEditable']=False;b['reason']='此文字含透明度、混合或传递函数，保留原绘制状态';continue
                source_text=decoded.get(a['at'])
                # PDFium's object extraction can attach a generated separator
                # between distant calls to the preceding object. It has no
                # source glyph and can make exact layout mapping fail.
                if isinstance(source_text,str) and b.get('text','').rstrip(' ')==source_text.rstrip(' '):
                    b['text']=source_text
                if any(scope['count'] != 1 for scope in a.get('semanticScopes',[])):
                    b['editable']=False;b['flowEditable']=False;b['reason']='多个文字对象共用替代文字语义，需整体语义编辑；保留原对象';continue
                # PDFium can invent a trailing space after a narrow glyph kept
                # in a wider original slot. A one-character ActualText scope
                # proves the intended text without changing raw signatures.
                actual=a.get('actualText')
                if actual is not None and b.get('text','').strip()!=actual.strip():
                    b['editable']=False;b['flowEditable']=False;b['reason']='替代文字与可见字形不一致，保留原语义';continue
                if actual is not None and b.get('text','').strip()==actual.strip():
                    b['text']=actual
                    # PDFium distributes ActualText boxes but can report one
                    # shared origin for every scalar. These are semantic boxes,
                    # not the original glyph anchors; use normal layout instead.
                    glyphs=b.get('glyphs',[])
                    if len(actual)>1 and any(abs(a['originX']-c['originX'])<.001 and abs(a['baseline']-c['baseline'])<.001 and abs(a['x']-c['x'])>.01 for a,c in zip(glyphs,glyphs[1:])):
                        b.pop('glyphs',None)
                    # Paragraph extraction omits zero-ink whitespace objects.
                    # Carry their explicit characters on the preceding painted
                    # object, even when the source space shared the next origin.
                    if not actual.isspace():
                        for next_position in range(position+1,len(mapped)):
                            value=mapped[next_position].get('actualText')
                            if not isinstance(value,str) or not value.isspace():break
                            b['text']+=value
                    b['textSpacingExplicit']=True
                if 'flowGroup' in a:b.update(flowGroup=a['flowGroup'],flowText=a['flowText'])
                b['textGroup']=a.get('begin')
                b['independentFlow']=bool(a.get('single') or safe.get(a['at']) is not None)
                b['flowEditable']=b['flowEditable'] and b['independentFlow']
            b['styleEditable']=bool(a['type']=='text' and b['editable'] and a.get('at') is not None)
            if a['type']=='text' and not (a.get('single') and a.get('end') is not None):
                b['editable']=False;b['reason']='此文字与其他片段共用文字组，暂不能安全单独替换；可新增文本框'
        return mapped
    except Exception as e:
        for b in descriptions:
            b['editable']=False;b['flowEditable']=False;b['reason']=str(e)
        return None

def clear_actual_text(page,stream,mapped):
    # Detach named/shared property dictionaries before changing this invocation.
    for scope in mapped.get('semanticScopes',[]):
        if scope['count'] != 1:raise ValueError('不能局部删除共用替代文字语义')
        at=scope['at'];args,op=stream.operations[at];props=args[1]
        if isinstance(props,NameObject):props=page['/Resources']['/Properties'][props].get_object()
        props=DictionaryObject(dict(props));props.pop('/ActualText',None)
        stream.operations[at]=([args[0],props],op)


def stream_identity(stream):
    # Only deduplicate leaf streams with scalar dictionaries. Child references,
    # resources, Decode parameters and complex dictionaries need graph identity.
    values={}
    for key,value in stream.items():
        if key in ('/Length','/Filter','/DecodeParms'):continue
        if isinstance(value,IndirectObject) or isinstance(value,(dict,list,tuple)):return None
        if not isinstance(value,(str,bytes,int,float,bool)):return None
        values[str(key)]=(type(value).__name__,repr(value))
    import json
    return hashlib.sha256(json.dumps(values,sort_keys=True).encode()+b'\0'+stream.get_data()).hexdigest()

def compose(data,edits,blocks,inspect,fragment,progress=None):
    from pdf_writer import clone_document
    reader=PdfReader(io.BytesIO(data));writer=clone_document(reader)
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
                    digest=stream_identity(obj)
                    if digest is not None and digest in stream_cache:
                        writer._id_translated.setdefault(id(source),{'PreventGC':source})[value.idnum]=stream_cache[digest]
                    elif digest is not None:stream_cache[digest]=value.clone(writer).idnum
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
            x[NameObject('/Matrix')]=ArrayObject([FloatObject(v) for v in [1,0,0,1,float(page.cropbox.left),float(page.cropbox.top)-float(p.mediabox.top)]])
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
        deleted_indices={e['index'] for e in replace if e.get('delete')}
        appended=[e for e in es if e.get('index') is None and not e.get('delete') and e.get('type')!='flow']
        flow_indices=set(); flow_blobs=[]; original_patches={}; inline_flows={}; relocated_marks=set()
        if flows:
            desc=inspect(number);mapped=check_editable(page,desc)
            fonts_checked=False
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
                    from clip_contract import validate_patch
                    idx=sources[0]['index']
                    if not validate_patch(page,original_stream,idx,len(desc),mapped[idx]['at'],patch,desc[idx].get('clipBounds',())):patch=None
                if patch is not None:
                    original_patches[mapped[sources[0]['index']]['at']]=patch
                    flow_indices.update(indices)
                    continue
                model=flow.get('model') or {}
                if model.get('text') and sources and not fonts_checked:
                    from font_match import inspect_fonts
                    inspect_fonts(data,number,desc,mapped,map_objects(page)[0]);fonts_checked=True
                if model.get('text') and any(desc[source['index']].get('fontResolution')=='metric-substitute' for source in sources):
                    styles=model.get('runs') or [model]
                    if any(style.get('fontResolution',model.get('fontResolution'))=='metric-substitute' for style in styles):
                        raise ValueError('原字体未嵌入，本次修改需要重绘；请在字体栏明确选择并确认替代字体后再应用。草稿已保留')
                for source in sources:replace.append({**source,'delete':True,'_flowDelete':True})
                flow_indices.update(indices)
                if (flow.get('model') or {}).get('text') == '':continue
                blob=base64.b64decode(flow.get('fragment',''),validate=True)
                if len(blob)>32*1024*1024:raise ValueError('排版片段过大')
                layout=PdfReader(io.BytesIO(blob))
                if len(layout.pages)!=1:raise ValueError('排版片段须为单页')
                lp=layout.pages[0]
                if abs(float(lp.mediabox.width)-float(page.cropbox.width))>2.5 or abs(float(lp.mediabox.height)-float(page.cropbox.height))>2.5:raise ValueError('排版页面尺寸与原件不一致')
                from text_semantics import mark_paragraph
                blob=mark_paragraph(blob,(flow.get('model') or {}).get('text',''))
                structured=[scope for source in sources for scope in mapped[source['index']].get('structureScopes',[])]
                preserve_site=bool(sources) and not (flow.get('model') or {}).get('behindPage') and (flow.get('model') or {}).get('layerOrder') is None
                relocated_scope=None
                if structured:
                    scopes={(s['at'],s['end'],s['count'],s['mcid']) for s in structured}
                    if len(scopes)!=1 or structured[0]['count']!=len(sources) or len(structured)!=len(sources):raise ValueError('带标签文字需在同一完整 MCID 范围内编辑，草稿已保留')
                    scope=structured[0];ends=[mapped[source['index']].get('end') for source in sources]
                    if any(end is None for end in ends):raise ValueError('标签文字范围不完整')
                    if any(not scope['at']<end<scope['end'] for end in ends):
                        # Entire MCID is selected, but its wrappers sit inside
                        # BT. Move that single complete marked-content scope to
                        # the replacement call after ET; page ownership/MCID and
                        # ParentTree stay unchanged and no Form nests a BT.
                        original_stream,_=map_objects(page)
                        relocated_scope=original_stream.operations[scope['at']]
                        relocated_marks.update((scope['at'],scope['end']))
                if structured or preserve_site:
                    ends=[mapped[source['index']].get('end') for source in sources]
                    if any(end is None for end in ends):raise ValueError('原文绘制范围不完整，草稿已保留')
                    position=max(ends);original_stream,_=map_objects(page)
                    first=min(mapped[source['index']]['at'] for source in sources)
                    # A paragraph cannot jump across an overlapping foreign paint.
                    # Disjoint paints have identical pixels at either ordering.
                    # Use painted ink, not the padded editing frame. A frame
                    # may legitimately overlap the next heading while no glyph
                    # does (common in dense annual reports).
                    # Compare bounds from the same engine as source objects.
                    # MuPDF's text paint envelopes include extra padding that
                    # falsely overlaps adjacent dotted leaders in tight tables.
                    import pypdfium2 as pdfium
                    with pdfium.PdfDocument(blob) as fragment_doc:
                        fragment_page=fragment_doc[0]
                        left=float(page.cropbox.left);bottom=float(page.cropbox.bottom)
                        ink_boxes=[[left+x0,bottom+y0,left+x1,bottom+y1] for obj in fragment_page.get_objects(max_depth=1) for x0,y0,x1,y1 in [obj.get_bounds()] if x1>x0 and y1>y0]
                        fragment_page.close()
                    clips=[clip for source in sources for clip in desc[source['index']].get('clipBounds',[])]
                    if any(box[0]<clip[0]-.01 or box[1]<clip[1]-.01 or box[2]>clip[2]+.01 or box[3]>clip[3]+.01 for box in ink_boxes for clip in clips):
                        raise ValueError('新文字超出原 PDF 裁剪边界，请缩小文字或调整位置；草稿已保留')
                    for j,item in enumerate(mapped):
                        if j in indices or j in deleted_indices or item.get('at') is None or not first<=item['at']<=position:continue
                        other=desc[j].get('bounds')
                        if other and any(min(box[2],other[2])>max(box[0],other[0])+.1 and min(box[3],other[3])>max(box[1],other[1])+.1 for box in ink_boxes):
                            raise ValueError('原文与其他绘制对象交错重叠，请分别编辑或明确调整图层，草稿已保留')
                    ctm=[1,0,0,1,0,0];stack=[]
                    for ar,op in original_stream.operations[:position+1]:
                        if op==b'q':stack.append(ctm[:])
                        elif op==b'Q':ctm=stack.pop() if stack else [1,0,0,1,0,0]
                        elif op==b'cm':
                            a,b,c,d,e,f=map(float,ar);A,B,C,D,E,F=ctm;ctm=[A*a+C*b,B*a+D*b,A*c+C*d,B*c+D*d,A*e+C*f+E,B*e+D*f+F]
                    a,b,c,d,e,f=ctm;det=a*d-b*c
                    if abs(det)<1e-12:raise ValueError('标签范围变换不可逆')
                    inv=[d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det]
                    calls=[([],b'q'),([FloatObject(v) for v in inv],b'cm')]+form(page,blob,True)+[([],b'Q')]
                    if relocated_scope:calls=[relocated_scope]+calls+[([],b'EMC')]
                    inline_flows.setdefault(position,[]).extend(calls)
                else:flow_blobs.append((blob,True,bool((flow.get('model') or {}).get('behindPage')),False))
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
            stream,_=map_objects(page);omit=set(relocated_marks);after=dict(inline_flows);used=set()
            table_before,table_after=transform(stream,mapped,desc,height,growths) or ({},{})
            from text_advance import advances
            safe=advances(page,stream)
            style_before={};style_after={}
            replacements=dict(original_patches)
            omit.update(original_patches)
            for e in replace:
                idx=e['index']
                if idx in used or not isinstance(idx,int) or not 0<=idx<len(desc):raise ValueError('对象编号无效或重复')
                used.add(idx);d=desc[idx];m=mapped[idx]
                if d['signature']!=e.get('signature'):raise ValueError('对象已变化，请重新选择')
                if not d['editable'] and not ('objectStyle' in e and d.get('styleEditable')) and not (e.get('_flowDelete') and idx in flow_indices and d.get('flowEditable')):raise ValueError(d.get('reason','此对象不能安全修改'))
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
                    after[m['at']]=image_operations(writer,page,stream.operations[m['at']],e.get('matrix',d['matrix']),ctm,e.get('crop'),e.get('imageData'),e.get('imageFit','contain'),e.get('adjustments'),e.get('_previewImage'),e.get('_previewLimit'),e.get('perspective'))
                    omit.add(m['at']);continue
                if m['type']=='text' and 'objectStyle' in e and not e.get('delete'):
                    from object_style import wrappers
                    style_before[m['at']],style_after[m['at']]=wrappers(stream,m['at'],d,e)
                    continue
                if m['type']=='text':
                    clear_actual_text(page,stream,m)
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
                    blob=fragment(width,height,[patch],[])
                    if m['type']=='text':
                        from clip_contract import validate_fragment
                        validate_fragment(blob,d.get('clipBounds',()))
                    calls=form(page,blob)
                    after.setdefault(position,[]).extend([([],b'q'),([FloatObject(v) for v in inv],b'cm')]+calls+[([],b'Q')])
            operations=[]
            for i,(args,op) in enumerate(stream.operations):
                operations.extend(table_before.get(i,[]))
                operations.extend(style_before.get(i,[]))
                if i not in omit:operations.append(([raw_strings(v) for v in args] if op in TEXT else args,op))
                operations.extend(replacements.get(i,[]))
                operations.extend(style_after.get(i,[]))
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
                resources=DictionaryObject(dict(resources));xs=DictionaryObject(dict(xs));resources[NameObject('/XObject')]=xs;page[NameObject('/Resources')]=resources
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
    from pdf_features import ensure_version
    ensure_version(writer)
    from pdf_writer import remove_orphans
    remove_orphans(writer)
    output=io.BytesIO();writer.write(output);return output.getvalue()

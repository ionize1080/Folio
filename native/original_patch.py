"""Conservative same-length corrections using an existing font resource.

No new glyph, font, CMap or text matrix is created. Unsupported cases use the
normal fragment path. TJ compensation preserves the advance of every slot.
"""
from pypdf.generic import ArrayObject, ByteStringObject, FloatObject, TextStringObject
from text_advance import font_metrics

def correction(page, stream, mapped, description, flow):
    try:
        model=flow.get('model') or {}; original=model.get('originalLayout') or {}
        old=original.get('text'); new=model.get('text')
        if not old or not new or old==new or len(old)!=len(new): return None
        if old!=description.get('text') or len(flow.get('sources',[]))!=1:return None
        if model.get('layoutMode')=='reflow' or model.get('frames') or model.get('cell') or model.get('columns',1)!=1:return None
        if any(model.get(k)!=v for k,v in original.get('settings',{}).items()):return None
        if any(abs(model['frame'][k]-original['frame'][k])>.01 for k in ('x','y','width','height')):return None
        glyphs=original.get('glyphs',[])
        if len(glyphs)!=len(old) or any(g.get('synthetic') or g['text']!=c for g,c in zip(glyphs,old)):return None
        if len({round(g['baseline'],2) for g in glyphs})!=1:return None
        if any(ord(c)<32 or ord(c)>0xffff for c in new):return None
        for r in model.get('runs',[]):
            if any(r.get(k,model.get(k))!=glyphs[0]['style'].get(k) for k in ('fontKey','size','color')) or r.get('bold') or r.get('italic'):return None
        state={'font':None,'size':0,'word':0};stack=[]
        at=mapped['at']
        for args,op in stream.operations[:at+1]:
            if op==b'q':stack.append(state.copy())
            elif op==b'Q':state=stack.pop() if stack else state
            elif op==b'Tf':state.update(font=args[0],size=float(args[1]))
            elif op==b'Tw':state['word']=float(args[0])
            elif op==b'"':state['word']=float(args[0])
        font=page['/Resources']['/Font'][state['font']].get_object()
        step,widths,default=font_metrics(font)
        if font.get('/ToUnicode'):
            try:from pypdf._cmap import _parse_to_unicode as parse_unicode
            except ImportError:from pypdf._cmap import parse_to_unicode as parse_unicode
            cmap,_=parse_unicode(font)
            mapping={ord(k):v for k,v in cmap.items() if isinstance(k,str) and len(k)==1 and isinstance(v,str) and len(v)==1}
        elif step==1 and str(font.get('/Encoding','/StandardEncoding')) in ('/StandardEncoding','/WinAnsiEncoding'):
            mapping={c:chr(c) for c in range(32,127)}
        else:return None
        reverse={}
        for code,char in mapping.items():reverse.setdefault(char,[]).append(code)
        if any(len(reverse.get(c,[]))!=1 for c in new):return None
        args,op=stream.operations[at];values=args[0] if op==b'TJ' else [args[-1]]
        original_codes=[]
        for value in values:
            if isinstance(value,(str,bytes)):
                raw=value.original_bytes if isinstance(value,TextStringObject) else bytes(value)
                if len(raw)%step:return None
                original_codes.extend(int.from_bytes(raw[j:j+step],'big') for j in range(0,len(raw),step))
        if ''.join(mapping.get(c,'\ufffd') for c in original_codes)!=old:return None
        result=[];cursor=0
        for value in values:
            if not isinstance(value,(str,bytes)):result.append(value);continue
            raw=value.original_bytes if isinstance(value,TextStringObject) else bytes(value)
            for j in range(0,len(raw),step):
                before=int.from_bytes(raw[j:j+step],'big');after=reverse[new[cursor]][0]
                wa=widths.get(after,default);wb=widths.get(before,default)
                if wa is None or wb is None or wa>wb+.01:return None
                delta=wa-wb
                if step==1:
                    if abs(state['size'])<1e-9:return None
                    delta+=((after==32)-(before==32))*state['word']*1000/state['size']
                result.append(ByteStringObject(after.to_bytes(step,'big')))
                if abs(delta)>1e-9:result.append(FloatObject(delta))
                cursor+=1
        prefix=[]
        if op==b'"':prefix=[([args[0]],b'Tw'),([args[1]],b'Tc')]
        if op in (b"'",b'"'):prefix.append(([],b'T*'))
        return prefix+[([ArrayObject(result)],b'TJ')]
    except (ValueError,KeyError,TypeError,IndexError,AttributeError,OverflowError):
        return None

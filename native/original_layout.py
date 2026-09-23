"""Capture PDFium character origins; preserve horizontal glyphs on local edits."""
import ctypes as C

def inspect(r,page,tp,objects,height):
    byptr={C.cast(r.FPDFPage_GetObject(page,o['index']),C.c_void_p).value:o for o in objects if o['type']=='text'}
    for i in range(r.FPDFText_CountChars(tp)):
        obj=r.FPDFText_GetTextObject(tp,i)
        o=byptr.get(C.cast(obj,C.c_void_p).value) if obj else None
        if o is None:continue
        cp=r.FPDFText_GetUnicode(tp,i)
        if not cp or cp>0x10ffff:continue
        hyphen = cp == 2 and r.FPDFText_IsHyphen(tp,i) == 1
        if hyphen:o['_hyphenCount']=o.get('_hyphenCount',0)+1;cp=45
        x,y=C.c_double(),C.c_double();bounds=[C.c_double() for _ in range(4)]
        if not r.FPDFText_GetCharOrigin(tp,i,C.byref(x),C.byref(y)):continue
        if not r.FPDFText_GetCharBox(tp,i,*map(C.byref,bounds)):continue
        l,rr,b,t=[v.value for v in bounds]
        o.setdefault('glyphs',[]).append({'text':chr(cp),'originX':x.value,'baseline':height-y.value,'x':l,'y':height-t,'w':max(0,rr-l),'h':max(0,t-b)})

    for o in byptr.values():
        count=o.pop('_hyphenCount',0)
        if count and o.get('text','').count('\x02')==count:
            o['text']=o['text'].replace('\x02','-')

def render(m):
    """Conservative incremental layout. Unsupported shaping returns to Story.
    Equal-width corrections keep all anchors. Other edits reflow only affected
    original lines, extending the affected range until it fits or using Story.
    """
    import base64, difflib, unicodedata, fitz
    from font_match import load_font
    from font_similarity import fallback
    original=m.get('originalLayout')
    if not original or m.get('layoutMode')=='reflow' or m.get('frames') or m.get('columns',1)!=1:return None
    fields=('size','align','lineHeight','charSpacing','wordSpacing','bold','italic','firstIndent','paragraphBefore','paragraphGap')
    if any(m.get(k)!=original.get('settings',{}).get(k) for k in fields):return None
    if any(abs(m['frame'][k]-original['frame'][k])>.01 for k in ('x','y')) or m['frame']['width']<original['frame']['width']-.01:return None
    text=m['text'];old=original['text'];gs=original['glyphs']
    if '\n' in text or '\n' in old:
        # Explicit extraction breaks are semantic boundaries. Equal-length
        # corrections may reuse the legacy exact anchors without deleting them.
        if len(text.split('\n'))!=len(old.split('\n')) or any(len(a)!=len(b) for a,b in zip(text.split('\n'),old.split('\n'))):return None
        from copy import deepcopy
        clean=deepcopy(m);clean['text']=text.replace('\n','');clean['originalLayout']['text']=old.replace('\n','')
        flat_to_full={};full_to_flat={};full=flat=0
        for ch in text:
            n=len(ch.encode('utf-16-le'))//2
            for j in range(n):full_to_flat[full+j]=flat+(j if ch!='\n' else 0)
            if ch!='\n':flat_to_full[flat]=full;flat+=n
            full+=n
        full_to_flat[full]=flat
        def stripped_offset(n):return full_to_flat[n]
        clean['originalLayout']['glyphs']=[{**g,'start':stripped_offset(g['start']),'end':stripped_offset(g['end'])} for g in gs if g['text']!='\n']
        clean['runs']=[{**r,'start':stripped_offset(r['start']),'end':stripped_offset(r['end'])} for r in m.get('runs',[]) if stripped_offset(r['end'])>stripped_offset(r['start'])]
        result=render(clean)
        if not result or result['layoutMode']!='原始字位':return None
        for g in result['glyphs']:
            n=g['end']-g['start'];g['start']=flat_to_full[g['start']];g['end']=g['start']+n
        result['glyphs']+= [{**g,'w':0} for g in gs if g['text']=='\n']
        result['glyphs'].sort(key=lambda g:g['start'])
        return result
    if not text or any(c in text for c in '\r\t'):return None
    if any(unicodedata.combining(c) or unicodedata.bidirectional(c) in ('R','AL','AN') or 0x900<=ord(c)<=0x109f for c in text):return None
    if len(gs)!=len(old) or any(g['text']!=c for g,c in zip(gs,old)):return None
    # New style runs must equal the inherited source style to retain positions.
    offsets=[];offset=0
    for ch in text:offsets.append(offset);offset+=len(ch.encode('utf-16-le'))//2
    fonts={};source_fonts={};details=[];tokens=[]
    matcher=difflib.SequenceMatcher(None,old,text,autojunk=False);mapping={}
    for a,b,n in matcher.get_matching_blocks():
        for j in range(n):mapping[b+j]=a+j
    for i,ch in enumerate(text):
        run=next((r for r in m.get('runs',[]) if r['start']<=offsets[i]<r['end']),m)
        source=gs[mapping[i]] if i in mapping else gs[min(i,len(gs)-1)]
        key=(run.get('latinFontKey') if ord(ch)<0x300 else run.get('cjkFontKey')) or run.get('fontKey') or m.get('fontKey')
        if key not in source_fonts:source_fonts[key]=load_font(key)
        font=source_fonts[key]
        if not font:return None
        if any(run.get(k,m.get(k))!=source['style'].get(k) for k in ('fontKey','size','color')):return None
        if any(bool(run.get(k,m.get(k)))!=bool(source['style'].get(k)) for k in ('bold','italic')):return None
        if source['style'].get('syntheticBold') or source['style'].get('syntheticItalic'):return None
        actual=font
        if ord(ch) not in font['coverage']:
            actual=fallback(key,ch)
            if not actual:return None
            details.append({'start':offsets[i],'end':offsets[i]+len(ch.encode('utf-16-le'))//2,'text':ch,'original':font['name'],'actual':actual['name'],'match':actual['match'],'confidence':actual['confidence']})
        path=actual['path']
        if path not in fonts:fonts[path]=fitz.Font(fontfile=path)
        size=source['style']['size'];scale=source['style'].get('horizontalScale',100)/100
        width=fonts[path].text_length(ch,fontsize=size)*scale
        advance=width+source['style'].get('charSpacing',0)+(source['style'].get('wordSpacing',0) if ch==' ' else 0)
        old_index=mapping.get(i)
        if old_index is not None and old_index+1<len(gs) and abs(gs[old_index+1]['baseline']-source['baseline'])<.5:
            original_advance=gs[old_index+1]['originX']-source['originX']
            if original_advance>=0:advance=original_advance
        tokens.append({'text':ch,'path':path,'size':size,'scale':scale,'color':source['style']['color'],'advance':advance,'width':width,'old':mapping.get(i),'synthetic':bool(source.get('synthetic') and ch==source['text'] and i in mapping),'start':offsets[i],'end':offsets[i]+len(ch.encode('utf-16-le'))//2})
    lines=[]
    for i,g in enumerate(gs):
        if not lines or abs(g['baseline']-gs[lines[-1][-1]]['baseline'])>.5:lines.append([])
        lines[-1].append(i)
    placement={};mode='原始字位'
    # With equal character counts keep anchors when replacements fit their slots.
    exact=len(tokens)==len(gs)
    if exact:
        for i,t in enumerate(tokens):
            g=gs[i];nextg=gs[i+1] if i+1<len(gs) and abs(gs[i+1]['baseline']-g['baseline'])<.5 else None
            slot=nextg['originX']-g['originX'] if nextg else m['frame']['x']+m['frame']['width']-g['originX']
            if t['text']!=g['text'] and t['width']>slot+.25:exact=False;break
        if exact:
            placement={i:(g['originX'],g['baseline']) for i,g in enumerate(gs)}
    if not exact:
        changes=[op for op in matcher.get_opcodes() if op[0]!='equal']
        if not changes:return None
        a=min(op[1] for op in changes);b=max(op[2] for op in changes)
        first=next((j for j,l in enumerate(lines) if l[-1]>=a),len(lines)-1)
        last=next((j for j,l in enumerate(lines) if l[-1]>=max(a,b-1)),len(lines)-1)
        delta=len(text)-len(old);begin=lines[first][0];fit=False
        # Keep untouched suffix lines verbatim if the changed line can absorb the edit.
        while last<len(lines):
            end=lines[last][-1]+1+delta;cursor=begin;trial={}
            for li in range(first,last+1):
                x=gs[lines[li][0]]['originX'];base=gs[lines[li][0]]['baseline'];right=m['frame']['x']+m['frame']['width']
                while cursor<end:
                    t=tokens[cursor]
                    if x+t['width']>right+.25:break
                    # Do not split ASCII words across lines; use Story if needed.
                    if cursor>begin and cursor+1<end and text[cursor].isascii() and text[cursor].isalnum() and text[cursor+1].isascii() and text[cursor+1].isalnum() and x+t['advance']+tokens[cursor+1]['width']>right+.25:return None
                    trial[cursor]=(x,base);x+=t['advance'];cursor+=1
            if cursor==end:
                placement.update(trial);fit=True;break
            last+=1
        if not fit:return None
        for i in range(begin):placement[i]=(gs[i]['originX'],gs[i]['baseline'])
        for i in range(end,len(tokens)):
            g=gs[i-delta];placement[i]=(g['originX'],g['baseline'])
        mode='局部行重排'
    doc=fitz.open();page=doc.new_page(width=m['pageWidth'],height=m['pageHeight']);names={};mapped=[]
    for i,t in enumerate(tokens):
        x,y=placement[i];font=fonts[t['path']]
        if t['path'] not in names:
            names[t['path']]='F'+str(len(names));page.insert_font(fontname=names[t['path']],fontfile=t['path'])
        color=tuple(int(t['color'][j:j+2],16)/255 for j in (1,3,5))
        if not t['synthetic']:
            page.insert_text((x,y),t['text'],fontsize=t['size'],fontname=names[t['path']],color=color,morph=(fitz.Point(x,y),fitz.Matrix(t['scale'],1)))
            from text_semantics import mark_text
            mark_text(page,t['text'])
        source=gs[t['old']] if t['old'] is not None else None
        if source and abs(x-source['originX'])<.001 and abs(y-source['baseline'])<.001:
            box={k:source[k] for k in ('x','y','w','h')}
        else:box={'x':x,'y':y-t['size']*.85,'w':t['width'],'h':t['size']}
        mapped.append({**box,'start':t['start'],'end':t['end'],'baseline':y,'line':round(y,3),'size':t['size']})
    from text_semantics import expand_preview
    original_box,preview_bounds=expand_preview(page)
    svg=page.get_svg_image(text_as_path=True);page.set_mediabox(original_box)
    doc.subset_fonts();blob=doc.tobytes(garbage=3,deflate=True);doc.close()
    f=m['frame'];overflow=any(g['x']+g['w']>f['x']+f['width']+.5 or g['y']+g['h']>f['y']+f['height']+.5 for g in mapped)
    return {'engine':'Folio anchored layout / MuPDF','layoutMode':mode,'engineVersion':fitz.VersionBind,'fragment':base64.b64encode(blob).decode(),'svg':svg,'previewBounds':preview_bounds,'glyphs':mapped,'positions':[], 'anchors':[], 'frames':[[f['x'],f['y'],f['x']+f['width'],f['y']+f['height']]],'frameOverset':overflow,'overflow':overflow and not m.get('allowOverflow'),'mappingComplete':True,'fallbackCount':len(details),'fallbackDetails':details,'spacingLimited':False}

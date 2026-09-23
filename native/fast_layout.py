"""Bounded fast-layout export: the canvas and PDF consume identical glyph anchors.
No files, CSS, HTML or font paths are accepted from the renderer.
"""
import base64,hashlib,json,math,re
from pathlib import Path
from functools import lru_cache

@lru_cache(maxsize=16)
def font_data(key):
    import fitz
    from font_match import load_font,CACHE
    if key in ('builtin-cjk','builtin-latin'):
        path=Path(__file__).parent/'fonts'/('NotoSansSC.ttf' if key=='builtin-cjk' else 'DejaVuSans.ttf')
        blob=path.read_bytes();actual=hashlib.sha256(blob).hexdigest()[:32]
        font=fitz.Font(fontbuffer=blob);coverage=font.valid_codepoints();name=font.name
        CACHE.mkdir(exist_ok=True,parents=True)
        if not (CACHE/(actual+'.ttf')).exists():(CACHE/(actual+'.ttf')).write_bytes(blob)
        if not (CACHE/(actual+'.json')).exists():(CACHE/(actual+'.json')).write_text(json.dumps({'name':name,'coverage':coverage}))
    else:
        f=load_font(key)
        if not f:raise ValueError('字体不可用')
        blob=Path(f['path']).read_bytes();actual=key;coverage=list(f['coverage']);name=f['name']
    from browser_fonts import opentype
    wrapped=opentype(blob)
    if wrapped!=blob:
        blob=wrapped;actual=hashlib.sha256(blob).hexdigest()[:32]
        (CACHE/(actual+'.ttf')).write_bytes(blob)
        (CACHE/(actual+'.json')).write_text(json.dumps({'name':name,'coverage':coverage}))
    system_key=None
    if key not in ('builtin-cjk','builtin-latin'):
        from font_resolver import resolve_name
        match=resolve_name(name)
        if match and match.get('fontResolution')=='system-name' and match['fontKey']!=actual:system_key=match['fontKey']
    font=fitz.Font(fontbuffer=blob)
    advances={str(cp):font.glyph_advance(cp) for cp in coverage}
    return {'advances':advances,'key':actual,'name':name,'base64':base64.b64encode(blob).decode(),'coverage':coverage,'systemKey':system_key,
            'fontBold':bool(font.flags.get('bold')),'fontItalic':bool(font.flags.get('italic'))}


def render(m):
    import fitz
    from font_match import load_font
    layout=m.get('fastLayout')
    if not isinstance(layout,dict) or layout.get('version')!=1 or layout.get('text')!=m['text']:raise ValueError('快速排版已过期，请重新预览')
    gs=layout.get('glyphs',[])
    if not isinstance(gs,list) or len(gs)>100000 or ''.join(g.get('text','') for g in gs)!=m['text']:raise ValueError('快速排版字符映射不完整')
    doc=fitz.open();page=doc.new_page(width=m['pageWidth'],height=m['pageHeight']);fonts={};names={};offset=0
    from ligatures import cluster
    painted=0
    for index,g in enumerate(gs):
        ch=g['text'];end=offset+len(ch.encode('utf-16-le'))//2
        if g.get('start')!=offset or g.get('end')!=end:raise ValueError('快速排版选区映射无效')
        offset=end
        if len(ch)!=1:raise ValueError('快速排版字符无效')
        for k in ('originX','baseline','x','y','w','h','size'):
            v=g.get(k)
            if isinstance(v,bool) or not isinstance(v,(float,int)) or not math.isfinite(v) or abs(v)>100000:raise ValueError('快速排版坐标无效')
        if not 4<=g['size']<=150 or g['w']<0 or g['h']<0:raise ValueError('快速排版尺寸无效')
        if ch in '\n\r\t':continue
        if ord(ch)<32:raise ValueError('不支持的控制字符')
        key=g.get('fontKey');font=fonts.get(key)
        if font is None:
            font=load_font(key)
            if not font:raise ValueError('快速排版字体不可用')
            fonts[key]=font;names[key]='F'+str(len(names));page.insert_font(fontname=names[key],fontfile=font['path'])
        if ord(ch) not in font['coverage']:raise ValueError('快速排版字体缺字：'+ch)
        color=g.get('color','#202020')
        if not re.fullmatch('#[0-9a-fA-F]{6}',color):raise ValueError('快速排版颜色无效')
        rgb=tuple(int(color[i:i+2],16)/255 for i in (1,3,5))
        angle=g.get('rotation',0)
        if angle not in (0,90,180,270):raise ValueError('文字旋转无效')
        bold=bool(g.get('bold')) and not g.get('fontBold');italic=bool(g.get('italic')) and not g.get('fontItalic')
        sx=g.get('scale',1)
        if not isinstance(sx,(float,int)) or not math.isfinite(sx) or not .05<=sx<=20:raise ValueError('文字比例无效')
        x,y=g['originX'],g['baseline']
        # insert_text rotation precedes the page-space morph: conjugate local
        # scale/shear into page coordinates so italic never tilts the baseline.
        radians=-math.radians(angle);c=math.cos(radians);s=math.sin(radians);k=.22 if italic else 0
        matrix=fitz.Matrix(sx*c*c-k*c*s+s*s,(sx-1)*c*s-k*s*s,(sx-1)*c*s+k*c*c,sx*s*s+k*c*s+c*c,0,0)
        stroke=g.get('strokeWidth',0) if bold else 0
        if not isinstance(stroke,(int,float)) or not math.isfinite(stroke) or not 0<=stroke<=20:raise ValueError('描边无效')
        stroke=stroke or g['size']*.025
        if index<painted:continue
        scalar,actual,count=cluster(gs,index,font['coverage']);painted=index+count
        page.insert_text((x,y),scalar,fontsize=g['size'],fontname=names[key],color=rgb,fill=rgb,render_mode=2 if bold else 0,
                         border_width=stroke/g['size'],rotate=(-angle)%360,morph=(fitz.Point(x,y),matrix))
        from text_semantics import mark_text
        mark_text(page,actual)
    from text_semantics import expand_preview
    original_box,preview_bounds=expand_preview(page)
    svg=page.get_svg_image(text_as_path=True);page.set_mediabox(original_box)
    doc.subset_fonts();blob=doc.tobytes(garbage=3,deflate=True);doc.close()
    f=m['frame'];overflow=any(g['x']<f['x']-.5 or g['y']<f['y']-.5 or g['x']+g['w']>f['x']+f['width']+.5 or g['y']+g['h']>f['y']+f['height']+.5 for g in gs if g['text'].strip())
    return {'engine':'Folio fast anchored layout','layoutMode':'快速排版','fragment':base64.b64encode(blob).decode(),'svg':svg,'glyphs':gs,
            'anchors':layout.get('anchors',[]),'frames':[[f['x'],f['y'],f['x']+f['width'],f['y']+f['height']]],'previewBounds':preview_bounds,'frameOverset':overflow,'overflow':overflow and not m.get('allowOverflow'),
            'mappingComplete':True,'fallbackCount':layout.get('fallbackCount',0),'fallbackDetails':layout.get('fallbackDetails',[]),'spacingLimited':False}

def styled_story(m,result):
    """Story places lines; explicitly preserve synthetic styles on CJK/Latin runs.
    MuPDF Story does not synthesize bold/italic for an embedded regular face.
    """
    import unicodedata
    if not any(r.get('bold') or r.get('italic') for r in [m]+m.get('runs',[])):return result
    if not result['mappingComplete'] or result['overflow']:return result
    if any(unicodedata.combining(c) or unicodedata.bidirectional(c) in ('R','AL','AN') or 0x900<=ord(c)<=0x109f for c in m['text']):
        synthetic=False
        for style in [m]+m.get('runs',[]):
            key=style.get('fontKey') or m.get('fontKey')
            face=font_data(key) if key else {'fontBold':False,'fontItalic':False}
            synthetic=synthetic or bool(style.get('bold') and not face['fontBold'] or style.get('italic') and not face['fontItalic'])
        if not synthetic:return result
        raise ValueError('复杂字形的合成粗斜体尚未通过验证，请选择真实粗斜体字体')
    from font_match import load_font
    from font_similarity import fallback
    from copy import deepcopy
    mapped={g['start']:g for g in result['glyphs']};gs=[];offset=0;ri=0;runs=m.get('runs',[]);last=None
    for ch in m['text']:
        while ri<len(runs) and runs[ri]['end']<=offset:ri+=1
        style={**m,**(runs[ri] if ri<len(runs) and runs[ri]['start']<=offset else {})}
        key=(style.get('latinFontKey') if ord(ch)<0x300 else style.get('cjkFontKey')) or style.get('fontKey')
        font=load_font(key)
        if not font or ord(ch) not in font['coverage']:
            actual=fallback(key,ch) if font and not ch.isspace() else None
            from story import builtin_name
            key=Path(actual['path']).stem if actual else font_data('builtin-latin' if builtin_name(ord(ch))=='DejaVuSans.ttf' else 'builtin-cjk')['key']
        g=mapped.get(offset)
        if g is None:
            if not ch.isspace():raise ValueError('精排字位不完整')
            g={**(last or {'x':m['frame']['x'],'y':m['frame']['y'],'h':m['size'],'baseline':m['frame']['y']+m['size']*.85}),'w':0}
        size=style.get('size',m['size']);face=font_data(key)
        g={**g,'text':ch,'start':offset,'end':offset+len(ch.encode('utf-16-le'))//2,'originX':g.get('originX',g['x']),'size':size,'fontKey':key,
           'color':style.get('color',m['color']),'bold':bool(style.get('bold')),'italic':bool(style.get('italic')),'fontBold':face['fontBold'],'fontItalic':face['fontItalic'],'strokeWidth':style.get('strokeWidth',0),'rotation':0,'scale':style.get('horizontalScale',100)/100}
        gs.append(g);offset=g['end'];last=g
    new={**m,'fastLayout':{'version':1,'text':m['text'],'glyphs':gs,'anchors':result.get('anchors',[])}}
    styled=render(new)
    return {**result,'fragment':styled['fragment'],'svg':styled['svg'],'glyphs':styled['glyphs']}


def anchored_style(m):
    """Paint visual-only edits at original anchors, including table cells.

    Font metrics, paragraph geometry and text must match. Changing weight,
    slant or color must not introduce Story's paragraph margins/line boxes.
    Translation from table row growth is applied to every original anchor.
    """
    import unicodedata
    original=m.get('originalLayout')
    if not original or m.get('layoutMode')=='reflow' or m.get('frames') or m.get('columns',1)!=1:return None
    if m.get('rotation') or str(m.get('writingMode','')).startswith('vertical'):return None
    if m['text']!=original['text'] or not m['text']:return None
    if any(unicodedata.combining(c) or unicodedata.bidirectional(c) in ('R','AL','AN') or 0x900<=ord(c)<=0x109f for c in m['text']):return None
    settings=original.get('settings',{})
    if any(m.get(k)!=settings.get(k) for k in ('size','align','lineHeight','charSpacing','wordSpacing','firstIndent','paragraphBefore','paragraphGap')):return None
    f=m['frame'];oldf=original['frame']
    if abs(f['width']-oldf['width'])>.01 or f['height']<oldf['height']-.01:return None
    dx=f['x']-oldf['x'];dy=f['y']-oldf['y'];runs=m.get('runs',[]);ri=0;glyphs=[];fonts={};coverage={};offset=0
    old=original.get('glyphs',[])
    if ''.join(g.get('text','') for g in old)!=m['text']:return None
    for g in old:
        ch=g['text'];end=offset+len(ch.encode('utf-16-le'))//2
        if g.get('start')!=offset or g.get('end')!=end:return None
        while ri<len(runs) and runs[ri]['end']<=offset:ri+=1
        style={**m,**(runs[ri] if ri<len(runs) and runs[ri]['start']<=offset else {})}
        inherited=g.get('style',{})
        if g.get('synthetic') and ch.isspace():
            style.update({k:inherited.get(k) for k in ('fontKey','size','charSpacing','wordSpacing','horizontalScale')})
        if any(style.get(k)!=inherited.get(k) for k in ('fontKey','size','charSpacing','wordSpacing','horizontalScale')):return None
        key=(style.get('latinFontKey') if ord(ch)<0x300 else style.get('cjkFontKey')) or style.get('fontKey')
        if key!=inherited.get('fontKey'):return None
        face=None
        if ch not in '\n\r\t':
            if key not in fonts:
                fonts[key]=font_data(key);coverage[key]=set(fonts[key]['coverage'])
            face=fonts[key]
            if ord(ch) not in coverage[key]:
                if not ch.isspace():return None
                face=font_data('builtin-latin')
            if (face['fontBold'] and not style.get('bold')) or (face['fontItalic'] and not style.get('italic')):return None
        glyphs.append({**g,'text':ch,'start':offset,'end':end,'x':g['x']+dx,'y':g['y']+dy,
                       'originX':g['originX']+dx,'baseline':g['baseline']+dy,'size':style['size'],
                       'fontKey':face['key'] if face else None,'color':style.get('color',m['color']),
                       'bold':bool(style.get('bold')),'italic':bool(style.get('italic')),
                       'fontBold':face['fontBold'] if face else False,'fontItalic':face['fontItalic'] if face else False,
                       'strokeWidth':style.get('strokeWidth',0),'scale':style.get('horizontalScale',100)/100,'rotation':0})
        offset=end
    new={**m,'fastLayout':{'version':1,'text':m['text'],'glyphs':glyphs,'anchors':[]}}
    result=render(new)
    # Source ink may already touch cell padding. Original, unchanged ink bounds
    # are authoritative; visual-only edits do not add lines or change advances.
    return {**result,'engine':'Folio anchored style layout','layoutMode':'原始字位','overflow':False,'spacingLimited':False}

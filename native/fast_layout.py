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
    system_key=None
    if key not in ('builtin-cjk','builtin-latin'):
        from font_resolver import resolve_name
        match=resolve_name(name)
        if match and match.get('fontResolution')=='system-name' and match['fontKey']!=actual:system_key=match['fontKey']
    font=fitz.Font(fontbuffer=blob)
    return {'key':actual,'name':name,'base64':base64.b64encode(blob).decode(),'coverage':coverage,'systemKey':system_key,
            'fontBold':bool(font.flags.get('bold')),'fontItalic':bool(font.flags.get('italic'))}


def render(m):
    import fitz
    from font_match import load_font
    layout=m.get('fastLayout')
    if not isinstance(layout,dict) or layout.get('version')!=1 or layout.get('text')!=m['text']:raise ValueError('快速排版已过期，请重新预览')
    gs=layout.get('glyphs',[])
    if not isinstance(gs,list) or len(gs)>100000 or ''.join(g.get('text','') for g in gs)!=m['text']:raise ValueError('快速排版字符映射不完整')
    doc=fitz.open();page=doc.new_page(width=m['pageWidth'],height=m['pageHeight']);fonts={};names={};offset=0
    for g in gs:
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
        page.insert_text((x,y),ch,fontsize=g['size'],fontname=names[key],color=rgb,fill=rgb,render_mode=2 if bold else 0,
                         border_width=stroke,rotate=(-angle)%360,morph=(fitz.Point(x,y),matrix))
    svg=page.get_svg_image(text_as_path=True);doc.subset_fonts();blob=doc.tobytes(garbage=3,deflate=True);doc.close()
    f=m['frame'];overflow=any(g['x']<f['x']-.5 or g['y']<f['y']-.5 or g['x']+g['w']>f['x']+f['width']+.5 or g['y']+g['h']>f['y']+f['height']+.5 for g in gs if g['text'].strip())
    return {'engine':'Folio fast anchored layout','layoutMode':'快速排版','fragment':base64.b64encode(blob).decode(),'svg':svg,'glyphs':gs,
            'anchors':layout.get('anchors',[]),'frames':[[f['x'],f['y'],f['x']+f['width'],f['y']+f['height']]],'overflow':overflow and not m.get('allowOverflow'),
            'mappingComplete':True,'fallbackCount':layout.get('fallbackCount',0),'fallbackDetails':layout.get('fallbackDetails',[]),'spacingLimited':False}

def styled_story(m,result):
    """Story places lines; explicitly preserve synthetic styles on CJK/Latin runs.
    MuPDF Story does not synthesize bold/italic for an embedded regular face.
    """
    import unicodedata
    if not any(r.get('bold') or r.get('italic') for r in [m]+m.get('runs',[])):return result
    if not result['mappingComplete'] or result['overflow']:return result
    if any(unicodedata.combining(c) or unicodedata.bidirectional(c) in ('R','AL','AN') or 0x900<=ord(c)<=0x109f for c in m['text']):
        raise ValueError('复杂字形的粗斜体精排尚未通过验证，请保留当前结果')
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
            key=Path(actual['path']).stem if actual else font_data('builtin-latin' if ord(ch)<0x300 else 'builtin-cjk')['key']
        g=mapped.get(offset)
        if g is None:
            if not ch.isspace():raise ValueError('精排字位不完整')
            g={**(last or {'x':m['frame']['x'],'y':m['frame']['y'],'h':m['size'],'baseline':m['frame']['y']+m['size']*.85}),'w':0}
        size=style.get('size',m['size'])
        g={**g,'text':ch,'start':offset,'end':offset+len(ch.encode('utf-16-le'))//2,'originX':g.get('originX',g['x']),'size':size,'fontKey':key,
           'color':style.get('color',m['color']),'bold':bool(style.get('bold')),'italic':bool(style.get('italic')),'fontBold':bool(style.get('fontBold')),'fontItalic':bool(style.get('fontItalic')),'strokeWidth':style.get('strokeWidth',0),'rotation':0,'scale':style.get('horizontalScale',100)/100}
        gs.append(g);offset=g['end'];last=g
    new={**m,'fastLayout':{'version':1,'text':m['text'],'glyphs':gs,'anchors':result.get('anchors',[])}}
    styled=render(new)
    return {**result,'fragment':styled['fragment'],'svg':styled['svg'],'glyphs':styled['glyphs']}

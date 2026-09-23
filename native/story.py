"""MuPDF Story is the sole layout authority for the on-page editor.

All coordinates are PDF points from the top left. The exact same page supplies
the vector preview, caret geometry and the PDF fragment that is committed.
No HTML, URLs or CSS supplied by the renderer are executed.
"""
import base64
import io
import math
import re
import time
import unicodedata
from html import escape
from pathlib import Path
from functools import lru_cache

ROOT = Path(__file__).resolve().parent


def number(value, lo, hi):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError('排版参数超出有效范围')
    return value


def validate(m):
    if not isinstance(m, dict) or not isinstance(m.get('text'), str) or len(m['text']) > 100000:
        raise ValueError('单个文本流限 100,000 字符')
    soft=m.get('softBreaks',[])
    if not isinstance(soft,list) or len(soft)>len(m['text']):raise ValueError('软换行位置无效')
    breaks=set();offset=0
    for ch in m['text']:
        if ch=='\n':breaks.add(offset)
        offset+=len(ch.encode('utf-16-le'))//2
    if any(type(n) is not int or n not in breaks for n in soft):raise ValueError('软换行位置无效')
    w, h = number(m.get('pageWidth'), 36, 14400), number(m.get('pageHeight'), 36, 14400)
    f = m['frame']
    number(f['x'], -14400, 14400); number(f['y'], -14400, 14400)
    number(f['width'], 1, 14400); number(f['height'], 1, 14400)
    number(m['size'], 4, 150); number(m['lineHeight'], 1, 3)
    number(m.get('paragraphGap', 0), 0, 100)
    n = number(m.get('columns', 1), 1, 3)
    if int(n) != n: raise ValueError('栏数须为整数')
    gap = number(m.get('gap', 18), 0, 200)
    if (f['width'] - (n-1)*gap)/n <= 0: raise ValueError('栏间距占满了文本框')
    if m.get('align') not in ('left', 'right', 'center', 'justify'): raise ValueError('对齐方式无效')
    if not re.fullmatch('#[0-9a-fA-F]{6}', m.get('color', '')): raise ValueError('文字颜色无效')
    frames=m.get('frames')
    if frames is not None:
        if not isinstance(frames,list) or not 1<=len(frames)<=32:raise ValueError('文本链限同页 1–32 个框')
        for frame in frames:
            for k in ('x','y'):number(frame[k],-14400,14400)
            for k in ('width','height'):number(frame[k],10,14400)
    return m


@lru_cache(maxsize=1)
def resources():
    import fitz
    # Reuse the font archive inside the persistent process.
    return fitz.Archive(str(ROOT/'fonts'))


@lru_cache(maxsize=2)
def fallback_coverage(path):
    import fitz
    return set(fitz.Font(fontfile=path).valid_codepoints())

def builtin_name(cp):
    # Coverage, not a Latin/CJK threshold, decides Greek, combining marks,
    # mathematical symbols and supplementary emoji.
    for name in ('DejaVuSans.ttf','NotoSansSC.ttf'):
        if cp in fallback_coverage(str(ROOT/'fonts'/name)):return name
    return 'NotoSansSC.ttf'

def styled_html(m):
    import fitz
    from font_match import load_font, spaced_font
    archive=fitz.Archive(str(ROOT/'fonts'));text=m['text'];runs=m.get('runs',[])
    if not isinstance(runs,list) or len(runs)>100000:raise ValueError('字体样式数量无效')
    runs=sorted(runs,key=lambda r:r.get('start',0))
    defaults={k:m.get(k) for k in ('fontKey','fontName','fontResolution','fontOriginalName','size','color','charSpacing','wordSpacing','bold','italic','latinFontKey','cjkFontKey','latinFontName','cjkFontName')}
    definitions={};fonts={};css=[];fallback=0;fallback_details=[];spacing_limited=False;ri=0;offset=0;paragraphs=[];parts=[];segment='';last=None
    soft=set(m.get('softBreaks') or [])
    def flush():
        nonlocal segment
        if segment:parts.append('<span class="%s">%s</span>'%(last,escape(segment)));segment=''
    for ci,ch in enumerate(text):
        while ri<len(runs) and runs[ri].get('end',0)<=offset:ri+=1
        style={**defaults,**(runs[ri] if ri<len(runs) and runs[ri].get('start',0)<=offset<runs[ri].get('end',0) else {})}
        offset+=len(ch.encode('utf-16-le'))//2
        if ch=='\n':
            if offset-1 in soft:
                # Extraction line boundaries are not paragraph boundaries.
                # A real newline typed by the user has no softBreaks entry.
                before=text[ci-1] if ci else '';after=text[ci+1] if ci+1<len(text) else ''
                if before and after and before.isascii() and before.isalnum() and after.isascii() and after.isalnum():segment+=' '
                continue
            flush();paragraphs.append(''.join(parts) or '<br/>');parts=[];last=None;continue
        key=(style.get('latinFontKey') if ord(ch)<0x300 else style.get('cjkFontKey')) or style.get('fontKey')
        if key not in fonts:fonts[key]=load_font(key)
        font=fonts[key]
        if not font and style.get('fontResolution') == 'unresolved' and not ch.isspace():
            raise ValueError('原字体 '+str(style.get('fontOriginalName') or style.get('fontName') or '')+' 未解析，草稿已保留；请明确选择此范围的替代字体后应用')
        covered=font and ord(ch) in font['coverage']
        size=number(style.get('size') or m['size'],4,150)
        spacing=number(style.get('charSpacing') or 0,-5,30);word=number(style.get('wordSpacing') or 0,-5,50)
        color=style.get('color') or m['color']
        if not re.fullmatch('#[0-9a-fA-F]{6}',color):raise ValueError('文字颜色无效')
        if not covered and font and not ch.isspace():
            from font_similarity import fallback as match_fallback
            replacement=match_fallback(key,ch)
            if replacement:
                fallback+=1
                if len(fallback_details)<300:fallback_details.append({'start':offset-len(ch.encode('utf-16-le'))//2,'end':offset,'text':ch,'original':font['name'],'actual':replacement['name'],'match':replacement['match'],'confidence':replacement['confidence']})
                font=replacement;covered=True
        if not covered:
            if (key or style.get('fontName') not in (None,'内置替代字体')) and not ch.isspace():
                fallback+=1
                if len(fallback_details)<300:fallback_details.append({'start':offset-len(ch.encode('utf-16-le'))//2,'end':offset,'text':ch,'original':(font or {}).get('name',style.get('fontName') or '不可用字体'),'actual':builtin_name(ord(ch)).removesuffix('.ttf')})
            path=str(ROOT/'fonts'/builtin_name(ord(ch)))
            if not ch.isspace() and ord(ch) not in fallback_coverage(path):raise ValueError('所选字体和内置替代字体均未覆盖字符：'+ch)
        else:path=font['path']
        spec=(path,round(spacing,4),round(word,4),size,color,bool(style.get('bold')),bool(style.get('italic')))
        if spec not in definitions:
            name='s'+str(len(definitions));definitions[spec]=name
            data=spaced_font(path,spec[1],spec[2],size)
            if (abs(spec[1])+abs(spec[2])>.0001) and data[:4] not in (b'\0\1\0\0',b'OTTO'):spacing_limited=True
            filename=name+'.ttf';archive.add((data,filename))
            css.append('@font-face{font-family:%s;src:url(%s)}.%s{font-family:%s;font-size:%spt;color:%s;font-weight:%s;font-style:%s}'%(name,filename,name,name,size,color,'bold' if spec[5] else 'normal','italic' if spec[6] else 'normal'))
        name=definitions[spec]
        if name!=last:flush();last=name
        segment+=ch
    flush();paragraphs.append(''.join(parts) or '<br/>')
    return ''.join('<p id="p%d">%s</p>'%(i,p) for i,p in enumerate(paragraphs)),''.join(css),archive,fallback,spacing_limited,fallback_details


def layout(model):
    import fitz
    started = time.perf_counter()
    m = validate(model)
    text = m['text']
    if m.get('fastLayout') and m.get('layoutMode')!='reflow':
        from fast_layout import render
        return render(m)
    if m.get('rotation') or str(m.get('writingMode','')).startswith('vertical'):
        raise ValueError('当前方向请使用快速排版，精排不会更改阅读方向')
    if m.get('directionSupported') is False:
        raise ValueError('此阅读方向或倾斜角度尚不支持可靠编辑，原文已保留')
    from fast_layout import anchored_style
    styled = anchored_style(m)
    if styled:return styled
    from original_layout import render as anchored_layout
    anchored=anchored_layout(m)
    if anchored:return anchored
    # Keep unsupported control characters out of both the PDF and hit-test map.
    if any(ord(c) < 32 and c not in '\n\r\t' for c in text):
        raise ValueError('文字包含不可排版的控制字符')
    f = m['frame']; size = m['size']
    css = '''@font-face{font-family:Folio;src:url(NotoSansSC.ttf)}
    @font-face{font-family:FolioFallback;src:url(DejaVuSans.ttf)}
    .latin{font-family:FolioFallback}body{margin:0;padding:0;font-family:Folio,FolioFallback;font-size:%spt;
    line-height:%s;color:%s;font-weight:%s;font-style:%s;text-align:%s}
    p{margin:%spt 0 %spt;padding:0;white-space:pre-wrap;orphans:1;widows:1}p#p0{text-indent:%spt}''' % (
        size, m['lineHeight'], m['color'], 'bold' if m.get('bold') else 'normal',
        'italic' if m.get('italic') else 'normal', 'left' if m['align']=='justify' else m['align'], number(m.get('paragraphBefore',0),0,100), m.get('paragraphGap', 0), number(m.get('firstIndent',0),0,f['width']))
    html,style_css,archive,fallback_count,spacing_limited,fallback_details=styled_html(m)
    story = fitz.Story(html, user_css=css+style_css, archive=archive)
    buf = io.BytesIO(); writer = fitz.DocumentWriter(buf)
    dev = writer.begin_page(fitz.Rect(0, 0, m['pageWidth'], m['pageHeight']))
    columns = int(m.get('columns', 1)); gap = m.get('gap', 18)
    cw = (f['width']-(columns-1)*gap)/columns
    more = 0; positions = []; frames = []
    chain=m.get('frames') or [dict(x=f['x']+col*(cw+gap),y=f['y'],width=cw,height=f['height']) for col in range(columns)]
    for col,frame in enumerate(chain):
        rect = fitz.Rect(frame['x'], frame['y'], frame['x']+frame['width'], frame['y']+(14400 if m.get('allowOverflow') and col==len(chain)-1 else frame['height']))
        more, filled = story.place(rect)
        # MuPDF can report completion at an exact line-box boundary while the
        # final line lies outside the clip. Re-place before draw with a tiny
        # epsilon, which also makes continuation into the next frame reliable.
        for retry in range(4):
            if filled[3] <= rect.y1 + .001: break
            rect.y1 -= .02
            more, filled = story.place(rect)
        if filled[3] > rect.y1 + .001: more = 1
        story.element_positions(lambda p: positions.append({'id': p.id, 'rect': list(p.rect), 'open': p.open_close}))
        story.draw(dev); frames.append(list(rect))
        if not more: break
    writer.end_page(); writer.close()
    from generated_cmaps import repair
    blob=repair(buf.getvalue())
    if m['align']=='justify' and text:
        from justify import justify_fragment
        with fitz.open(stream=blob,filetype='pdf') as raw:
            gs,complete=map_glyphs(raw[0],text)
        if not complete and not more:raise ValueError('字位映射不完整，暂不能应用两端对齐')
        blob=justify_fragment(blob,m,frames,gs)
    with fitz.open(stream=blob, filetype='pdf') as doc:
        page = doc[0]
        from text_semantics import expand_preview
        original_box,preview_bounds=expand_preview(page)
        glyphs, map_ok = map_glyphs(page, text)
        for g in glyphs:
            for key in ('x','originX'):g[key]+=preview_bounds['x']
            for key in ('y','baseline'):g[key]+=preview_bounds['y']
        # Also catch long unbreakable tokens, whose horizontal overflow does not
        # necessarily set Story's continuation flag.
        outside = any(not any(g['x'] >= r[0]-.5 and g['x']+g['w'] <= r[2]+.5 and
                              g['y']+g['h'] <= r[3]+size*.4 for r in frames) for g in glyphs)
        overflow = bool(more or (outside and not m.get('allowOverflow')))
        frame_overset=any(g['x']<f['x']-.5 or g['x']+g['w']>f['x']+f['width']+.5 or g['y']+g['h']>f['y']+f['height']+.5 for g in glyphs)
        svg = page.get_svg_image(text_as_path=True)
        page.set_mediabox(original_box)
        if map_ok:
            from text_semantics import mark_text
            mark_text(page,text)
        doc.subset_fonts()
        blob = repair(doc.tobytes(garbage=3, deflate=True))
    result = {'engine': 'MuPDF Story', 'layoutMode':'段落重排', 'engineVersion': fitz.VersionBind, 'fallbackCount':fallback_count, 'fallbackDetails':fallback_details, 'spacingLimited':spacing_limited,
            'fragment': base64.b64encode(blob).decode(), 'svg': svg,
            'glyphs': glyphs, 'positions': positions, 'frames': frames,'previewBounds':preview_bounds,'frameOverset':frame_overset,
            'anchors': blank_anchors(text, positions, m),
            'overflow': overflow, 'mappingComplete': map_ok,
            'elapsedMs': round((time.perf_counter()-started)*1000, 2)}
    from fast_layout import styled_story
    return styled_story(m,result)


def map_glyphs(page, text):
    """Map shaped glyphs to UTF-16 offsets used by the browser's input control.

    PDF extraction may omit wrap spaces / soft hyphens and expand ligatures.
    Never guess over a non-whitespace source character. An uncertain mapping
    prevents editing / committing rather than placing a misleading caret.
    """
    import fitz
    offsets = [0]
    for c in text: offsets.append(offsets[-1]+len(c.encode('utf-16-le'))//2)
    cursor = 0; out = []; ok = True; line_id = 0
    for block in page.get_text('rawdict',clip=fitz.INFINITE_RECT())['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                for c in span['chars']:
                    ch = c['c']; normalized = unicodedata.normalize('NFKC', ch)
                    if cursor < len(text) and ch != text[cursor]:
                        while cursor < len(text) and text[cursor] in ' \t\n\r\u200b\ufeff\u00ad' and text[cursor] != ch:
                            cursor += 1
                    count = 1
                    if cursor >= len(text):
                        if not ch.isspace(): ok = False
                        continue
                    if ch != text[cursor]:
                        decomposed=unicodedata.normalize('NFD',ch)
                        if normalized and text.startswith(normalized, cursor): count = len(normalized)
                        elif decomposed and text.startswith(decomposed,cursor):count=len(decomposed)
                        elif unicodedata.normalize('NFKC',text[cursor])==normalized:count=1
                        elif ch.isspace(): continue
                        else: ok = False; continue
                    x0, y0, x1, y1 = c['bbox']
                    out.append({'start': offsets[cursor], 'end': offsets[cursor+count],
                                'x': x0, 'y': y0, 'w': max(0, x1-x0), 'h': y1-y0,
                                'line': line_id, 'originX':c['origin'][0], 'baseline':c['origin'][1], 'size':span['size']})
                    cursor += count
            line_id += 1
    if text[cursor:].strip(' \t\r\n\u200b\ufeff\u00ad'): ok = False
    if ok:return out, True
    # Structured extraction drops zero-width marks in a separate font span.
    # The generated display list retains them. Retry its exact paint order;
    # never skip unmatched source letters or infer positions from neighbours.
    cursor=0;out=[];line_id=0;baseline=None;faces={}
    def same_glyph(span,cp,gid):
        name=span['font']
        if name not in faces:
            matches=[]
            for entry in page.get_fonts(full=True):
                try:
                    from fontTools.ttLib import TTFont
                    data=page.parent.extract_font(entry[0])[3]
                    meta=TTFont(io.BytesIO(data))
                    names=[entry[3],meta['name'].getDebugName(6)]
                    if 'CFF ' in meta:names+=meta['CFF '].cff.fontNames
                    names=[v.split('+')[-1] for v in names if v]
                    # MuPDF's display-list font name is bounded to 31 bytes.
                    if not any(name.split('+')[-1] in (v,v[:31]) for v in names):continue
                    matches.append(fitz.Font(fontbuffer=data))
                except Exception:continue
            faces[name]=matches[0] if len(matches)==1 else None
        font=faces[name]
        return font is not None and gid>0 and font.has_glyph(cp)==gid
    for span in page.get_texttrace():
        for cp,gid,origin,bbox in span['chars']:
            ch=chr(cp)
            while cursor<len(text) and text[cursor] in ' \t\n\r\u200b\ufeff\u00ad' and text[cursor]!=ch:cursor+=1
            if cursor>=len(text):
                if ch.isspace():continue
                return out,False
            count=1
            if ch!=text[cursor]:
                normalized=unicodedata.normalize('NFKC',ch);decomposed=unicodedata.normalize('NFD',ch)
                if normalized and text.startswith(normalized,cursor):count=len(normalized)
                elif decomposed and text.startswith(decomposed,cursor):count=len(decomposed)
                elif unicodedata.normalize('NFKC',text[cursor])==normalized:pass
                elif ch.isspace():continue
                elif not same_glyph(span,ord(text[cursor]),gid):return out,False
            x0,y0,x1,y1=bbox
            if baseline is not None and abs(origin[1]-baseline)>span['size']*.5:line_id+=1
            baseline=origin[1]
            out.append({'start':offsets[cursor],'end':offsets[cursor+count],'x':x0,'y':y0,'w':max(0,x1-x0),'h':y1-y0,'line':line_id,'originX':origin[0],'baseline':origin[1],'size':span['size']})
            cursor+=count
    return out,not text[cursor:].strip(' \t\r\n\u200b\ufeff\u00ad')


def analyze(data, page_number):
    import fitz
    import numpy as np
    import onnxruntime as ort
    ort.disable_telemetry_events()
    from rapid_layout import RapidLayout
    from rapid_layout.utils.typings import RapidLayoutInput, ModelType
    path = ROOT/'models/layout_cdla.onnx'
    if not path.exists(): raise ValueError('本地版面模型缺失，请重新解压完整运行包')
    global _AI
    if '_AI' not in globals():
        _AI = RapidLayout(RapidLayoutInput(model_type=ModelType.PP_LAYOUT_CDLA,
                          model_dir_or_path=str(path), engine_cfg={'intra_op_num_threads': 2}, conf_thresh=.5))
    with fitz.open(stream=data, filetype='pdf') as doc:
        p = doc[page_number-1];p.set_rotation(0); scale = min(1.5, 1600/max(p.rect.width, p.rect.height))
        pix = p.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        # RapidLayout's ndarray contract is BGR (its loader converts to RGB).
        image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)[:, :, ::-1].copy()
        result = _AI(image)
        sx, sy = p.rect.width/pix.width, p.rect.height/pix.height
    return {'engine': 'Paddle PP-Structure PicoDet CDLA / ONNX CPU',
            'elapsedMs': round(result.elapse*1000, 1),
            'regions': [{'kind': name, 'score': float(score),
                         'bounds': [box[0]*sx, box[1]*sy, box[2]*sx, box[3]*sy]}
                        for box, name, score in zip(result.boxes, result.class_names, result.scores)]}


def blank_anchors(text, positions, model):
    anchors = {}; offset = 0; paragraph = 0; content = False
    soft = set(model.get('softBreaks') or [])
    for ch in text + '\n':
        if ch == '\n' and offset not in soft:
            if not content:
                p = next((p for p in positions if p['id'] == 'p'+str(paragraph) and p['open'] & 1), None)
                if p:
                    r = p['rect']; anchors[str(offset)] = {'x': r[0], 'y': r[1], 'h': model['size']*model['lineHeight'], 'line': -1}
            paragraph += 1; content = False
        elif ch != '\n':content = True
        offset += len(ch.encode('utf-16-le'))//2
    return anchors

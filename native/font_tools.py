"""Bounded font engineering API using opaque catalog/cache IDs, never caller paths."""
import base64, hashlib, io, math
from pathlib import Path


def font_bytes(key):
    from font_match import load_font
    if key in ('builtin-cjk', 'builtin-latin'):
        return (Path(__file__).parent/'fonts'/('NotoSansSC.ttf' if key == 'builtin-cjk' else 'DejaVuSans.ttf')).read_bytes()
    item = load_font(key)
    if not item: raise ValueError('字体不可用，请先选择字体或检查页面字体')
    return Path(item['path']).read_bytes()


def publish(blob):
    import fitz
    from font_cache import publish_font
    from font_match import CACHE
    f = fitz.Font(fontbuffer=blob); key = hashlib.sha256(blob).hexdigest()[:32]
    publish_font(CACHE, key, blob, {'name':f.name, 'coverage':f.valid_codepoints()})
    return {'fontKey':key, 'name':f.name, 'size':len(blob)}


def process(args):
    action = args.get('action'); o = args.get('options') or {}
    if action == 'catalog':
        from system_fonts import list_fonts
        q = str(o.get('query','')).casefold(); fonts = [f for f in list_fonts()['fonts'] if q in ' '.join([f['name'], f['family'], *f['aliases']]).casefold()]
        offset = o.get('offset',0); limit = o.get('limit',50)
        if type(offset)!=int or offset<0 or type(limit)!=int or not 1<=limit<=200: raise ValueError('字体目录分页无效')
        return {'fonts':fonts[offset:offset+limit], 'total':len(fonts), 'offset':offset, 'hasMore':offset+limit<len(fonts)}
    if action == 'select':
        from system_fonts import select_font
        return select_font(o.get('fontId'))
    if action == 'resolve':
        from font_resolver import resolve_name
        return {'match':resolve_name(str(o.get('name',''))[:256])}
    if action == 'recommend':
        from font_similarity import recommend
        return {'fonts':recommend(o.get('fontKey'),str(o.get('missing',''))[:10000],str(o.get('text',''))[:500])}
    from fontTools.ttLib import TTFont
    blob = font_bytes(o.get('fontKey')); f = TTFont(io.BytesIO(blob)); cmap = f.getBestCmap() or {}
    text = o.get('text','Aa 文字 123')
    if not isinstance(text,str) or len(text)>10000: raise ValueError('字体样本最多 10000 字符')
    codes = list(dict.fromkeys(map(ord,text))); missing = [chr(cp) for cp in codes if cp not in cmap and not chr(cp).isspace()]
    if action == 'coverage': return {'missing':missing,'covered':len(codes)-len(missing),'uniqueCharacters':len(codes),'complete':not missing}
    if action == 'inspect':
        from system_fonts import names
        family, style, name, ps = names(f)
        return {'fontKey':publish(blob)['fontKey'],'family':family,'style':style,'name':name,'postScriptName':ps,'glyphs':len(f.getGlyphOrder()),'unicodeCharacters':len(cmap),
                'unitsPerEm':f['head'].unitsPerEm,'embeddingFlags':getattr(f.get('OS/2'),'fsType',0),
                'tables':[{'tag':tag,'size':entry.length,'checksum':entry.checkSum} for tag,entry in f.reader.tables.items()],
                'axes':[{'tag':a.axisTag,'min':a.minValue,'default':a.defaultValue,'max':a.maxValue} for a in f['fvar'].axes] if 'fvar' in f else [],
                'features':{t:[r.FeatureTag for r in f[t].table.FeatureList.FeatureRecord] if f[t].table.FeatureList else [] for t in ('GSUB','GPOS') if t in f}}
    if action == 'metrics':
        size = o.get('size',12)
        if type(size) not in (int,float) or not math.isfinite(size) or not 1<=size<=1000: raise ValueError('字号范围 1–1000 pt')
        from fontTools.pens.boundsPen import BoundsPen
        gs=f.getGlyphSet(); units=f['head'].unitsPerEm; glyphs=[]
        if len(codes)>500: raise ValueError('单次度量最多 500 个不同字符')
        for cp in codes:
            name=cmap.get(cp); pen=BoundsPen(gs)
            if name: gs[name].draw(pen)
            glyphs.append({'character':chr(cp),'codepoint':cp,'glyph':name,'glyphId':f.getGlyphID(name) if name else 0,
                           'advance':f['hmtx'][name][0]*size/units if name else None,'bounds':[v*size/units for v in pen.bounds] if pen.bounds else None})
        return {'size':size,'units':'pt','ascender':f['hhea'].ascent*size/units,'descender':f['hhea'].descent*size/units,'glyphs':glyphs,'missing':missing,'note':'Unshaped glyph metrics; complex scripts require the existing layout engine.'}
    if action == 'outlines':
        if len(codes)>64: raise ValueError('单次轮廓最多 64 个不同字符')
        from fontTools.pens.svgPathPen import SVGPathPen
        gs=f.getGlyphSet(); glyphs=[]
        for cp in codes:
            name=cmap.get(cp); pen=SVGPathPen(gs)
            if name: gs[name].draw(pen)
            glyphs.append({'character':chr(cp),'glyph':name,'path':pen.getCommands()})
        return {'unitsPerEm':f['head'].unitsPerEm,'yAxis':'up','glyphs':glyphs}
    if action == 'preview':
        import fitz
        size=o.get('size',24)
        if type(size) not in (int,float) or not math.isfinite(size) or not 8<=size<=96: raise ValueError('预览字号范围 8–96 pt')
        height=max(160,min(480,int(size*5.5)))
        doc=fitz.open();page=doc.new_page(width=800,height=height)
        page.insert_font(fontname='Preview',fontbuffer=blob)
        page.insert_textbox(fitz.Rect(16,16,784,height-16),text[:400],fontname='Preview',fontsize=size)
        image=page.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).tobytes('png');doc.close()
        return {'image':base64.b64encode(image).decode(),'mimeType':'image/png','missing':missing}
    if action in ('subset','instance','repair-cmap'):
        flags=getattr(f.get('OS/2'),'fsType',0)
        if flags & 2: raise ValueError('字体标记为受限嵌入，不能生成修改副本')
        if action == 'subset':
            if flags & 0x100: raise ValueError('字体声明禁止子集化')
            if missing: raise ValueError('字体缺少所需字符：'+''.join(missing[:30]))
            from fontTools import subset
            opts=subset.Options(); opts.layout_features=['*']; opts.name_IDs=['*']; opts.notdef_outline=True
            sub=subset.Subsetter(options=opts); sub.populate(text=text); sub.subset(f)
        elif action == 'instance':
            from fontTools.varLib.instancer import instantiateVariableFont
            axes=o.get('axes',{}); available={a.axisTag:a for a in f['fvar'].axes} if 'fvar' in f else {}
            if not isinstance(axes,dict) or not axes or set(axes)-set(available): raise ValueError('可变字体轴无效')
            for tag,v in axes.items():
                if type(v) not in (int,float) or not math.isfinite(v) or not available[tag].minValue<=v<=available[tag].maxValue: raise ValueError('轴值超出范围：'+tag)
            f=instantiateVariableFont(f,axes,inplace=False)
        else:
            mapping=o.get('mapping',{})
            if not isinstance(mapping,dict) or not 1<=len(mapping)<=10000: raise ValueError('映射应为 Unicode 十进制码点到 glyph ID')
            checked={}
            for cp,gid in mapping.items():
                cp=int(cp)
                if not 0<=cp<=0x10ffff or 0xd800<=cp<=0xdfff or type(gid)!=int or not 0<gid<len(f.getGlyphOrder()): raise ValueError('Unicode 或 glyph ID 无效')
                checked[cp]=gid
            from font_match import unicode_cmap
            repaired,coverage=unicode_cmap(blob,checked)
            if not repaired: raise ValueError('此字体无法修复 Unicode 映射')
            return publish(repaired)
        out=io.BytesIO(); f.save(out); return publish(out.getvalue())
    if action == 'export': return {'bytes':base64.b64encode(blob).decode(),'extension':'otf' if blob[:4]==b'OTTO' else 'ttf','size':len(blob)}
    raise ValueError('未知字体操作')

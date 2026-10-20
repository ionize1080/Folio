"""Protect independently painted pronunciation labels on paragraph reflow."""
import base64, math, re

LATIN = re.compile(r'^[A-Za-z\u00c0-\u024f\u0300-\u036f\u02c7\u02c9-\u02cb\s]+$')


def anchors(objects, indices, height):
    # These geometric limits match src/ruby-anchors.mjs.
    bases = [{**g,'em':(o.get('size',0)*math.hypot(*o.get('matrix',[1,0,0,1])[2:4])) or max(g['w'],g['h'])}
             for o in objects if o['index'] in indices for g in o.get('glyphs', [])
             if any(0x3400 <= ord(c) <= 0x9fff or 0x20000 <= ord(c) <= 0x3134f for c in g.get('text', ''))
             and g['w'] >= 2]
    bases = [g for g in bases if g['em'] >= 7]
    result = []
    for o in objects:
        text = o.get('text', '').strip()
        if o['type'] != 'text' or o['index'] in indices or not text or len(text) > 12 or not LATIN.fullmatch(text):
            continue
        x0, bottom, x1, top = o['bounds']
        y0, y1 = height-top, height-bottom
        width, h, center = x1-x0, y1-y0, (x0+x1)/2
        if h < 2.5 or width <= 0:
            continue
        matches = [g for g in bases if h <= g['em']*.85 and width <= g['em']*2.5
                   and g['y']-g['em']*.8 <= y1 <= g['y']+.5
                   and abs(center-g['x']-g['w']/2) <= g['em']*.6]
        if matches:
            result.append(min(matches, key=lambda g: abs(center-g['x']-g['w']/2)))
    return result


def validate(page, objects, indices, flow):
    required = anchors(objects, indices, float(page.mediabox.height))
    if not required:
        return
    model = flow.get('model') or {}
    painted = []
    if model.get('text'):
        raw = base64.b64decode(flow.get('fragment', ''), validate=True)
        if len(raw) > 32*1024*1024:
            raise ValueError('排版片段过大')
        import fitz
        with fitz.open(stream=raw, filetype='pdf') as document:
            if len(document) != 1:
                raise ValueError('排版片段须为单页')
            left = float(page.cropbox.left)
            top = float(page.mediabox.height)-float(page.cropbox.top)
            painted = [(chr(c[0]), c[2][0]+left, c[2][1]+top)
                       for span in document[0].get_texttrace() for c in span['chars']]
    for old in required:
        if not any(text == old['text'] and abs(x-old['originX']) <= .75 and abs(y-old['baseline']) <= .75
                   for text, x, y in painted):
            raise ValueError('“'+old['text']+'”上方有独立注音，本次排版会使注音错位；请保留该字原位，草稿已保留')

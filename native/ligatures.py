"""Restore only known source ligatures split into colocated logical scalars.

Keep logical offsets separate for selection. This is not general shaping: new
text with distinct origins is always painted as separately positioned glyphs.
"""
LIGATURES={'ffi':'\ufb03','ffl':'\ufb04','ff':'\ufb00','fi':'\ufb01','fl':'\ufb02','st':'\ufb06'}
FIELDS=('fontKey','path','size','scale','color','rotation','bold','italic','fontBold','fontItalic','strokeWidth')

def cluster(glyphs,index,coverage):
    first=glyphs[index]
    for text,scalar in LIGATURES.items():
        group=glyphs[index:index+len(text)]
        if len(group)!=len(text) or ''.join(g['text'] for g in group)!=text or ord(scalar) not in coverage:continue
        if any(g.get('synthetic') or any(g.get(k)!=first.get(k) for k in FIELDS)
               or abs(g['originX']-first['originX'])>.001 or abs(g['baseline']-first['baseline'])>.001 for g in group):continue
        if any(a['end']!=b['start'] for a,b in zip(group,group[1:])):continue
        return scalar,text,len(group)
    return first['text'],first['text'],1

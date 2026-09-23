"""Font recommendations scored from outlines and advance metrics, never names.
Exact identity means matching sampled glyphs, not proof of an entire font family.
"""
import hashlib, json, math
from functools import lru_cache
from collections import OrderedDict
from pathlib import Path
from font_match import load_font

# Cache glyphs independently: inserting one leading character must not reraster
# every installed face. Outline masks are bounded to approximately 32 MiB.
_glyph_features=OrderedDict()

@lru_cache(maxsize=2048)
def coverage(path,face,stamp):
    from fontTools.ttLib import TTFont
    font=TTFont(path,fontNumber=face,lazy=True)
    try:
        # A packed bitset costs 139 KiB even for a huge CJK face; Latin faces
        # use only their highest scalar. It avoids thousands of Python integers.
        cmap=font.getBestCmap() or {};bits=bytearray((max(cmap,default=0)//8)+1)
        for cp in cmap:bits[cp//8]|=1<<(cp%8)
        return bytes(bits),bool(font.get('OS/2') and font['OS/2'].fsType & 2)
    finally:font.close()

def covers(bits,cp):return cp//8<len(bits) and bool(bits[cp//8] & (1<<(cp%8)))

@lru_cache(maxsize=128)
def features(path, face, stamp, characters):
    from fontTools.ttLib import TTFont
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.basePen import BasePen
    from PIL import Image, ImageDraw, ImageChops
    bits,restricted=coverage(path,face,stamp)
    out={};pending=[]
    for ch in characters:
        key=(path,face,stamp,ch)
        if key in _glyph_features:
            out[ch]=_glyph_features[key];_glyph_features.move_to_end(key)
        elif covers(bits,ord(ch)):pending.append(ch)
    if not pending:return out,bits,restricted
    font=TTFont(path,fontNumber=face,lazy=True)
    try:
        cmap=font.getBestCmap() or {}; units=font['head'].unitsPerEm
        glyphs=font.getGlyphSet()
        class RasterPen(BasePen):
            def __init__(self): super().__init__(glyphs); self.contours=[];self.points=[]
            def _moveTo(self,p): self.points=[p]
            def _lineTo(self,p): self.points.append(p)
            def _curveToOne(self,a,b,c):
                p=self._getCurrentPoint()
                for i in range(1,13):
                    t=i/12; u=1-t
                    self.points.append((u**3*p[0]+3*u*u*t*a[0]+3*u*t*t*b[0]+t**3*c[0],u**3*p[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t**3*c[1]))
            def _qCurveToOne(self,a,b):
                p=self._getCurrentPoint()
                for i in range(1,13):
                    t=i/12;u=1-t;self.points.append((u*u*p[0]+2*u*t*a[0]+t*t*b[0],u*u*p[1]+2*u*t*a[1]+t*t*b[1]))
            def _closePath(self): self.contours.append(self.points);self.points=[]
            def _endPath(self): self._closePath()
        for ch in pending:
            name=cmap.get(ord(ch))
            if not name:continue
            g=glyphs[name];pen=DecomposingRecordingPen(glyphs);g.draw(pen)
            normalized=[(op,[tuple(round(v/units,5) for v in p) if p is not None else None for p in pts]) for op,pts in pen.value]
            advance=font['hmtx'].metrics[name][0]/units
            signature=hashlib.sha256(json.dumps([normalized,round(advance,5)]).encode()).hexdigest()
            raster=RasterPen();g.draw(raster);img=Image.new('1',(64,64))
            for contour in raster.contours:
                if len(contour)<3:continue
                part=Image.new('1',(64,64));ImageDraw.Draw(part).polygon([(round(8+x/units*42),round(50-y/units*42)) for x,y in contour],fill=1)
                img=ImageChops.logical_xor(img,part)
            mask=int.from_bytes(img.tobytes(),'big')
            out[ch]=(signature,advance,mask)
            _glyph_features[(path,face,stamp,ch)]=out[ch]
            while len(_glyph_features)>32768:_glyph_features.popitem(last=False)
        return out,bits,restricted
    finally:font.close()

@lru_cache(maxsize=128)
def recommend(font_key, missing='', sample=''):
    from system_fonts import catalog
    source=load_font(font_key)
    if not source:return []
    source_coverage=source['coverage']; chars=''.join(dict.fromkeys(c for c in sample if ord(c) in source_coverage and not c.isspace()))
    if len(chars)<8:
        cjk=any(ord(c)>=0x2e80 for c in missing)
        preferred=[cp for cp in sorted(source_coverage) if (0x2e80<=cp<=0x9fff if cjk else 65<=cp<=122)]
        chosen=set(preferred);rest=[cp for cp in sorted(source_coverage) if cp>=33 and cp not in chosen]
        chars+=''.join(chr(cp) for cp in preferred+rest if chr(cp) not in chars)[:16-len(chars)]
    # Spread evidence across the subset rather than comparing a single common glyph.
    chars=chars[:16]; required={ord(c) for c in missing if not c.isspace()}
    if not chars:return []
    try: ref,_,_=features(source['path'],0,Path(source['path']).stat().st_mtime_ns,chars)
    except Exception:return []
    ranked=[]
    for item in catalog().values():
        try:
            stamp=Path(item['path']).stat().st_mtime_ns
            bits,restricted=coverage(item['path'],item['face'],stamp)
            if restricted or not all(covers(bits,cp) for cp in required):continue
            cand,_,_=features(item['path'],item['face'],stamp,chars)
            shared=[c for c in chars if c in ref and c in cand]
            if len(shared)<min(4,len(ref)):continue
            exact=0;scores=[]
            for c in shared:
                a,b=ref[c],cand[c];exact+=a[0]==b[0]
                union=(a[2]|b[2]).bit_count();overlap=(a[2]&b[2]).bit_count()/max(1,union)
                metric=max(0,1-abs(a[1]-b[1])/max(.25,a[1]))
                scores.append(.85*overlap+.15*metric)
            score=sum(scores)/len(scores)*min(1,len(shared)/max(1,len(ref)))
            same=exact==len(shared) and len(shared)>=4
            ranked.append({'id':item['id'],'name':item['name'],'source':item['source'],'score':round(score,4),
                'evidence':len(shared),'exactGlyphs':exact,'match':'样本字形一致' if same else '字形相近','confidence':'高' if same else '中' if score>=.78 and len(shared)>=8 else '低'})
        except Exception:continue
    return sorted(ranked,key=lambda r:(r['confidence']=='高',r['score'],r['evidence']),reverse=True)[:5]

# Reuse the chosen full face across different missing characters. Keep separate
# script buckets so a Latin choice does not displace a Chinese fallback.
_fallback_faces = OrderedDict()

@lru_cache(maxsize=512)
def fallback(font_key, character):
    from system_fonts import select_font
    bucket=(font_key, 'latin' if ord(character)<0x300 else 'cjk' if 0x2e80<=ord(character)<=0x9fff else 'other')
    previous=_fallback_faces.get(bucket, [])
    if bucket in _fallback_faces:_fallback_faces.move_to_end(bucket)
    for face in previous:
        if ord(character) in face['coverage']:return face
    matches=recommend(font_key,character)
    if not matches:return None
    chosen=matches[0]
    font=load_font(select_font(chosen['id'])['fontKey'])
    if not font or ord(character) not in font['coverage']:return None
    face={**font, 'match':chosen['match'], 'score':chosen['score'], 'confidence':chosen['confidence']}
    _fallback_faces[bucket]=[face,*previous][:4]
    _fallback_faces.move_to_end(bucket)
    while len(_fallback_faces)>64:_fallback_faces.popitem(last=False)
    return face

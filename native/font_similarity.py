"""Font recommendations scored from outlines and advance metrics, never names.
Exact identity means matching sampled glyphs, not proof of an entire font family.
"""
import hashlib, json, math
import struct
from collections.abc import Mapping
from functools import lru_cache
from collections import OrderedDict
from pathlib import Path
from font_match import load_font

# Cache glyphs independently: inserting one leading character must not reraster
# every installed face. Outline masks are bounded to approximately 32 MiB.
_glyph_features=OrderedDict()

def outline_font(path, face, sampled=False):
    from fontTools.ttLib import TTFont
    font=TTFont(path,fontNumber=face,lazy=True)
    if 'glyf' in font:
        # Glyph names are irrelevant to Unicode coverage and outline identity.
        # For name-less CJK subsets FontTools otherwise reverse-engineers tens
        # of thousands of names from cmap, then decompiles the same cmap again.
        # Stable GID names retain composite references and metrics exactly, and
        # avoid doing that reconstruction for every installed candidate face.
        count=font['maxp'].numGlyphs
        order=['.notdef']+['glyph%05d'%gid for gid in range(1,count)]
        font.setGlyphOrder(order)
        if sampled:
            from fontTools.ttLib import newTable
            from fontTools.ttLib.tables._g_l_y_f import Glyph
            # A recommendation samples at most 16 glyphs. Loading 65,000 Glyph
            # objects and all advances for each CJK face dominates that work.
            # Keep FontTools' actual outline decoder, including composites and
            # variations, and defer only the table's dictionary materialization.
            class Indexed(Mapping):
                def __len__(self):return count
                def __iter__(self):return iter(order)
                def gid(self,name):
                    gid=0 if name=='.notdef' else int(name.removeprefix('glyph'))
                    if not 0<=gid<count:raise KeyError(name)
                    return gid
            data=font.reader['glyf'];locations=font['loca'].locations
            class Glyphs(Indexed):
                def __init__(self):self.cache={}
                def __getitem__(self,name):
                    if name not in self.cache:
                        gid=self.gid(name);a,b=locations[gid:gid+2]
                        if not 0<=a<=b<=len(data):raise ValueError('字体字形范围无效')
                        self.cache[name]=Glyph(data[a:b])
                    return self.cache[name]
            glyf=newTable('glyf');glyf.glyphOrder=order;glyf._reverseGlyphOrder={}
            glyf.axisTags=[axis.axisTag for axis in font['fvar'].axes] if 'fvar' in font else []
            glyf.glyphs=Glyphs();font['glyf']=glyf
            class Metrics(Indexed):
                def __init__(self,raw,metric_count):self.raw=raw;self.metric_count=metric_count
                def __getitem__(self,name):
                    gid=self.gid(name);n=self.metric_count
                    if gid<n:return struct.unpack_from('>Hh',self.raw,gid*4)
                    return (struct.unpack_from('>H',self.raw,(n-1)*4)[0],struct.unpack_from('>h',self.raw,n*4+(gid-n)*2)[0])
            for tag,header,field in [('hmtx','hhea','numberOfHMetrics'),('vmtx','vhea','numberOfVMetrics')]:
                if tag in font:
                    table=newTable(tag);table.metrics=Metrics(font.reader[tag],getattr(font[header],field));font[tag]=table
    return font

@lru_cache(maxsize=2048)
def coverage(path,face,stamp):
    font=outline_font(path,face)
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
    font=outline_font(path,face,sampled=True)
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

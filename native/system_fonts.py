"""Localized, per-face system font catalog with opaque content selection IDs."""
import hashlib,json,os,io,sys
from functools import lru_cache
from pathlib import Path
from font_match import CACHE
sys.path.insert(0,str(Path(__file__).parent/'vendor'))
def aliases(blob):
    try:
        from fontTools.ttLib import TTFont
        f=TTFont(io.BytesIO(blob),lazy=True)
        return list(dict.fromkeys(n.toUnicode() for n in f['name'].names if n.nameID in (1,4,6,16,17)))[:50]
    except Exception:return []
def names(font):
    records=font['name'].names
    def get(ids):
        for langs in [(0x804,0x404,0x1004),(0x409,),None]:
            for id in ids:
                for n in records:
                    if n.nameID==id and (langs is None or n.langID in langs):
                        try:return n.toUnicode()
                        except Exception:pass
        return ''
    return get([16,1]),get([17,2]),get([4]),get([6])
@lru_cache(maxsize=1)
def catalog():
    from fontTools.ttLib import TTFont,TTCollection
    roots=[Path(__file__).parent/'fonts']
    if os.name=='nt':roots += [Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts',Path(os.environ.get('LOCALAPPDATA',''))/'Microsoft/Windows/Fonts']
    else:roots += [Path('/usr/share/fonts'),Path.home()/'.local/share/fonts',Path('/Library/Fonts'),Path('/System/Library/Fonts')]
    out={}
    for root in roots:
        if not root.is_dir():continue
        for p in sorted(root.rglob('*')):
            if p.suffix.lower() not in ('.ttf','.otf','.ttc'):continue
            try:
                if p.stat().st_size>96*1024*1024:continue
                if p.suffix.lower()=='.ttc':
                    import struct
                    with p.open('rb') as f:header=f.read(12)
                    count=struct.unpack('>I',header[8:12])[0]
                else:count=1
                for face in range(min(count,64)):
                    f=TTFont(str(p),fontNumber=face,lazy=True);family,style,full,ps=names(f)
                    ident=hashlib.sha256((str(p.resolve())+str(p.stat().st_mtime_ns)+':'+str(face)).encode()).hexdigest()[:32]
                    out[ident]={'id':ident,'name':full or family or p.stem,'family':family,'style':style,'postScriptName':ps,'aliases':list(dict.fromkeys(n.toUnicode() for n in f['name'].names if n.nameID in (1,4,6,16,17)))[:50],'source':'内置字体' if root==roots[0] else '系统字体','path':str(p),'face':face};f.close()
            except Exception:continue
    return out

def list_fonts():return {'fonts':[{k:v for k,v in f.items() if k!='path'} for f in catalog().values()]}
@lru_cache(maxsize=96)
def select_font(ident):
    import fitz
    from fontTools.ttLib import TTFont
    item=catalog().get(ident)
    if not item:raise ValueError('字体不可用，请刷新字体列表')
    f=TTFont(item['path'],fontNumber=item['face']);buf=io.BytesIO();f.save(buf);f.close();blob=buf.getvalue();font=fitz.Font(fontbuffer=blob)
    key=hashlib.sha256(blob).hexdigest()[:32];CACHE.mkdir(parents=True,exist_ok=True)
    (CACHE/(key+'.ttf')).write_bytes(blob);(CACHE/(key+'.json')).write_text(json.dumps({'name':item['name'],'coverage':font.valid_codepoints()}))
    return {'fontKey':key,'fontName':item['name'],'source':item['source'],'family':item['family'],'face':item['face']}

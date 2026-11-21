"""Localized, per-face system font catalog with opaque content selection IDs."""
import hashlib,os,io,sys
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
def read_faces(path):
    import struct
    from fontTools.ttLib import TTFont
    count = 1
    if path.suffix.lower() == '.ttc':
        with path.open('rb') as stream:
            count = struct.unpack_from('>I', stream.read(12), 8)[0]
    faces = []
    for face in range(min(count, 64)):
        try:
            with TTFont(str(path), fontNumber=face, lazy=True) as font:
                family, style, full, ps = names(font)
                aliases = list(dict.fromkeys(n.toUnicode() for n in font['name'].names
                                             if n.nameID in (1, 4, 6, 16, 17)))[:50]
                faces.append([family, style, full, ps, aliases])
        except Exception:
            return faces, False  # Retain valid earlier faces and retry next time.
    return faces, True


def cached_faces(entry, stamp):
    if not isinstance(entry, list) or len(entry) != 2 or entry[0] != stamp:
        return None
    faces = entry[1]
    if not isinstance(faces, list) or len(faces) > 64:
        return None
    for face in faces:
        if not (isinstance(face, list) and len(face) == 5 and
                all(isinstance(x, str) for x in face[:4]) and
                isinstance(face[4], list) and len(face[4]) <= 50 and
                all(isinstance(x, str) for x in face[4])):
            return None
    return faces


@lru_cache(maxsize=1)
def catalog():
    import json
    from font_similarity import cache_file, publish_cache
    roots=[Path(__file__).parent/'fonts']
    if os.name=='nt':roots += [Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts',Path(os.environ.get('LOCALAPPDATA',''))/'Microsoft/Windows/Fonts']
    else:roots += [Path('/usr/share/fonts'),Path.home()/'.local/share/fonts',Path('/Library/Fonts'),Path('/System/Library/Fonts')]
    # The idle scan and foreground editor run in separate processes. Persist
    # names only. Rebuild paths, face numbers and selection IDs from live files.
    disk = cache_file('face-names-v1', os.pathsep.join(map(str, roots)))
    try:
        old = json.loads(disk.read_text(encoding='utf-8')) if disk.stat().st_size <= 8*1024**2 else {}
    except (OSError, ValueError):
        old = {}
    if not isinstance(old, dict):
        old = {}
    current = {}
    out = {}
    for root in roots:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob('*')):
            if path.suffix.lower() not in ('.ttf', '.otf', '.ttc'):
                continue
            try:
                stat = path.stat()
                if stat.st_size > 96*1024**2:
                    continue
                resolved = str(path.resolve())
                stamp = [stat.st_mtime_ns, stat.st_size, stat.st_ino, stat.st_ctime_ns]
                faces = cached_faces(old.get(resolved), stamp)
                complete = True
                if faces is None:
                    faces, complete = read_faces(path)
                if complete:
                    current[resolved] = [stamp, faces]
                for index, (family, style, full, ps, aliases) in enumerate(faces):
                    ident = hashlib.sha256((resolved + str(stat.st_mtime_ns) + ':' + str(index)).encode()).hexdigest()[:32]
                    out[ident] = {'id': ident, 'name': full or family or path.stem,
                                  'family': family, 'style': style, 'postScriptName': ps,
                                  'aliases': aliases, 'source': '内置字体' if root == roots[0] else '系统字体',
                                  'path': str(path), 'face': index}
            except Exception:
                continue
    if old != current:
        data = json.dumps(current, separators=(',', ':')).encode('utf-8')
        if len(data) <= 8*1024**2:
            publish_cache(disk, data)
    return out

def list_fonts():return {'fonts':[{k:v for k,v in f.items() if k!='path'} for f in catalog().values()]}
@lru_cache(maxsize=96)
def select_font(ident):
    import fitz
    from fontTools.ttLib import TTFont
    item=catalog().get(ident)
    if not item:raise ValueError('字体不可用，请刷新字体列表')
    from font_similarity import cache_file,publish_cache
    from font_match import load_font
    import json
    disk=cache_file('selection',ident)
    meta={'fontName':item['name'],'source':item['source'],'family':item['family'],'face':item['face']}
    try:
        record=json.loads(disk.read_text(encoding='utf-8'));key=record.get('fontKey')
        metadata=(CACHE/(key+'.json')).stat()
        cached=load_font(key)
        if cached and record.get('metadataStamp')==metadata.st_mtime_ns and record.get('metadataSize')==metadata.st_size and Path(cached['path']).is_file():return {'fontKey':key,**meta}
    except (OSError,ValueError,AttributeError,TypeError):pass
    f=TTFont(item['path'],fontNumber=item['face'],lazy=True,recalcTimestamp=False,recalcBBoxes=False);buf=io.BytesIO();f.save(buf);f.close();blob=buf.getvalue();font=fitz.Font(fontbuffer=blob)
    from font_cache import publish_font
    key=hashlib.sha256(blob).hexdigest()[:32]
    from font_match import populated_coverage
    covered=sorted(populated_coverage(blob,font.valid_codepoints()))
    publish_font(CACHE,key,blob,{'name':item['name'],'coverage':covered,'coverageVersion':2})
    metadata=(CACHE/(key+'.json')).stat()
    publish_cache(disk,json.dumps({'fontKey':key,'metadataStamp':metadata.st_mtime_ns,'metadataSize':metadata.st_size}).encode())
    return {'fontKey':key,**meta}

"""Restore Unicode cmap for embedded TrueType subsets; keep original glyph outlines/metrics.
The cache is shared by the inspect and Story processes and keyed only by content hashes.
"""
import base64,hashlib,io,json,math,re,struct,tempfile,sys
from pathlib import Path
from functools import lru_cache
# Embedded Windows Python must resolve the shipped converter on the first CID font,
# without relying on a previous Type1/browser-font request to alter sys.path.
sys.path.insert(0,str(Path(__file__).parent/'vendor'))
CACHE=Path(tempfile.gettempdir())/'folio-fonts-v13'

def checksum(data):
    data+=b'\0'*((-len(data))%4)
    return sum(struct.unpack('>%dI'%(len(data)//4),data))&0xffffffff

def unicode_cmap(blob,mapping):
    # sfnt directory rebuild; cmap format 12 works for BMP and supplementary Unicode.
    if blob[:4] not in (b'\0\1\0\0',b'OTTO'):raise ValueError('Unsupported embedded font')
    from font_sfnt import tables as read_tables, build, normalize
    tables=read_tables(blob)
    glyph_count=struct.unpack_from('>H',tables[b'maxp'],4)[0]
    pairs=sorted((u,g) for u,g in mapping.items() if 0<g<glyph_count and 0<=u<=0x10ffff)
    groups=[]
    for u,g in pairs:
        if groups and u==groups[-1][1]+1 and g==groups[-1][2]+u-groups[-1][0]:groups[-1][1]=u
        else:groups.append([u,u,g])
    sub=struct.pack('>HHIII',12,0,16+12*len(groups),0,len(groups))+b''.join(struct.pack('>III',*g) for g in groups)
    tables[b'cmap']=struct.pack('>HHHHI',0,1,3,10,12)+sub
    return normalize(build(blob[:4],tables)),set(u for u,g in pairs)

def cff_cids(blob):
    """CID-keyed CFF charset defines CID -> GID; CID is not a glyph index."""
    from fontTools.ttLib import TTFont
    if blob[:4]==b'OTTO':
        font=TTFont(io.BytesIO(blob),lazy=True);top=font['CFF '].cff.topDictIndex[0]
    elif blob[:1]==b'\x01':
        from browser_fonts import read_cff
        font=None;_,top=read_cff(blob)
    else:raise ValueError('此 CID CFF 封装暂不支持，请明确选择替代字体')
    try:
        if not hasattr(top,'ROS'):raise ValueError('CID 字体缺少字符集合映射')
        mapping={0:0}
        for gid,name in enumerate(top.charset):
            if name.startswith('cid') and name[3:].isdigit():mapping[int(name[3:])]=gid
        return mapping
    finally:
        if font is not None:font.close()

def load_font(key):
    if not isinstance(key,str) or not re.fullmatch('[0-9a-f]{32}',key):return None
    try:
        path=CACHE/(key+'.json')
        return _load_font(key,path.stat().st_mtime_ns)
    except (OSError,ValueError):return None

@lru_cache(maxsize=96)
def _load_font(key,stamp):
    info=json.loads((CACHE/(key+'.json')).read_text())
    info['path']=str(CACHE/(key+'.ttf'));info['coverage']=frozenset(info['coverage'])
    return info

def inspect_fonts(data,page_number,objects,mapped,stream):
    import fitz
    from pypdf import PdfReader
    try:from pypdf._cmap import _parse_to_unicode as parse_unicode
    except ImportError:from pypdf._cmap import parse_to_unicode as parse_unicode
    from generated_cmaps import parse_unicode as checked_unicode
    original_parser=parse_unicode
    parse_unicode=lambda font:checked_unicode(font,original_parser)
    reader=PdfReader(io.BytesIO(data));page=reader.pages[page_number-1]
    fonts=page['/Resources'].get('/Font',{});fonts=fonts.get_object() if hasattr(fonts,'get_object') else fonts
    available={};CACHE.mkdir(parents=True,exist_ok=True)
    with fitz.open(stream=data,filetype='pdf') as doc:
        refs={f[4]:f[0] for f in doc[page_number-1].get_fonts()}
        for resource,ref in fonts.items():
            f=ref.get_object();name=str(f.get('/BaseFont','/Unknown')).removeprefix('/');key=None;reason='原字体未嵌入；可选择本机或替代字体'
            embedded=None
            try:_,ext,_,embedded=doc.extract_font(ref.idnum)
            except (ValueError,RuntimeError,AttributeError):pass
            if embedded:reason='原字体已嵌入，但此字体格式或字符映射暂不支持'
            try:
                if f.get('/Subtype') in ('/TrueType','/Type1'):
                    _,ext,_,blob=doc.extract_font(ref.idnum)
                    if not blob:
                        aliases={'Helvetica':'helv','Helvetica-Bold':'hebo','Helvetica-Oblique':'heit','Helvetica-BoldOblique':'hebi','Times-Roman':'tiro','Times-Bold':'tibo','Times-Italic':'tiit','Times-BoldItalic':'tibi','Courier':'cour','Courier-Bold':'cobo','Courier-Oblique':'coit','Courier-BoldOblique':'cobi'}
                        if name not in aliases:raise ValueError(reason)
                        original=fitz.Font(aliases[name]);blob=original.buffer
                    original=fitz.Font(fontbuffer=blob);coverage=set(original.valid_codepoints())
                    if ext in ('pfa','pfb'):
                        from type1_restore import restore_type1
                        cmap,_=parse_unicode(f) if f.get('/ToUnicode') else (None,None)
                        descriptor=f.get('/FontDescriptor',{}).get_object()
                        program=descriptor.get('/FontFile')
                        program=program.get_object() if program else {}
                        segments=tuple(int(program.get(k,-1)) for k in ('/Length1','/Length2','/Length3'))
                        blob,coverage=restore_type1(blob,cmap,name,segments)
                    if not coverage:raise ValueError('原字体 Unicode 映射不完整，需要选择可用字体')
                else:
                    if f.get('/Subtype')!='/Type0' or f.get('/Encoding') not in ('/Identity-H','/Identity-V'):raise ValueError(reason)
                    cid=f['/DescendantFonts'][0].get_object()
                    if cid.get('/Subtype') not in ('/CIDFontType2','/CIDFontType0'):raise ValueError(reason)
                    _,ext,_,blob=doc.extract_font(ref.idnum)
                    cmap,_=parse_unicode(f)
                    if str(f.get('/ToUnicode')) in ('/Identity-H','/Identity-V'):
                        # Named Identity ToUnicode maps two-byte codes to the
                        # same Unicode scalar, independently of CIDToGIDMap.
                        cmap={chr(cp):chr(cp) for cp in range(65536) if not 0xd800<=cp<=0xdfff}
                    gid_map=cid.get('/CIDToGIDMap','/Identity')
                    if hasattr(gid_map,'get_object'):gid_map=gid_map.get_object()
                    raw=gid_map.get_data() if hasattr(gid_map,'get_data') else None
                    mapping={};cids=cff_cids(blob) if cid.get('/Subtype')=='/CIDFontType0' else None
                    if not cmap and cids is not None:
                        info=cid.get('/CIDSystemInfo',{});info=info.get_object() if hasattr(info,'get_object') else info
                        registry=str(info.get('/Registry',''));ordering=str(info.get('/Ordering',''))
                        if registry=='Adobe' and ordering in ('GB1','CNS1','Japan1','Korea1'):
                            predefined=fitz.mupdf.pdf_load_system_cmap(f'Adobe-{ordering}-UCS2')
                            cmap={chr(code):chr(cp) for code in cids if code<=65535
                                for cp in [fitz.mupdf.pdf_lookup_cmap(predefined,code)] if 0<cp<=0x10ffff and not 0xd800<=cp<=0xdfff}
                    for code,char in cmap.items():
                        if not isinstance(code,str) or len(code)!=1 or not isinstance(char,str) or len(char)!=1:continue
                        n=ord(code)
                        if cids is not None:g=cids.get(n,0)
                        else:g=int.from_bytes(raw[2*n:2*n+2],'big') if raw is not None else n
                        if g:mapping[ord(char)]=g
                    if not mapping:raise ValueError(reason)
                    if blob[:1]==b'\x01':
                        from browser_fonts import opentype
                        blob=opentype(blob,mapping)
                    blob,coverage=unicode_cmap(blob,mapping)
                from browser_fonts import opentype
                blob=opentype(blob)
                # Coverage must agree with the normalized font, not merely the
                # original PDF decoder. Never advertise a .notdef as a glyph.
                face=fitz.Font(fontbuffer=blob)
                coverage={cp for cp in coverage if face.has_glyph(cp)}
                if not coverage:raise ValueError('原字体 Unicode 映射不完整')
                key=hashlib.sha256(blob).hexdigest()[:32]
                if not (CACHE/(key+'.ttf')).exists():
                    import os
                    fd,tmp=tempfile.mkstemp(dir=CACHE,suffix='.font.tmp')
                    try:
                        with os.fdopen(fd,'wb') as out:out.write(blob)
                        os.replace(tmp,CACHE/(key+'.ttf'))
                    finally:
                        if os.path.exists(tmp):os.unlink(tmp)
                info={'name':name,'coverage':sorted(coverage)}
                # Stable files let the metadata/coverage cache survive repeated
                # inspections. An atomic replace prevents parallel reads of a
                # partially written JSON document in the layout worker.
                path=CACHE/(key+'.json')
                if not path.exists():
                    import os
                    fd,tmp=tempfile.mkstemp(dir=CACHE,suffix='.json.tmp')
                    try:
                        with os.fdopen(fd,'w') as out:json.dump(info,out)
                        os.replace(tmp,path)
                    finally:
                        if os.path.exists(tmp):os.unlink(tmp)
                reason=''
            except Exception as e:
                # Recovery is per font. A malformed Type1/CFF must not hide every
                # editable object on an otherwise readable page.
                key=None;reason=type(e).__name__+': '+(str(e) or reason)
            meta={'fontKey':key,'fontName':name.split('+')[-1],'fontFallback':reason,'fontSubset':bool(re.match(r'^[A-Z]{6}\+',name)),
                  'writingMode':'vertical-rl' if f.get('/Encoding')=='/Identity-V' else 'horizontal-tb', 'fontOriginalName':name, 'fontResolution':'embedded' if key else 'unresolved',
                  'fontEmbedded':bool(embedded),'fontBrowserReady':bool(key)}
            # Only missing streams permit name resolution. Broken embedded cmap is
            # a different failure and must not be silently relabelled as unembedded.
            try:
                _,_,_,embedded=doc.extract_font(ref.idnum)
            except (ValueError,RuntimeError):embedded=None
            if not embedded:
                if key:meta['fontResolution']='standard'
                else:
                    from font_resolver import resolve_name
                    resolved=resolve_name(name)
                    if resolved:meta.update(resolved)
            available[str(resource)]=meta
    state={'font':None,'charSpacing':0,'wordSpacing':0,'horizontalScale':100};stack=[];states={}
    for i,(args,op) in enumerate(stream.operations):
        if op==b'q':stack.append(state.copy())
        elif op==b'Q':state=stack.pop() if stack else state
        elif op==b'Tf':state['font']=str(args[0])
        elif op==b'Tc':state['charSpacing']=float(args[0])
        elif op==b'Tw':state['wordSpacing']=float(args[0])
        elif op==b'Tz':state['horizontalScale']=float(args[0])
        if op in (b'Tj',b'TJ',b"'",b'"'):
            if op==b'"':state.update(wordSpacing=float(args[0]),charSpacing=float(args[1]))
            states[i]=state.copy()
    for o,m in zip(objects,mapped or []):
        if o['type']!='text':continue
        st=states.get(m['at'],{});meta=available.get(st.get('font'),{})
        factor=math.hypot(o['matrix'][0],o['matrix'][1])
        o.update(meta);o['charSpacing']=st.get('charSpacing',0)*factor;o['wordSpacing']=st.get('wordSpacing',0)*factor
        o['horizontalScale']=st.get('horizontalScale',100)
    return available

from functools import lru_cache
@lru_cache(maxsize=96)
def spaced_font(path,spacing,word,size):
    """Story ignores CSS letter-spacing. Adjust font advances before layout, not pixels after it."""
    import fitz
    blob=Path(path).read_bytes()
    if abs(spacing)+abs(word)<.00001:return blob
    if blob[:4] not in (b'\0\1\0\0',b'OTTO'):return blob
    n=struct.unpack_from('>H',blob,4)[0];tables={}
    for i in range(n):
        tag,_,offset,length=struct.unpack_from('>4sIII',blob,12+16*i);tables[tag]=blob[offset:offset+length]
    units=struct.unpack_from('>H',tables[b'head'],18)[0];count=struct.unpack_from('>H',tables[b'maxp'],4)[0]
    metrics=struct.unpack_from('>H',tables[b'hhea'],34)[0];old=tables[b'hmtx'];delta=spacing/size*units
    space=fitz.Font(fontbuffer=blob).has_glyph(32);new=[];last=0
    for i in range(count):
        if i<metrics:advance,bearing=struct.unpack_from('>Hh',old,i*4);last=advance
        else:advance=last;bearing=struct.unpack_from('>h',old,metrics*4+(i-metrics)*2)[0]
        # Retain zero advances for combining marks; word spacing applies only to U+0020.
        advance=max(0,min(65535,round(advance+(delta if advance else 0)+(word/size*units if i==space else 0))))
        new.append(struct.pack('>Hh',advance,bearing))
    tables[b'hmtx']=b''.join(new);tables[b'hhea']=tables[b'hhea'][:34]+struct.pack('>H',count)+tables[b'hhea'][36:]
    tables[b'head']=tables[b'head'][:8]+b'\0'*4+tables[b'head'][12:]
    offset=12+16*n;directory=[];chunks=[];head=0
    for tag,data in sorted(tables.items()):
        directory.append(struct.pack('>4sIII',tag,checksum(data),offset,len(data)))
        if tag==b'head':head=offset
        padded=data+b'\0'*((-len(data))%4);chunks.append(padded);offset+=len(padded)
    out=bytearray(blob[:12]+b''.join(directory)+b''.join(chunks))
    struct.pack_into('>I',out,head+8,(0xb1b0afba-checksum(bytes(out)))&0xffffffff)
    from font_sfnt import normalize
    return normalize(bytes(out))

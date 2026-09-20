"""Restore Unicode cmap for embedded TrueType subsets; keep original glyph outlines/metrics.
The cache is shared by the inspect and Story processes and keyed only by content hashes.
"""
import base64,hashlib,io,json,math,re,struct,tempfile
from pathlib import Path
from functools import lru_cache
CACHE=Path(tempfile.gettempdir())/'folio-fonts-v10'

def checksum(data):
    data+=b'\0'*((-len(data))%4)
    return sum(struct.unpack('>%dI'%(len(data)//4),data))&0xffffffff

def unicode_cmap(blob,mapping):
    # sfnt directory rebuild; cmap format 12 works for BMP and supplementary Unicode.
    if blob[:4] not in (b'\0\1\0\0',b'OTTO'):raise ValueError('Unsupported embedded font')
    count=struct.unpack_from('>H',blob,4)[0];tables={}
    for i in range(count):
        tag,cs,offset,length=struct.unpack_from('>4sIII',blob,12+16*i)
        tables[tag]=blob[offset:offset+length]
    glyph_count=struct.unpack_from('>H',tables[b'maxp'],4)[0]
    pairs=sorted((u,g) for u,g in mapping.items() if 0<g<glyph_count and 0<=u<=0x10ffff)
    groups=[]
    for u,g in pairs:
        if groups and u==groups[-1][1]+1 and g==groups[-1][2]+u-groups[-1][0]:groups[-1][1]=u
        else:groups.append([u,u,g])
    sub=struct.pack('>HHIII',12,0,16+12*len(groups),0,len(groups))+b''.join(struct.pack('>III',*g) for g in groups)
    tables[b'cmap']=struct.pack('>HHHHI',0,1,3,10,12)+sub
    if b'head' in tables:tables[b'head']=tables[b'head'][:8]+b'\0'*4+tables[b'head'][12:]
    n=len(tables);power=2**int(math.log2(n));offset=12+16*n
    directory=[];chunks=[];head_offset=None
    for tag,data in sorted(tables.items()):
        directory.append(struct.pack('>4sIII',tag,checksum(data),offset,len(data)))
        if tag==b'head':head_offset=offset
        padded=data+b'\0'*((-len(data))%4);chunks.append(padded);offset+=len(padded)
    out=bytearray(blob[:4]+struct.pack('>HHHH',n,power*16,int(math.log2(power)),n*16-power*16)+b''.join(directory)+b''.join(chunks))
    if head_offset is not None:struct.pack_into('>I',out,head_offset+8,(0xb1b0afba-checksum(bytes(out)))&0xffffffff)
    return bytes(out),set(u for u,g in pairs)

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
    reader=PdfReader(io.BytesIO(data));page=reader.pages[page_number-1]
    fonts=page['/Resources'].get('/Font',{});fonts=fonts.get_object() if hasattr(fonts,'get_object') else fonts
    available={};CACHE.mkdir(parents=True,exist_ok=True)
    with fitz.open(stream=data,filetype='pdf') as doc:
        refs={f[4]:f[0] for f in doc[page_number-1].get_fonts()}
        for resource,ref in fonts.items():
            f=ref.get_object();name=str(f.get('/BaseFont','Unknown'))[1:];key=None;reason='原字体未嵌入或暂不支持，使用替代字体'
            try:
                if f.get('/Subtype') in ('/TrueType','/Type1'):
                    _,ext,_,blob=doc.extract_font(ref.idnum)
                    if not blob:
                        aliases={'Helvetica':'helv','Helvetica-Bold':'hebo','Helvetica-Oblique':'heit','Helvetica-BoldOblique':'hebi','Times-Roman':'tiro','Times-Bold':'tibo','Times-Italic':'tiit','Times-BoldItalic':'tibi','Courier':'cour','Courier-Bold':'cobo','Courier-Oblique':'coit','Courier-BoldOblique':'cobi'}
                        if name not in aliases:raise ValueError(reason)
                        original=fitz.Font(aliases[name]);blob=original.buffer
                    original=fitz.Font(fontbuffer=blob);coverage=set(original.valid_codepoints())
                    if ext=='pfa' and f.get('/ToUnicode'):
                        from type1_restore import restore_type1
                        cmap,_=parse_unicode(f)
                        blob,coverage=restore_type1(blob,cmap,name)
                    if not coverage:raise ValueError('原字体 Unicode 映射不完整，需要选择可用字体')
                else:
                    if f.get('/Subtype')!='/Type0' or f.get('/Encoding')!='/Identity-H':raise ValueError(reason)
                    cid=f['/DescendantFonts'][0].get_object()
                    if cid.get('/Subtype')!='/CIDFontType2':raise ValueError(reason)
                    _,ext,_,blob=doc.extract_font(ref.idnum)
                    cmap,_=parse_unicode(f);gid_map=cid.get('/CIDToGIDMap','/Identity')
                    if hasattr(gid_map,'get_object'):gid_map=gid_map.get_object()
                    raw=gid_map.get_data() if hasattr(gid_map,'get_data') else None
                    mapping={}
                    for code,char in cmap.items():
                        if not isinstance(code,str) or len(code)!=1 or not isinstance(char,str) or len(char)!=1:continue
                        n=ord(code);g=int.from_bytes(raw[2*n:2*n+2],'big') if raw is not None else n
                        if g:mapping[ord(char)]=g
                    if not mapping:raise ValueError(reason)
                    blob,coverage=unicode_cmap(blob,mapping)
                key=hashlib.sha256(blob).hexdigest()[:32]
                if not (CACHE/(key+'.ttf')).exists():(CACHE/(key+'.ttf')).write_bytes(blob)
                (CACHE/(key+'.json')).write_text(json.dumps({'name':name,'coverage':sorted(coverage)}))
                reason=''
            except (KeyError,ValueError,TypeError,IndexError,struct.error,ImportError) as e: key=None;reason=str(e) or reason
            meta={'fontKey':key,'fontName':name.split('+')[-1],'fontFallback':reason,'fontSubset':bool(re.match(r'^[A-Z]{6}\+',name)),
                  'fontOriginalName':name, 'fontResolution':'embedded' if key else 'unresolved'}
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
    return bytes(out)

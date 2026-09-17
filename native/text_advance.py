"""Remove painted strings while preserving the PDF text cursor via numeric TJ.
No invisible duplicate text is left in search/copy. Unsupported encodings fail closed.
"""
from pypdf.generic import ArrayObject, FloatObject, TextStringObject

def font_metrics(font):
    if font.get('/Subtype') == '/Type0':
        if font.get('/Encoding') != '/Identity-H':
            raise ValueError('此字体编码暂不能独立编辑共享文字组')
        cid = font['/DescendantFonts'][0].get_object()
        widths = {}; values = cid.get('/W', []); i = 0
        if hasattr(values,'get_object'):values=values.get_object()
        while i < len(values):
            first = int(values[i]); item = values[i+1]; i += 2
            if hasattr(item,'get_object'):item=item.get_object()
            if isinstance(item, ArrayObject):
                for j, width in enumerate(item): widths[first+j] = float(width)
            else:
                last = int(item); width = float(values[i]); i += 1
                for code in range(first, last+1): widths[code] = width
        return 2, widths, float(cid.get('/DW', 1000))
    if font.get('/Subtype') not in ('/Type1', '/TrueType', '/MMType1'):
        raise ValueError('此字体类型暂不能独立编辑共享文字组')
    values = font.get('/Widths')
    if hasattr(values,'get_object'):values=values.get_object()
    if values is not None:
        widths = {int(font.get('/FirstChar',0))+i:float(v) for i,v in enumerate(values)}
        descriptor = font.get('/FontDescriptor', {})
        if hasattr(descriptor, 'get_object'): descriptor = descriptor.get_object()
        return 1, widths, float(descriptor.get('/MissingWidth',0))
    # Standard 14 fonts have predefined widths, even without a Widths array.
    import fitz
    names={'Helvetica':'helv','Helvetica-Bold':'hebo','Helvetica-Oblique':'heit','Helvetica-BoldOblique':'hebi',
           'Times-Roman':'tiro','Times-Bold':'tibo','Times-Italic':'tiit','Times-BoldItalic':'tibi',
           'Courier':'cour','Courier-Bold':'cobo','Courier-Oblique':'coit','Courier-BoldOblique':'cobi'}
    name=str(font.get('/BaseFont',''))[1:]
    if name not in names: raise ValueError('字体缺少可靠字宽')
    f=fitz.Font(names[name]); encoding=font.get('/Encoding','/StandardEncoding')
    differences={}
    if hasattr(encoding,'get_object'): encoding=encoding.get_object()
    if isinstance(encoding,dict):
        code=0
        for item in encoding.get('/Differences',[]):
            if isinstance(item,int):code=int(item)
            else:differences[code]=fitz.glyph_name_to_unicode(str(item)[1:]);code+=1
        encoding=encoding.get('/BaseEncoding','/StandardEncoding')
    codec={'/WinAnsiEncoding':'cp1252','/MacRomanEncoding':'mac_roman','/StandardEncoding':'ascii'}.get(str(encoding))
    if not codec:raise ValueError('字体编码缺少可靠字宽')
    widths={}
    for code in range(256):
        try: unicode= differences[code] if code in differences else ord(bytes([code]).decode(codec))
        except UnicodeDecodeError:continue
        widths[code]=f.glyph_advance(unicode)*1000
    return 1,widths,None

def advances(page, stream):
    fonts=page['/Resources'].get('/Font',{}); fonts=fonts.get_object() if hasattr(fonts,'get_object') else fonts
    state={'font':None,'size':0,'char':0,'word':0};stack=[];cache={};out={}
    for i,(args,op) in enumerate(stream.operations):
        if op==b'q':stack.append(state.copy())
        elif op==b'Q':state=stack.pop() if stack else {'font':None,'size':0,'char':0,'word':0}
        elif op==b'Tf':state.update(font=args[0],size=float(args[1]))
        elif op==b'Tc':state['char']=float(args[0])
        elif op==b'Tw':state['word']=float(args[0])
        elif op in (b'Tj',b'TJ',b"'",b'"'):
            if op==b'"':state.update(word=float(args[0]),char=float(args[1]))
            try:
                key=state['font']
                if key not in cache:cache[key]=font_metrics(fonts[key].get_object())
                step,widths,default=cache[key];size=state['size']
                if abs(size)<1e-12:raise ValueError('字号为零')
                values=args[0] if op==b'TJ' else [args[-1]];nums=[]
                for v in values:
                    if isinstance(v,(str,bytes)):
                        raw=v.original_bytes if isinstance(v,TextStringObject) else bytes(v)
                        if len(raw)%step:raise ValueError('字符边界不完整')
                        codes=[int.from_bytes(raw[j:j+step],'big') for j in range(0,len(raw),step)]
                        if default is None and any(c not in widths for c in codes):raise ValueError('未知标准字宽')
                        width=sum(widths.get(c,default) for c in codes)
                        spacing=state['char']*len(codes)+state['word']*(codes.count(32) if step==1 else 0)
                        nums.append(FloatObject(-width-spacing*1000/size))
                    else:nums.append(v)
                prefix=[]
                if op==b'"':prefix=[([args[0]],b'Tw'),([args[1]],b'Tc')]
                if op in (b"'",b'"'):prefix.append(([],b'T*'))
                out[i]=prefix+[([ArrayObject(nums)],b'TJ')]
            except (ValueError,KeyError,TypeError,IndexError):out[i]=None
    return out

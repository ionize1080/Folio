"""Portable conversion engines. Fixed executables, bounded child processes, no shell."""
import base64, os, subprocess, tempfile, pathlib, xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent / 'engines'

def engine(name):
    patterns = {'gs': 'ghostscript/**/gswin64c.exe', 'office': 'libreoffice/**/soffice.exe',
                'java': 'java/**/bin/java.exe', 'icc': 'ghostscript/**/srgb.icc'}
    found = list(ROOT.glob(patterns[name]))
    if not found: raise ValueError('转换组件未就绪，请使用完整的 Folio 发行包：' + name)
    return found[0].resolve()

def run(argv, timeout=240, cwd=None, codes=(0,)):
    p = subprocess.run([str(x) for x in argv], capture_output=True, timeout=timeout,
                       cwd=cwd, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    if p.returncode not in codes: raise ValueError('转换引擎失败：' + (p.stderr + p.stdout).decode('utf-8', 'replace')[-2000:])
    return p.stdout

def result(path, **extra):
    data = pathlib.Path(path).read_bytes()
    if len(data) > 80 * 1024**2: raise ValueError('转换结果超过 80 MB，请缩小页码范围')
    return {'bytes': base64.b64encode(data).decode(), 'extension': pathlib.Path(path).suffix[1:], 'size': len(data), **extra}

def validate(path, flavour):
    cp = os.pathsep.join([str(ROOT/'verapdf/etc'), str(ROOT/'verapdf/bin/*')])
    data = run([engine('java'), '-Xmx512m', '-Dfile.encoding=UTF8', '-cp', cp, 'org.verapdf.apps.GreenfieldCliWrapper',
                '--format', 'xml', '--flavour', flavour, str(path)], 180, codes=(0,1))
    tree = ET.fromstring(data)
    reports = tree.findall('.//validationReport')
    if len(reports) != 1: raise ValueError('veraPDF 未返回单一验证报告')
    report = reports[0]
    details = report.find('details')
    failures=[{'specification':r.get('specification'),'clause':r.get('clause'),'test':r.get('testNumber'),'description':r.findtext('description'),'contexts':[c.findtext('context') for c in r.findall('check')[:10]]} for r in report.findall('.//rule') if r.get('status')=='failed']
    return {'compliant': report.get('isCompliant') == 'true', 'standard': 'PDF/UA-' + flavour[-1] if flavour.startswith('ua') else 'PDF/A-' + flavour,
            'validator': 'veraPDF 1.30.3', 'details': details.attrib if details is not None else {},
            'failures':failures[:200], 'report': data.decode('utf-8')}

def pdfa(args):
    options = args.get('options') or {}; flavour = options.get('standard', '2b')
    if flavour not in ('1b', '2b', '3b'): raise ValueError('支持 PDF/A-1b、2b、3b')
    if args['action'] == 'validate-pdfa': return validate(args['input'], flavour)
    import fitz
    with fitz.open(args['input']) as source:
        if source.needs_pass: raise ValueError('请先解密再转换 PDF/A')
        pages = len(source)
    with tempfile.TemporaryDirectory(prefix='folio-pdfa-') as tmp:
        tmp = pathlib.Path(tmp); out = tmp/'archive.pdf'; icc = engine('icc')
        escaped = icc.as_posix().replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        definition = tmp/'output-intent.ps'
        definition.write_text('''%!PS
/ICCProfile (''' + escaped + ''') def
[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark
[{icc_PDFA} << /N 3 >> /PUT pdfmark
[{icc_PDFA} ICCProfile (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark
[{OutputIntent_PDFA} << /Type /OutputIntent /S /GTS_PDFA1
/DestOutputProfile {icc_PDFA} /OutputConditionIdentifier (sRGB IEC61966-2.1) >> /PUT pdfmark
[{Catalog} << /OutputIntents [ {OutputIntent_PDFA} ] >> /PUT pdfmark
''', encoding='utf-8')
        run([engine('gs'), '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=pdfwrite',
             '-dPDFA='+flavour[0], '-dPDFACompatibilityPolicy=2', '-sColorConversionStrategy=RGB',
             '-dEmbedAllFonts=true', '-dAutoRotatePages=/None', '--permit-file-read='+str(icc),
             '-sOutputFile='+str(out), definition, args['input']])
        report = validate(out, flavour)
        if not report['compliant']:
            raise ValueError('PDF/A 独立验证未通过，未输出不合规文件。失败规则：' + str(report['details']))
        with fitz.open(out) as check:
            if len(check) != pages: raise ValueError('PDF/A 页数校验失败')
        return result(out, validation=report, note='归档副本会重建 PDF；交互表单、脚本和数字签名不能原样保留。')

def office(args):
    ext = str(args.get('options', {}).get('extension', '')).lower().lstrip('.')
    if ext in ('png','jpg','jpeg','webp','bmp','tif','tiff','gif'):
        from PIL import Image, ImageSequence
        import fitz, io
        doc=fitz.open()
        with Image.open(args['input']) as image:
            for frame in ImageSequence.Iterator(image):
                if len(doc)>=100 or frame.width*frame.height>40_000_000:raise ValueError('图片页数或像素超出预算')
                buf=io.BytesIO();frame.convert('RGB').save(buf,format='PNG')
                width,height=frame.size;scale=min(1,14400/max(width,height))
                page=doc.new_page(width=width*scale,height=height*scale);page.insert_image(page.rect,stream=buf.getvalue())
        data=doc.tobytes(deflate=True);pages=len(doc);doc.close()
        return {'bytes':base64.b64encode(data).decode(),'extension':'pdf','pages':pages,'engine':'Pillow / MuPDF'}
    if ext not in ('doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','txt','csv','md','html'):
        raise ValueError('不支持此输入格式')
    with tempfile.TemporaryDirectory(prefix='folio-office-') as tmp:
        tmp = pathlib.Path(tmp); source = tmp/('document.'+ext)
        source.write_bytes(pathlib.Path(args['input']).read_bytes())
        if ext in ('md', 'txt'):
            from markdown_it import MarkdownIt
            import html
            text = source.read_text(encoding='utf-8-sig')
            body = MarkdownIt('commonmark', {'html':False}).enable('table').render(text) if ext == 'md' else '<pre>'+html.escape(text)+'</pre>'
            source = tmp/'document.html'
            source.write_text('<!doctype html><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:12pt;line-height:1.6;margin:2cm}h1,h2,h3{color:#172c44}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:6pt}img{max-width:100%}</style>'+body, encoding='utf-8')
        profile = tmp/'profile'; profile.mkdir(); user = profile/'user'; user.mkdir()
        # Highest macro security and disabled link updates in a fresh, single-use profile.
        (user/'registrymodifications.xcu').write_text('''<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateDocMode" oor:op="fuse"><value>0</value></prop></item></oor:items>''')
        try:
            run([engine('office'), '-env:UserInstallation='+profile.as_uri(), '--headless', '--nologo', '--nodefault', '--nofirststartwizard',
                 '--convert-to', 'pdf', '--outdir', tmp, source])
        except ValueError as error:
            if 'source file could not be loaded' in str(error):raise ValueError('Office 引擎无法读取此文件的内部结构或旧式对象。请在原应用中另存为现代格式后重试；未生成替代或空白 PDF。') from error
            raise
        out = tmp/'document.pdf'
        if not out.exists(): raise ValueError('Office 转换未生成 PDF；请检查文件是否加密或损坏')
        import fitz
        with fitz.open(out) as doc:
            if not len(doc): raise ValueError('转换结果为空')
            pages = len(doc)
        return result(out, pages=pages, engine='LibreOffice 26.2.7')

"""PDF/X production and explicitly scoped preflight, never an ISO certification."""
import base64, pathlib, tempfile, struct
import pikepdf
from conversion_engines import engine,run,result


def preflight(path):
    issues=[]
    with pikepdf.open(path) as pdf:
        version=str(pdf.docinfo.get('/GTS_PDFXVersion',''));intents=pdf.Root.get('/OutputIntents',[])
        intent=next((v for v in intents if str(v.get('/S',''))=='/GTS_PDFX'),None)
        if not version.startswith('PDF/X-'):issues.append({'code':'identification','message':'缺少 PDF/X 标识'})
        if pdf.is_encrypted:issues.append({'code':'encryption','message':'PDF/X 不允许加密'})
        if intent is None or not intent.get('/DestOutputProfile'):issues.append({'code':'output-intent','message':'缺少嵌入的印刷输出 ICC 配置'})
        if str(pdf.docinfo.get('/Trapped','')) not in ('/True','/False'):issues.append({'code':'trapped','message':'缺少明确的陷印标识'})
        for i,page in enumerate(pdf.pages):
            if '/TrimBox' not in page and '/ArtBox' not in page:issues.append({'code':'page-box','page':i+1,'message':'缺少 TrimBox 或 ArtBox'})
            if '/TrimBox' in page and '/ArtBox' in page:issues.append({'code':'page-box-conflict','page':i+1,'message':'不能同时有 TrimBox 和 ArtBox'})
        for obj in pdf.objects:
            if not isinstance(obj,(pikepdf.Dictionary,pikepdf.Stream)):continue
            if str(obj.get('/Type',''))=='/FontDescriptor' and not any(k in obj for k in ('/FontFile','/FontFile2','/FontFile3')):issues.append({'code':'font-not-embedded','object':list(obj.objgen),'message':'字体未嵌入'})
            if str(obj.get('/S','')) in ('/JavaScript','/Launch','/Movie','/Sound'):issues.append({'code':'action','object':list(obj.objgen),'message':'包含非印刷动作'})
            if version in ('PDF/X-1a:2001','PDF/X-3:2002') and (float(obj.get('/ca',1))!=1 or float(obj.get('/CA',1))!=1 or ('/SMask' in obj and str(obj.SMask)!='/None')):issues.append({'code':'transparency','object':list(obj.objgen),'message':'此 PDF/X 版本不允许透明度'})
        return {'standard':version or 'PDF/X','preflightPassed':not issues,'compliant':None,'validationLevel':'partial-preflight',
                'validator':'Folio structural print preflight','issues':issues[:1000],'issueCount':len(issues),
                'outputCondition':str(intent.get('/OutputConditionIdentifier','')) if intent else '',
                'scope':'检查标识、加密、输出意图、页面框、字体嵌入、动作和透明度。不是完整 ISO PDF/X 验证；交付印厂前需其专业预检。'}


def process(args):
    if args['action']=='preflight-pdfx':return preflight(args['input'])
    o=args.get('options') or {};standard=o.get('standard','x4')
    levels={'x1a':1,'x3':3,'x4':4}
    if standard not in levels:raise ValueError('支持 PDF/X-1a:2001、PDF/X-3:2002、PDF/X-4')
    with tempfile.TemporaryDirectory(prefix='folio-pdfx-') as tmp:
        tmp=pathlib.Path(tmp);out=tmp/'print.pdf';icc=tmp/'output.icc'
        supplied=o.get('icc')
        if supplied:
            try:data=base64.b64decode(supplied,validate=True)
            except Exception:raise ValueError('ICC 配置文件无效')
        else:data=(engine('icc').parent/'default_cmyk.icc').read_bytes()
        if not 128<=len(data)<=8*1024**2 or data[36:40]!=b'acsp' or data[16:20]!=b'CMYK' or struct.unpack('>I',data[:4])[0]!=len(data):raise ValueError('请提供有效的 CMYK ICC 输出配置文件，最大 8 MB')
        icc.write_bytes(data)
        condition=o.get('condition','Custom CMYK' if supplied else 'Generic CMYK proof')
        if not isinstance(condition,str) or len(condition)>256:raise ValueError('印刷条件名称无效')
        # Encode arbitrary Unicode as a PostScript hex string; no executable interpolation.
        label='<feff'+condition.encode('utf-16-be').hex()+'>';profile=icc.as_posix().replace('(','\\(').replace(')','\\)')
        version={'x1a':'PDF/X-1a:2001','x3':'PDF/X-3:2002','x4':'PDF/X-4'}[standard]
        definition=tmp/'intent.ps';definition.write_text('''%!
[/GTS_PDFXVersion ('''+version+''') /Title (Print production copy) /Trapped /False /DOCINFO pdfmark
[/_objdef {icc_PDFX} /type /stream /OBJ pdfmark
[{icc_PDFX} << /N 4 >> /PUT pdfmark
[{icc_PDFX} ('''+profile+''') (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFX} /type /dict /OBJ pdfmark
[{OutputIntent_PDFX} << /Type /OutputIntent /S /GTS_PDFX /DestOutputProfile {icc_PDFX}
/OutputConditionIdentifier '''+label+''' /Info '''+label+''' /RegistryName (http://www.color.org) >> /PUT pdfmark
[{Catalog} << /OutputIntents [{OutputIntent_PDFX}] >> /PUT pdfmark
''',encoding='ascii')
        run([engine('gs'),'-dSAFER','-dBATCH','-dNOPAUSE','-dQUIET','-sDEVICE=pdfwrite','-dPDFX='+str(levels[standard]),
             '-dPDFXCompatibilityPolicy=2','-sColorConversionStrategy=CMYK','-sOutputICCProfile='+str(icc),
             '-dEmbedAllFonts=true','-dAutoRotatePages=/None','--permit-file-read='+str(icc),'-sOutputFile='+str(out),definition,args['input']])
        report=preflight(out)
        if not report['preflightPassed']:raise ValueError('印刷预检发现错误，未保存：'+str(report['issues'][:5]))
        with pikepdf.open(args['input']) as source,pikepdf.open(out) as target:
            if len(source.pages)!=len(target.pages):raise ValueError('PDF/X 页数校验失败')
        return result(out,validation=report,warnings=[] if supplied else ['使用通用 CMYK 配置；正式印刷请改用印厂提供的 ICC。'])

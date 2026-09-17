"""Offline PDF decryption using the bundled libqpdf through pikepdf.
Passwords exist only in request memory and are never persisted or logged.
"""
from pathlib import Path

def process(args):
    import pikepdf
    password = args.pop('password', '')
    if not isinstance(password, str) or len(password) > 4096:
        raise ValueError('密码格式无效')
    try:
        pdf = pikepdf.open(args['input'], password=password)
    except pikepdf.PasswordError:
        return {'needsPassword': True, 'message': '需要正确的文档密码'}
    except pikepdf.PdfError:
        raise ValueError('无法读取 PDF：文件可能损坏或使用不支持的加密方式') from None
    finally:
        password = None
    with pdf:
        signed = False
        def scan(fields, depth=0):
            if depth > 32: return False
            for field in fields:
                if field.get('/FT') == '/Sig' and field.get('/V'): return True
                if scan(field.get('/Kids', []), depth + 1): return True
            return False
        try: signed = scan(pdf.Root.get('/AcroForm', {}).get('/Fields', []))
        except (ValueError, TypeError): pass
        info = {'needsPassword': False, 'encrypted': pdf.is_encrypted, 'signed': signed,
                'pages': len(pdf.pages), 'engine': 'libqpdf', 'engineVersion': pikepdf.__libqpdf_version__}
        if args['command'] == 'qpdf-decrypt':
            # Save rewrites object structure only, without rasterizing or flattening.
            pdf.save(args['output'], encryption=False)
            with pikepdf.open(args['output']) as check:
                if check.is_encrypted or len(check.pages) != info['pages']:
                    raise ValueError('解密结果校验失败')
            info['verified'] = True
        return info

"""Compose new documents while importing remapped outlines and annotations."""
import base64,io
from pathlib import Path
from pypdf import PdfReader,PdfWriter

def assemble(args):
    current=Path(args['input']).read_bytes() if 'input' in args else base64.b64decode(args['bytes'],validate=True)
    parts=args.get('parts',[{'current':True}])
    if not isinstance(parts,list) or not 1<=len(parts)<=100:raise ValueError('请选择 1–100 个文档片段')
    writer=PdfWriter();total=0
    for part in parts:
        raw=current if part.get('current') else base64.b64decode(part['data'],validate=True)
        total+=len(raw)
        if total>768*1024**2:raise ValueError('合并文档超过 768 MB 处理预算')
        reader=PdfReader(io.BytesIO(raw))
        if reader.is_encrypted:raise ValueError('请先解密要合并的 PDF')
        pages=part.get('pages',list(range(1,len(reader.pages)+1)))
        if not isinstance(pages,list) or not pages or any(type(p) is not int or not 1<=p<=len(reader.pages) for p in pages):raise ValueError('页码范围无效')
        if reader.get_fields():reader.add_form_topname('Document'+str(len(writer.pages)+1))
        writer.append(reader,pages=[p-1 for p in pages],import_outline=args.get('bookmarks',True))
    if not writer.pages:raise ValueError('输出文档不能为空')
    out=io.BytesIO();writer.write(out)
    return {'bytes':base64.b64encode(out.getvalue()).decode(),'pageCount':len(writer.pages)}

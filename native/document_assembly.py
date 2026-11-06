"""Compose new documents while importing remapped outlines and annotations."""
import base64,io,tempfile
from pathlib import Path
from pypdf import PdfReader,PdfWriter

def assemble(args):
    current=Path(args['input']).read_bytes() if 'input' in args else base64.b64decode(args['bytes'],validate=True)
    parts=args.get('parts',[{'current':True}])
    if not isinstance(parts,list) or not 1<=len(parts)<=100:raise ValueError('请选择 1–100 个文档片段')
    writer=PdfWriter();total=0;manifest=[]
    mode=args.get('bookmarkMode','preserve' if args.get('bookmarks',True) else 'none')
    if mode not in ('preserve','combined','files','none'):raise ValueError('书签模式无效')
    for part in parts:
        raw=current if part.get('current') else base64.b64decode(part['data'],validate=True)
        total+=len(raw)
        if total>768*1024**2:raise ValueError('合并文档超过 768 MB 处理预算')
        ext=str(part.get('format') or Path(part.get('name','file.pdf')).suffix.lstrip('.') or 'pdf').lower()
        if not part.get('current') and ext!='pdf':
            from conversion_engines import office
            with tempfile.TemporaryDirectory(prefix='folio-merge-') as tmp:
                source=Path(tmp)/('input.'+ext);source.write_bytes(raw)
                raw=base64.b64decode(office({'input':str(source),'options':{'extension':ext}})['bytes'])
        reader=PdfReader(io.BytesIO(raw))
        if reader.is_encrypted:raise ValueError('请先解密要合并的 PDF')
        pages=part.get('pages',list(range(1,len(reader.pages)+1)))
        if not isinstance(pages,list) or not pages or any(type(p) is not int or not 1<=p<=len(reader.pages) for p in pages):raise ValueError('页码范围无效')
        if reader.get_fields():reader.add_form_topname('Document'+str(len(writer.pages)+1))
        label=str(part.get('bookmark') or Path(part.get('name','Document')).stem)[:512]
        writer.append(reader,pages=[p-1 for p in pages],import_outline=mode in ('preserve','combined'),outline_item=label if mode in ('combined','files') else None)
        manifest.append({'name':part.get('name','Current document'),'startPage':len(writer.pages)-len(pages)+1,'pages':len(pages),'format':ext})
    if not writer.pages:raise ValueError('输出文档不能为空')
    out=io.BytesIO();writer.write(out)
    if out.tell()>80*1024**2:raise ValueError('合并输出超过 80 MB，请拆成较小批次')
    return {'bytes':base64.b64encode(out.getvalue()).decode(),'pageCount':len(writer.pages),'manifest':manifest,'bookmarkMode':mode}

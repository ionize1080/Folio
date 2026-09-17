"""Export a reviewed table as text cells; XLSX never evaluates PDF content."""
import base64,csv,io,zipfile
from xml.sax.saxutils import escape

def export(table,kind):
    rows,cols=table['rows'],table['columns']
    if not isinstance(rows,int) or not isinstance(cols,int) or rows<1 or cols<1 or rows*cols>1000:raise ValueError('表格范围无效')
    cells=table['cells'];grid=[['']*cols for _ in range(rows)];merges=[]
    def column(i):
        s=''
        while i>=0:s=chr(65+i%26)+s;i=i//26-1
        return s
    def ref(r,c):return column(c)+str(r+1)
    for cell in cells:
        r,c=cell['row'],cell['column'];rs,cs=cell.get('rowSpan',1),cell.get('colSpan',1)
        if not 0<=r<rows or not 0<=c<cols or not 1<=rs<=rows-r or not 1<=cs<=cols-c:raise ValueError('单元格范围无效')
        text=str(cell['model']['text'])
        if len(text)>32767:raise ValueError('单元格超过 Excel 的 32767 字符限制')
        grid[r][c]=text
        if rs>1 or cs>1:merges.append(ref(r,c)+':'+ref(r+rs-1,c+cs-1))
    if kind in ('csv','tsv'):
        buf=io.StringIO(newline='');writer=csv.writer(buf,delimiter=',' if kind=='csv' else '\t',lineterminator='\r\n')
        # Spreadsheet programs may auto-evaluate formula-looking CSV cells.
        writer.writerows([["'"+v if v.lstrip().startswith(('=','+','@')) else v for v in row] for row in grid])
        return {'base64':base64.b64encode(('\ufeff'+buf.getvalue()).encode()).decode()}
    if kind!='xlsx':raise ValueError('导出格式无效')
    ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    data=''.join('<row r="%d">%s</row>'%(r+1,''.join('<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'%(ref(r,c),escape(v)) for c,v in enumerate(row))) for r,row in enumerate(grid))
    sheet=f'<worksheet xmlns="{ns}"><sheetData>{data}</sheetData>'
    if merges:sheet+='<mergeCells count="%d">%s</mergeCells>'%(len(merges),''.join('<mergeCell ref="'+s+'"/>' for s in merges))
    sheet+='</worksheet>'
    contents={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="表格" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml':sheet}
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
        for name,text in contents.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+text)
    return {'base64':base64.b64encode(buf.getvalue()).decode()}

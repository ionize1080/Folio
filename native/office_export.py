"""Grounded Office reconstruction: AI may assign structure, never invent cell text."""
import base64, contextlib, io, pathlib, re, tempfile, collections
import fitz
from conversion_engines import result

def selected(doc, options):
    pages = options.get('pages') or list(range(1, len(doc)+1))
    if not isinstance(pages, list) or not 1 <= len(pages) <= 100 or len(set(pages)) != len(pages):
        raise ValueError('请选择 1–100 个不重复页码')
    if any(type(p) is not int or p < 1 or p > len(doc) for p in pages): raise ValueError('页码无效')
    return pages

def extract(doc, pages):
    out = []
    for number in pages:
        page = doc[number-1]; words = []; blocks = []
        for i, w in enumerate(page.get_text('words', sort=True)):
            words.append({'id': f'p{number}w{i}', 'text': w[4], 'box': [round(x,2) for x in w[:4]]})
        for i, block in enumerate(page.get_text('dict', sort=True)['blocks']):
            if block['type'] != 0: continue
            spans = [s for line in block['lines'] for s in line['spans']]
            text = '\n'.join(''.join(s['text'] for s in line['spans']) for line in block['lines'])
            if not text.strip(): continue
            blocks.append({'id':f'p{number}b{i}', 'text':text, 'box':list(block['bbox']),
                           'size':max(s['size'] for s in spans), 'font':spans[0]['font'],
                           'leftAligned':len(block['lines'])>2 and max(line['bbox'][0] for line in block['lines'][1:])-min(line['bbox'][0] for line in block['lines'][1:])<1.5})
        tables = []
        for i, table in enumerate(page.find_tables().tables):
            cells = []
            x_edges=sorted({round(cell[j],2) for row in table.rows for cell in row.cells if cell for j in (0,2)})
            y_edges=sorted({round(cell[j],2) for row in table.rows for cell in row.cells if cell for j in (1,3)})
            for r, row in enumerate(table.rows):
                for c, box in enumerate(row.cells):
                    if box is None: continue
                    rect = fitz.Rect(box)
                    ids = [w['id'] for w in words if rect.contains(fitz.Point((w['box'][0]+w['box'][2])/2,(w['box'][1]+w['box'][3])/2))]
                    row_span=1;col_span=1
                    if len(y_edges)==table.row_count+1:
                        while r+row_span<table.row_count and y_edges[r+row_span]<rect.y1-.5:row_span+=1
                    if len(x_edges)==table.col_count+1:
                        while c+col_span<table.col_count and x_edges[c+col_span]<rect.x1-.5:col_span+=1
                    cells.append({'row':r,'col':c,'wordIds':ids,'rowSpan':row_span,'colSpan':col_span})
            tables.append({'id':f'p{number}t{i}', 'rows':table.row_count,'cols':table.col_count,'cells':cells})
        out.append({'page':number,'width':page.rect.width,'height':page.rect.height,'words':words,'blocks':blocks,'tables':tables,
                    'scanned':len(words)<3})
    if sum(len(p['words']) for p in out)>100000: raise ValueError('文字量过大，请分批转换')
    return {'pages':out, 'schemaVersion':1}

def reviewed(plan, review):
    """Validate all AI references, dimensions, coverage and merges before applying."""
    if not review: return {}, []
    if not isinstance(review, dict) or not isinstance(review.get('pages'), list): raise ValueError('AI 结构报告无效')
    refs = {p['page']:p for p in plan['pages']}; output = {}; warnings = []
    for item in review['pages']:
        number=item.get('page')
        if number not in refs or number in output: raise ValueError('AI 引用了未知或重复页面')
        p=refs[number]; wordmap={w['id']:w for w in p['words']}; blockids={b['id'] for b in p['blocks']}
        headings=item.get('headings',[]); tables=item.get('tables',[])
        for h in headings:
            if h.get('blockId') not in blockids or type(h.get('level')) is not int or not 1<=h['level']<=6: raise ValueError('AI 标题引用无效')
        used=set()
        for table in tables:
            rows=table.get('rows');cols=table.get('cols')
            if type(rows)!=int or type(cols)!=int or not 1<=rows<=2000 or not 1<=cols<=100 or rows*cols>20000: raise ValueError('AI 表格尺寸无效')
            occupied=set()
            for cell in table.get('cells',[]):
                r=cell.get('row');c=cell.get('col');rs=cell.get('rowSpan',1);cs=cell.get('colSpan',1);ids=cell.get('wordIds')
                if any(type(v)!=int for v in (r,c,rs,cs)) or r<0 or c<0 or rs<1 or cs<1 or r+rs>rows or c+cs>cols: raise ValueError('AI 单元格位置无效')
                positions={(y,x) for y in range(r,r+rs) for x in range(c,c+cs)}
                if occupied & positions: raise ValueError('AI 单元格重叠')
                occupied |= positions
                if not isinstance(ids,list) or any(w not in wordmap or w in used for w in ids): raise ValueError('AI 单元格原文引用无效或重复')
                if len(set(ids))!=len(ids):raise ValueError('AI 单元格重复文字')
                used.update(ids)
                # Any model-provided text/formula is ignored. Values only come from source tokens.
        output[number]={'headings':headings,'tables':tables}
    missing=set(refs)-set(output)
    if missing: warnings.append('部分页面未得到 AI 复核：'+','.join(map(str,sorted(missing))))
    return output,warnings

def text_for(ids, words):
    parts=[words[x]['text'] for x in ids]
    return ' '.join(parts)

def literal(cell, value):
    cell.value=value
    # PDF text beginning with =,+,-,@ must never become a spreadsheet formula.
    if isinstance(value,str):cell.data_type='s'

def excel(plan, review, path, options):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.comments import Comment
    from openpyxl.utils import get_column_letter
    wb=Workbook();wb.remove(wb.active);count=0;text_sheets=0;assigned=0;total=sum(len(p['words']) for p in plan['pages'])
    audit=wb.create_sheet('Source');audit.append(['Page','Token','Original text','Left','Top','Right','Bottom'])
    for p in plan['pages']:
        words={w['id']:w for w in p['words']}
        for w in p['words']:
            audit.append([p['page'],w['id'],None,*w['box']]);literal(audit.cell(audit.max_row,3),w['text'])
        tables=review.get(p['page'],{}).get('tables') or p['tables']
        fallback=not tables
        if not tables:
            # Preserve arbitrary content as a readable line grid, without claiming it is a detected table.
            lines=[]
            for w in p['words']:
                if not lines or abs(lines[-1][0]-w['box'][1])>3:lines.append((w['box'][1],[]))
                lines[-1][1].append(w['id'])
            tables=[{'rows':max(1,len(lines)),'cols':1,'cells':[{'row':i,'col':0,'wordIds':ids} for i,(_,ids) in enumerate(lines)]}]
        for ti,table in enumerate(tables):
            ws=wb.create_sheet(f'Page {p["page"]} Text' if fallback else f'Page {p["page"]} Table {ti+1}');ws.freeze_panes='A2';ws.sheet_view.showGridLines=False
            ws.sheet_properties.pageSetUpPr.fitToPage=True;ws.page_setup.orientation='landscape';ws.page_setup.paperSize=ws.PAPERSIZE_A4
            seen=set()
            for data in table['cells']:
                ids=data['wordIds'];seen.update(ids);cell=ws.cell(data['row']+1,data['col']+1);value=text_for(ids,words)
                if options.get('numeric',True) and re.fullmatch(r'-?(?:0|[1-9]\d{0,13})(?:\.\d+)?%?',value):
                    cell.value=float(value.rstrip('%'))/(100 if value.endswith('%') else 1)
                    if value.endswith('%'):cell.number_format='0.00%'
                else:literal(cell,value)
                cell.comment=Comment('Source page '+str(p['page'])+'; tokens '+', '.join(ids),'Folio')
                rs=data.get('rowSpan',1);cs=data.get('colSpan',1)
                if rs>1 or cs>1:ws.merge_cells(start_row=cell.row,start_column=cell.column,end_row=cell.row+rs-1,end_column=cell.column+cs-1)
            if fallback:text_sheets+=1
            else:assigned+=len(seen);count+=1
            for row in ws:
                for cell in row:
                    cell.alignment=Alignment(vertical='top',wrap_text=True)
                    cell.border=Border(bottom=Side(style='hair',color='D7DEE8'))
                    if cell.row==1:cell.font=Font(bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='263E58')
            for col in range(1,table['cols']+1):
                width=max([len(str(ws.cell(r,col).value or '')) for r in range(1,min(table['rows']+1,100))]+[10])
                ws.column_dimensions[get_column_letter(col)].width=min(55,max(12,width+2))
            if table['cols']==1:ws.column_dimensions['A'].width=95
            ws.print_options.horizontalCentered=True;ws.print_title_rows='1:1'
    audit.freeze_panes='A2';audit.auto_filter.ref=audit.dimensions;audit.column_dimensions['C'].width=60
    wb.active=1 if len(wb.worksheets)>1 else 0;wb.save(path)
    return {'tables':count,'textSheets':text_sheets,'sheets':count+text_sheets,'sourceTokens':total,'tableTokens':assigned,'sourceCoverage':1.0,'sourceSheet':'Source'}

def all_paragraphs(doc):
    yield from doc.paragraphs
    for t in doc.tables:
        for row in t.rows:
            for c in row.cells:
                yield from all_paragraphs(c)


def repair_word_geometry(doc,plan):
    """Correct inconsistent OOXML table grids and alignment using source geometry."""
    import numpy as np
    from docx.shared import Twips
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    normalize=lambda text:re.sub(r'\s+','',text)
    left=[normalize(b['text']) for page in plan['pages'] for b in page['blocks'] if b.get('leftAligned')]
    seen=set();aligned=0
    for para in all_paragraphs(doc):
        if para._p in seen:continue
        seen.add(para._p);text=normalize(para.text)
        if len(text)>100 and any(text in source for source in left):para.alignment=WD_ALIGN_PARAGRAPH.LEFT;aligned+=1
        for run in para.runs:
            name=run.font.name or ''
            # Explicit metric-compatible aliases; do not replace arbitrary fonts.
            for prefix,replacement in [('NimbusRomNo9L','Times New Roman'),('NimbusRoman','Times New Roman'),('NimbusMonL','Courier New'),('NimbusMono','Courier New'),('NimbusSanL','Arial'),('NimbusSans','Arial')]:
                if name.startswith(prefix):run.font.name=replacement;break
    fixed=0
    def tables(parent):
        seen=set()
        for table in parent.tables:
            yield table
            for row in table.rows:
                for cell in row.cells:
                    if cell._tc not in seen:seen.add(cell._tc);yield from tables(cell)
    for table in tables(doc):
        n=len(table.columns);a=[];b=[]
        if not n or n>100:continue
        for row in table._tbl.tr_lst:
            col=0
            for cell in row.tc_lst:
                props=cell.tcPr;span=props.gridSpan.val if props.gridSpan is not None else 1
                if props.tcW is not None and props.tcW.type=='dxa' and (props.vMerge is None or props.vMerge.val=='restart') and col+span<=n:
                    equation=[0]*n;equation[col:col+span]=[1]*span;a.append(equation);b.append(props.tcW.w)
                col+=span
        if not a:continue
        widths,_,rank,_=np.linalg.lstsq(np.asarray(a),np.asarray(b),rcond=None)
        if rank==n and min(widths)>0 and max(abs(np.asarray(a)@widths-b))<30:
            for column,width in zip(table.columns,widths):column.width=Twips(round(width))
            table.autofit=False;fixed+=1
    return {'correctedTableGrids':fixed,'sourceAlignedParagraphs':aligned}

def word(source, plan, review, path, options):
    from docx import Document
    from docx.shared import Pt, Inches
    if options.get('layout','faithful')=='faithful':
        from pdf2docx import Converter
        with contextlib.redirect_stdout(__import__('sys').stderr):
            cv=Converter(str(source))
            try:cv.convert(str(path),pages=[p['page']-1 for p in plan['pages']],multi_processing=False)
            finally:cv.close()
        doc=Document(path)
        geometry=repair_word_geometry(doc,plan)
        headingmap={re.sub(r'\s+','',b['text']):h['level'] for p in plan['pages'] for h in review.get(p['page'],{}).get('headings',[]) for b in p['blocks'] if b['id']==h['blockId']}
        for para in list(all_paragraphs(doc)):
            level=headingmap.get(re.sub(r'\s+','',para.text))
            if level:para.style='Heading '+str(level)
            elif '\n' in para.text:
                first=para.text.split('\n',1)[0];level=headingmap.get(re.sub(r'\s+','',first))
                if level:
                    # pdf2docx may combine a heading and its following paragraph.
                    # Split at the existing line break, keeping every original run's formatting.
                    from copy import deepcopy
                    from docx.oxml import OxmlElement
                    from docx.text.paragraph import Paragraph
                    from docx.text.run import Run
                    boundary=len(first)+1;new=OxmlElement('w:p');para._p.addnext(new);body=Paragraph(new,para._parent)
                    if para._p.pPr is not None:new.append(deepcopy(para._p.pPr))
                    position=0;runs=[(deepcopy(r._r),r.text) for r in para.runs];para.clear()
                    for element,text in runs:
                        cut=max(0,min(len(text),boundary-position));left=text[:cut];right=text[cut:]
                        if left:
                            copy=deepcopy(element);para._p.append(copy);Run(copy,para).text=left.rstrip('\n')
                        if right:
                            copy=deepcopy(element);body._p.append(copy);Run(copy,body).text=right
                        position+=len(text)
                    para.style='Heading '+str(level)
    else:
        doc=Document();doc.styles['Normal'].font.name='Calibri';doc.styles['Normal'].font.size=Pt(11)
        for pi,p in enumerate(plan['pages']):
            if pi:doc.add_page_break()
            headingmap={h['blockId']:h['level'] for h in review.get(p['page'],{}).get('headings',[])}
            tables=review.get(p['page'],{}).get('tables') or p['tables'];words={w['id']:w for w in p['words']};table_ids={x for t in tables for c in t['cells'] for x in c['wordIds']}
            events=[]
            for block in p['blocks']:
                rect=fitz.Rect(block['box']);ids=[w['id'] for w in p['words'] if rect.contains(fitz.Point((w['box'][0]+w['box'][2])/2,(w['box'][1]+w['box'][3])/2))]
                remaining=[i for i in ids if i not in table_ids]
                if ids and not remaining:continue
                text=block['text'] if len(remaining)==len(ids) else text_for(remaining,words)
                events.append((rect.y0,rect.x0,'text',(block,text)))
            for table in tables:
                tokens=[words[x] for cell in table['cells'] for x in cell['wordIds']]
                events.append((min((w['box'][1] for w in tokens),default=p['height']),min((w['box'][0] for w in tokens),default=0),'table',table))
            with fitz.open(source) as pdf:
                for block in pdf[p['page']-1].get_text('dict')['blocks']:
                    if block['type']!=1:continue
                    box=fitz.Rect(block['bbox'])
                    if p['page'] in options.get('ocrPages',[]) and box.get_area()>.85*p['width']*p['height']:continue
                    events.append((box.y0,box.x0,'image',block))
            for _,__,kind,event in sorted(events,key=lambda item:(item[0],item[1])):
                if kind=='text':
                    block,text=event
                    if block['id'] in headingmap:doc.add_heading(text,level=headingmap[block['id']])
                    else:doc.add_paragraph(text.replace('\n',' '))
                elif kind=='table':
                    tab=doc.add_table(rows=event['rows'],cols=event['cols']);tab.style='Table Grid'
                    for cell_data in event['cells']:
                        cell=tab.cell(cell_data['row'],cell_data['col']);rs=cell_data.get('rowSpan',1);cs=cell_data.get('colSpan',1)
                        if rs>1 or cs>1:cell=cell.merge(tab.cell(cell_data['row']+rs-1,cell_data['col']+cs-1))
                        cell.text=text_for(cell_data['wordIds'],words)
                else:
                    try:doc.add_picture(io.BytesIO(event['image']),width=Inches(min(6,(event['bbox'][2]-event['bbox'][0])/72)))
                    except Exception:pass
    doc.core_properties.comments='Converted by Folio. AI structure uses source references; text is never generated.'
    doc.save(path)
    original=collections.Counter(re.sub(r'\s+','', ''.join(b['text'] for p in plan['pages'] for b in p['blocks'])))
    actual=collections.Counter(re.sub(r'\s+','', ''.join(t.text or '' for t in doc.element.xpath('.//w:t'))))
    covered=sum((original&actual).values());total=sum(original.values())
    return {'textCoverage':round(covered/max(1,total),4),'layout':options.get('layout','faithful'), 'editable':True,**(geometry if options.get('layout','faithful')=='faithful' else {})}

def process(args):
    options=args.get('options') or {}
    with fitz.open(args['input']) as doc:
        if doc.needs_pass:raise ValueError('请先解密文档')
        plan=extract(doc,selected(doc,options))
    if args['action']=='conversion-plan':return plan
    review,warnings=reviewed(plan, options.get('review'))
    if any(p['scanned'] for p in plan['pages']):warnings.append('部分页面缺少文本层；请先 OCR 后导出，以获得可编辑的文字和表格。')
    ext='docx' if args['action']=='export-word' else 'xlsx'
    with tempfile.TemporaryDirectory(prefix='folio-export-') as tmp:
        path=pathlib.Path(tmp)/('converted.'+ext)
        metrics=word(args['input'],plan,review,path,options) if ext=='docx' else excel(plan,review,path,options)
        if metrics.get('textCoverage',1)<.98:warnings.append('原文覆盖检查低于 98%，请复核或切换流动文本模式。')
        return result(path,metrics=metrics,warnings=warnings,aiReviewed=bool(review),pages=len(plan['pages']))

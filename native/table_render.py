"""Render an explicitly corrected bounded rectangular table using the text engine."""
import base64,copy

def render(table):
 import fitz
 from story import layout
 t=table;rows=int(t['rows']);cols=int(t['columns'])
 if not 1<=rows*cols<=1000:raise ValueError('表格过大')
 x,y,x1,y1=t['bounds'];xs=[x];ys=[y]
 for width in t['widths']:
  if width<12:raise ValueError('列宽不足')
  xs.append(xs[-1]+width)
 for height in t['heights']:
  if height<10:raise ValueError('行高不足')
  ys.append(ys[-1]+height)
 if abs(xs[-1]-x1)>.1 or abs(ys[-1]-y1)>.1:raise ValueError('表格边界不一致')
 doc=fitz.open();page=doc.new_page(width=t['pageWidth'],height=t['pageHeight']);glyphs=[];used=set();fallback=0
 for cell in t['cells']:
  r,c=cell['row'],cell['column'];rs=cell.get('rowSpan',1);cs=cell.get('colSpan',1)
  if min(r,c)<0 or r+rs>rows or c+cs>cols:raise ValueError('单元格超出表格')
  for rr in range(r,r+rs):
   for cc in range(c,c+cs):
    if (rr,cc) in used:raise ValueError('单元格重叠')
    used.add((rr,cc))
  rect=fitz.Rect(xs[c],ys[r],xs[c+cs],ys[r+rs]);fill=cell.get('fill');stroke=cell.get('stroke') or [0,0,0]
  page.draw_rect(rect,color=stroke,fill=fill,width=cell.get('borderWidth',.5),overlay=True)
  m=copy.deepcopy(cell['model']);pad=max(1,min(cell.get('padding',3),rect.width/4));m.update(frame={'x':rect.x0+pad,'y':rect.y0+pad,'width':max(10,rect.width-2*pad),'height':max(10,rect.height-2*pad)},pageWidth=t['pageWidth'],pageHeight=t['pageHeight'],columns=1,allowOverflow=False);m.pop('frames',None)
  if m['text'].strip():
   result=layout(m)
   if result['overflow'] or not result['mappingComplete']:raise ValueError(f'第 {r+1} 行、第 {c+1} 列文字放不下，请缩短文字或调整行列尺寸')
   src=fitz.open(stream=base64.b64decode(result['fragment']),filetype='pdf');page.show_pdf_page(page.rect,src,0);src.close();glyphs.extend(result['glyphs']);fallback+=result['fallbackCount']
 if len(used)!=rows*cols:raise ValueError('表格结构缺格')
 blob=doc.tobytes(garbage=3,deflate=True);svg=page.get_svg_image(text_as_path=True);doc.close()
 return {'fragment':base64.b64encode(blob).decode(),'svg':svg,'glyphs':glyphs,'fallbackCount':fallback}

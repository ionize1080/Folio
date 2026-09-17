from pathlib import Path
import fitz
out=Path(__file__).parent/'output';out.mkdir(exist_ok=True)
doc=fitz.open();p=doc.new_page(width=600,height=800)
p.insert_text((45,65),'Folio editing workspace',fontname='hebo',fontsize=20,color=(.12,.2,.35))
p.insert_text((45,100),'Short title',fontsize=14)
p.insert_textbox(fitz.Rect(45,130,285,280),'Left column paragraph. Original text stays in its own column. Edit text directly on this page. '*4,fontsize=11)
p.insert_textbox(fitz.Rect(325,130,560,280),'Right column paragraph stays independent. Keep the original font and layout. '*4,fontsize=11)
for row in range(4):
 for col in range(3):
  box=fitz.Rect(45+col*170,340+row*45,45+(col+1)*170,340+(row+1)*45)
  p.draw_rect(box,color=(.3,.35,.4),fill=(.88,.92,.96) if row==0 else None,width=.5)
  p.insert_text((box.x0+8,box.y0+22),f'Cell {row+1}-{col+1}',fontsize=11)
p.insert_text((45,650),'Unrelated footer must stay here.',fontsize=11)
doc.save(out/'v9-fixture.pdf');doc.close()

from pathlib import Path
import fitz
out=Path(__file__).resolve().parent/'output';out.mkdir(exist_ok=True)
doc=fitz.open()
for i in range(3):
    page=doc.new_page(width=420,height=595)
    page.insert_text((36,50),'Folio 2025',fontsize=20)
    page.insert_textbox(fitz.Rect(36,85,384,200),'This paragraph preserves the original text positions. The 2025 report includes a second line for paragraph editing and a visible baseline for comparison.',fontsize=14)
    page.insert_textbox(fitz.Rect(36,220,384,350),'中文段落编辑测试。保留原文字位、字体和行距，修改数字 2025 后保存，再次打开验证原位布局。',fontname='china-s',fontsize=14)
doc.set_toc([[1,'First',1],[1,'Second',2],[1,'Third',3]])
doc.save(out/'workflow-250-source.pdf')

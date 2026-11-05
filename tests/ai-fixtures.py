from pathlib import Path
import pymupdf as fitz
out=Path("tests/output");out.mkdir(parents=True,exist_ok=True)
d=fitz.open()
for i in range(6):
 p=d.new_page(width=595,height=842)
 p.insert_text((65,120),f"Chapter {i+1}",fontsize=28)
 p.insert_text((65,170),"A local PDF test. No private content.",fontsize=14)
d.set_toc([[1 if i%2==0 else 2,f"Chapter {i+1}",min(i+2,6)] for i in range(6)])
d.save(out/"ai-202.pdf")

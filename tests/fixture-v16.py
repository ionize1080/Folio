from pathlib import Path
import fitz
out=Path(__file__).parent/'output'
with fitz.open(out/'v9-fixture.pdf') as source,fitz.open() as result:
 page=result.new_page(width=600,height=800)
 page.insert_image(page.rect,stream=source[0].get_pixmap(matrix=fitz.Matrix(1,1)).tobytes('png'))
 result.save(out/'v16-image.pdf')

from pathlib import Path
import fitz
root=Path(__file__).resolve().parent/'output'
with fitz.open(root/'v172-table.pdf') as a,fitz.open(root/'v172-table-saved.pdf') as b:
 assert len(b)==6
 clip=fitz.Rect(488,396,516,424)
 assert a[0].get_pixmap(matrix=fitz.Matrix(3,3),clip=clip).samples==b[0].get_pixmap(matrix=fitz.Matrix(3,3),clip=clip).samples
 assert 'Edited table retained' in b[0].get_text()
 assert 'Reviewed OCR retained' in b[0].get_text()
print('Saved table decoration pixel equality and native/OCR text verified')

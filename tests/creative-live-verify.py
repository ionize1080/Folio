"""Independently inspect pixels, PDF vectors, page isolation and real AI output order."""
import io,json,sys
from pathlib import Path
import fitz
from PIL import Image
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
from creative_graphics import inspect
out=root/'tests/output'
im=Image.open(out/'creative-live-raster.png').convert('RGB')
green=sum(g>100 and g>r*1.4 and g>b*1.2 for r,g,b in im.getdata());assert green>20,'Expected actual green brush pixels'
source=fitz.open(out/'creative-source.pdf');edited=fitz.open(out/'creative-live.pdf');organized=fitz.open(out/'creative-live-organized.pdf')
pixels=lambda p:p.get_pixmap(alpha=True).samples
assert pixels(edited[0])!=pixels(source[0]);assert pixels(edited[1])==pixels(source[1])
assert len(organized)==3
assert pixels(organized[0])==pixels(edited[1]);assert pixels(organized[1])==pixels(edited[0])==pixels(organized[2])
pdf=PdfReader(out/'creative-live.pdf');graphics=inspect(pdf.pages[0]);assert {g['kind'] for g in graphics}=={'photo','vector'}
assert len(edited[0].get_drawings())>len(source[0].get_drawings()),'Vector work must remain vector paths in PDF'
assert 'Qwen vector' in edited[0].get_text(),'Vector text must survive PDF export'
assert not pdf.attachments,'PDF must not embed native artwork source documents'
print(json.dumps({'greenBrushPixels':green,'nativeGraphics':len(graphics),'vectorPaths':len(edited[0].get_drawings()),'neighborPageIdentical':True,'organizedPageCount':3,'organizedPixelsExact':True,'sourceAttachments':0}))

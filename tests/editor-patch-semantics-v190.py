"""Same-length native-font patches retain logical spaces and exact copy text."""
from pathlib import Path
import sys,json,io
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'native'),str(ROOT/'native/vendor')]
import fitz,pypdfium2 as pdfium
from pypdf import PdfReader,PdfWriter
from p8_helpers import models,save,pixels,dump,OUT
checks=[]
def pdfium_pixels(data,n=0,left=0,top=0):
    with pdfium.PdfDocument(data)as pdf:
        page=pdf[n];bitmap=page.render(scale=2);image=bitmap.to_pil()
        result=image.crop((round(left*2),round(top*2),image.width,image.height)).tobytes()
        bitmap.close();page.close();return result
doc=fitz.open();doc.new_page(width=300,height=200);doc.new_page(width=300,height=200)
doc[0].insert_text((30,50),'Content for Motivation',fontsize=12)
doc[0].insert_text((30,120),'Untouched neighbor',fontsize=12)
doc[1].insert_text((30,50),'Untouched sibling',fontsize=12)
raw=doc.tobytes();doc.close()
writer=PdfWriter();writer.clone_document_from_reader(PdfReader(io.BytesIO(raw)));writer.pdf_header='%PDF-1.3';raw=dump(writer)
_,ms=models(raw);model=next(m for m in ms if m['text']=='Content for Motivation')
model['text']='oontent for Motivation';first=save(raw,model)
def verify(data,text):
    inspection,ms=models(data)
    group=next(m for m in ms if m['text']==text)
    assert group['softBreaks']==[] and not group.get('styleMappingWarning')
    desc=[o for o in inspection['objects'] if o.get('flowText')==text]
    assert desc and all(o.get('flowSoftBreaks')==[] for o in desc)
    assert ''.join(o['text'] for o in desc)==text,[o['text'] for o in desc]
    with fitz.open(stream=data,filetype='pdf')as pdf:assert pdf[0].get_text().splitlines()==[text,'Untouched neighbor']
    with pdfium.PdfDocument(data)as pdf:
        page=pdf[0];tp=page.get_textpage()
        assert tp.get_text_range().splitlines()==[text,'Untouched neighbor']
        tp.close();page.close()
    assert pixels(raw,1)==pixels(data,1)
    assert pixels(raw,clip=fitz.Rect(40,0,300,200))==pixels(data,clip=fitz.Rect(40,0,300,200))
    assert pdfium_pixels(raw,1)==pdfium_pixels(data,1)
    assert pdfium_pixels(raw,left=40)==pdfium_pixels(data,left=40)
    return group
again=verify(first,model['text'])
reader=PdfReader(io.BytesIO(first));assert reader.trailer['/Root'].get('/Version')=='/1.4'
checks.append('narrow glyph in original wider slot copies exact text in MuPDF/PDFium and restores exact Folio text/soft breaks; other glyphs, neighbor and sibling pixels match')
# A subsequent real replacement exercises the protected ActualText scope.
again['text']='oontent for Motivatioo'
last=save(first,again)
inspection,ms=models(last)
assert any(m['text']==again['text'] and m['softBreaks']==[] for m in ms)
with fitz.open(stream=last,filetype='pdf')as pdf:assert pdf[0].get_text().splitlines()==[again['text'],'Untouched neighbor']
assert pixels(raw,1)==pixels(last,1)
assert pixels(raw,clip=fitz.Rect(0,100,300,200))==pixels(last,clip=fitz.Rect(0,100,300,200))
assert pdfium_pixels(raw,1)==pdfium_pixels(last,1)
assert pdfium_pixels(raw,top=100)==pdfium_pixels(last,top=100)
checks.append('saved native-font patch accepts second edit/save/reopen with exact logical text and unchanged neighbor/sibling pixels')
doc=fitz.open();page=doc.new_page(width=300,height=200)
page.insert_font(fontname='CJK',fontfile=str(ROOT/'native/fonts/NotoSansSC.ttf'))
page.insert_text((30,50),'甲i乙',fontname='CJK',fontsize=12)
doc.subset_fonts();raw=doc.tobytes();doc.close();_,ms=models(raw);model=next(m for m in ms if m['text']=='甲i乙')
model['text']='ii乙';saved=save(raw,model)
with fitz.open(stream=saved,filetype='pdf')as pdf:assert pdf[0].get_text().strip()==model['text']
with pdfium.PdfDocument(saved)as pdf:
    page=pdf[0];tp=page.get_textpage();assert tp.get_text_range().strip()==model['text'];tp.close();page.close()
assert pixels(raw,clip=fitz.Rect(42,0,300,200))==pixels(saved,clip=fitz.Rect(42,0,300,200))
assert pdfium_pixels(raw,left=42)==pdfium_pixels(saved,left=42)
_,ms=models(saved);assert any(m['text']==model['text'] for m in ms)
checks.append('CID font width copy preserves later glyph pixels and exact copy/reopen text; ActualText raises underdeclared PDF 1.3 to 1.4')
report={'checks':checks,'errors':[]};(OUT/'v190-patch-semantics-report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))

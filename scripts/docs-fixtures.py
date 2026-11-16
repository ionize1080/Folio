"""Generate public documentation fixtures from constants only. Never reads user PDFs."""
from pathlib import Path
import io
import fitz
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'examples'
OUT.mkdir(parents=True, exist_ok=True)
blue = (0.10, 0.30, 0.62)
ink = (0.12, 0.18, 0.27)
doc = fitz.open()
titles = ['01  Project overview', '02  Reading and bookmarks', '03  Editable text', '04  Image and vector artwork', '05  Tables and export', '06  Review and publish']
for i, title in enumerate(titles):
    p = doc.new_page(width=595, height=842)
    p.draw_rect(fitz.Rect(0, 0, 595, 12), color=None, fill=blue)
    p.insert_text((48, 54), 'FOLIO / PUBLIC DEMO', fontsize=11, color=blue)
    p.insert_text((48, 110), title, fontsize=25, color=ink)
    p.insert_text((48, 145), '合成演示文档 · 不含真实个人、客户或业务资料', fontname='china-s', fontsize=12, color=blue)
    p.insert_textbox(fitz.Rect(48, 177, 540, 258), 'This fictional field guide demonstrates reading, bookmark organization,\ntext editing and local document workflows in Folio. Every name, number\nand illustration was created solely for this public demonstration.', fontsize=12, lineheight=1.55, color=ink)
    if i == 0:
        for j, t in enumerate(titles[1:]):
            y = 315 + j * 57
            p.draw_line((48, y + 17), (540, y + 17), color=(.85,.88,.93))
            p.insert_text((52,y), t, fontsize=15, color=ink)
            p.insert_text((520,y), str(j+2), fontsize=14, color=blue)
        p.insert_text((48,665), 'A small document. A complete workflow.', fontsize=20, color=blue)
    elif i == 3:
        im=Image.new('RGB',(1200,600),(231,240,247)); d=ImageDraw.Draw(im)
        d.ellipse((740,70,930,260),fill=(255,194,106))
        d.polygon([(0,540),(280,180),(600,540)],fill=(53,111,145))
        d.polygon([(300,600),(730,230),(1200,600)],fill=(79,151,160))
        d.polygon([(0,600),(0,510),(530,420),(1200,535),(1200,600)],fill=(32,78,116))
        stream=io.BytesIO();im.save(stream,format='PNG')
        p.insert_image(fitz.Rect(48,295,547,545),stream=stream.getvalue())
        p.insert_text((48,580),'Synthetic landscape / editable image object',fontsize=13,color=blue)
        for j, label in enumerate(['Read','Review','Publish']):
            x=48+j*175
            p.draw_rect(fitz.Rect(x,635,x+140,690),color=blue,fill=(.93,.96,.99))
            p.insert_text((x+35,668),label,fontsize=14,color=ink)
            if j<2:p.draw_line((x+140,662),(x+175,662),color=blue,width=2)
    elif i == 4:
        rows=[['Stage','Demo units','Status'],['Reading','0120','Complete'],['Editing','0048','Review'],['Export','0036','Ready']]
        for r,row in enumerate(rows):
            for c,value in enumerate(row):
                x,y=48+c*166,305+r*48
                p.draw_rect(fitz.Rect(x,y,x+166,y+48),color=(.65,.73,.83),fill=(.93,.96,.99) if r==0 else None)
                p.insert_text((x+12,y+29),value,fontsize=13,color=ink)
        p.insert_text((48,550),'All values are invented. Leading zeros are intentional.',fontsize=12,color=blue)
    else:
        for j, (head, body) in enumerate([
            ('A clear starting point','Open the demo, select a paragraph and inspect its properties.\nKeep the original page nearby while reviewing your changes.'),
            ('Review before applying','Preview the result, check the page and bookmark destination,\nthen apply the edit. Save a copy when you want a separate PDF.'),
            ('Continue your work','Use a Folio project to retain editable sources and review state.\nReopen the saved result and confirm the text and page order.')]):
            y=310+j*130
            p.insert_text((48,y),head,fontsize=17,color=blue)
            p.insert_textbox(fitz.Rect(48,y+23,540,y+100),body,fontsize=12,lineheight=1.5,color=ink)
    p.draw_line((48,777),(547,777),color=(.8,.85,.9))
    p.insert_text((48,799),'SYNTHETIC DOCUMENT - SAFE FOR PUBLIC SCREENSHOTS',fontsize=8,color=blue)
    p.insert_text((525,799),str(i+1),fontsize=10,color=blue)
doc.set_toc([[1,t,i+1] for i,t in enumerate(titles)])
doc.set_metadata({'title':'Folio public demonstration','author':'Folio demo generator','subject':'Synthetic data only'})
doc.save(OUT/'Folio-Demo.pdf',garbage=4,deflate=True)
scan=fitz.open(); page=scan.new_page(width=595,height=842)
page.insert_image(page.rect,stream=doc[2].get_pixmap(matrix=fitz.Matrix(2,2)).tobytes('png'))
scan.set_metadata({'title':'Folio synthetic scan','author':'Folio demo generator'})
scan.save(OUT/'Folio-Demo-Scan.pdf',garbage=4,deflate=True)
assert not scan[0].get_text().strip()
print('Generated two synthetic PDFs in docs/examples')

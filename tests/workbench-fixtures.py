"""Small reproducible inputs shared by independent Windows acceptance jobs."""
from pathlib import Path
import sys, io, base64, hashlib, urllib.request
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz, pikepdf
from docx import Document
from openpyxl import Workbook
from PIL import Image
from document_utilities import process
out=ROOT/'tests/output';out.mkdir(exist_ok=True)
doc=fitz.open();page=doc.new_page()
page.insert_text((60,60),'Document utility preservation benchmark')
doc.set_toc([[1,'Chapter',1]]);doc.save(out/'utilities-source.pdf');doc.close()
doc=fitz.open();page=doc.new_page(width=595,height=842)
page.insert_text((50,65),'Quarterly performance',fontsize=22)
page.insert_text((50,100),'Verified source values. Preserve leading zeroes and literal formulas.',fontsize=11)
xs=[50,240,350,480];ys=[140,175,210,245,280]
for x in xs:page.draw_line((x,ys[0]),(x,ys[-1]))
for y in ys:page.draw_line((xs[0],y),(xs[-1],y))
for ri,row in enumerate([['Product','Revenue','Margin'],['Alpha','1200','25%'],['Beta','00123','18.50%'],['=1+1','-45.5','0.0%']]):
 for ci,value in enumerate(row):page.insert_text((xs[ci]+8,ys[ri]+22),value,fontsize=11)
page.insert_text((50,325),'Footnote: numbers are illustrative test data.',fontsize=9)
doc.set_toc([[1,'Quarterly performance',1]]);doc.save(out/'conversion-table.pdf')
scan=fitz.open();p=scan.new_page(width=595,height=842);p.insert_image(p.rect,stream=page.get_pixmap(matrix=fitz.Matrix(2,2)).tobytes('png'));scan.save(out/'conversion-scan.pdf');scan.close();doc.close()
d=Document();d.add_heading('Office import',0);d.add_paragraph('Editable Word content 12345.');d.save(out/'import.docx')
w=Workbook();w.active.append(['Item','Value']);w.active.append(['Alpha',123]);w.save(out/'import.xlsx')
Image.new('RGB',(320,200),'#235a83').save(out/'import.png')
d=fitz.open();d.new_page().insert_text((60,70),'Visible layer content');d.new_page().insert_text((60,70),'Page two');d.save(out/'engineering-source.pdf');d.close()
def save(action,source,target,**options):
 r=process({'input':str(out/source),'action':action,'options':options});(out/target).write_bytes(base64.b64decode(r['bytes']));return r
save('layers','engineering-source.pdf','engineering-layers.pdf',operation='create',name='Review layer',pages=[1])
layers=process({'input':str(out/'engineering-layers.pdf'),'action':'layers','options':{}})['layers']
save('layers','engineering-layers.pdf','engineering-hidden.pdf',operation='configure',changes=[{'id':layers[0]['id'],'visible':False}])
with pikepdf.open(out/'engineering-source.pdf') as p:
 root=p.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.StructTreeRoot));p.Root.StructTreeRoot=root
 first=p.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.StructElem,S=pikepdf.Name.Figure,P=root,Pg=p.pages[0].obj,K=0))
 second=p.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.StructElem,S=pikepdf.Name.P,P=root,Pg=p.pages[1].obj,K=0))
 root.K=pikepdf.Array([first,second]);p.Root.MarkInfo=pikepdf.Dictionary(Marked=True);p.save(out/'engineering-tagged.pdf')
tree=process({'input':str(out/'engineering-tagged.pdf'),'action':'tags','options':{}})
figure=next(x for x in tree['nodes'] if x['role']=='Figure')
save('tags','engineering-tagged.pdf','engineering-tagged-patched.pdf',operation='patch',language='en-US',title='Accessible test',changes=[{'id':figure['id'],'alt':'A layer test'}])
paper=out/'attention-paper.pdf';sha='bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697'
if not paper.exists() or hashlib.sha256(paper.read_bytes()).hexdigest()!=sha:
 with urllib.request.urlopen('https://arxiv.org/pdf/1706.03762',timeout=120) as response:data=response.read()
 assert hashlib.sha256(data).hexdigest()==sha;paper.write_bytes(data)
d=fitz.open()
for i in range(12):d.new_page().insert_text((60,100),f'Folio test page {i+1}',fontsize=28)
d.set_toc([[1,f'Chapter {i+1}',i+1] for i in range(8)]);d.save(out/'modes.pdf');d.close()
print('Independent workbench fixtures ready')

"""End-to-end corpus: reopen Office outputs, validate PDF/A independently, merge formats."""
import sys,io,json,base64,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz
from docx import Document
from openpyxl import Workbook,load_workbook
from PIL import Image
from pypdf import PdfReader
from document_utilities import process
from document_assembly import assemble
out=ROOT/'tests/output';out.mkdir(exist_ok=True);checks=[]
def ok(s):checks.append(s);print('PASS',s,flush=True)
def run(action,file,**options):return process({'action':action,'input':str(file.resolve()),'options':options})
def save(r,name):p=out/name;p.write_bytes(base64.b64decode(r['bytes']));return p

doc=fitz.open();page=doc.new_page(width=595,height=842)
page.insert_text((50,65),'Quarterly performance',fontsize=22)
page.insert_text((50,100),'Verified source values. Preserve leading zeroes and literal formulas.',fontsize=11)
xs=[50,240,350,480];ys=[140,175,210,245,280]
for x in xs:page.draw_line((x,ys[0]),(x,ys[-1]))
for y in ys:page.draw_line((xs[0],y),(xs[-1],y))
values=[['Product','Revenue','Margin'],['Alpha','1200','25%'],['Beta','00123','18.50%'],['=1+1','-45.5','0.0%']]
for ri,row in enumerate(values):
 for ci,value in enumerate(row):page.insert_text((xs[ci]+8,ys[ri]+22),value,fontsize=11)
page.insert_text((50,325),'Footnote: numbers are illustrative test data.',fontsize=9)
doc.set_toc([[1,'Quarterly performance',1]])
source=out/'conversion-table.pdf';doc.save(source);doc.close()
plan=run('conversion-plan',source);(out/'conversion-plan.json').write_text(json.dumps(plan,ensure_ascii=False),encoding='utf-8')
assert len(plan['pages'][0]['tables'])==1
review={'pages':[{'page':1,'headings':[{'blockId':plan['pages'][0]['blocks'][0]['id'],'level':1}], 'tables':plan['pages'][0]['tables']}]}
for layout in ['faithful','flow']:
 r=run('export-word',source,review=review,layout=layout);p=save(r,'conversion-'+layout+'.docx');d=Document(p)
 assert r['metrics']['textCoverage']>=.98,r['metrics']
 assert any(p.style.name=='Heading 1' for p in d.paragraphs)
 assert len(d.tables)>=1
 ok('Word '+layout+' text coverage, tables and AI heading references')
r=run('export-excel',source,review=review);p=save(r,'conversion-table.xlsx');wb=load_workbook(p)
ws=wb['Page 1 Table 1'];assert ws['B2'].value==1200;assert ws['B3'].value=='00123';assert ws['A4'].value=='=1+1' and ws['A4'].data_type=='s';assert ws['C2'].value==.25;assert ws['B2'].comment
assert len(list(wb['Source'].values))>20;ok('Excel values, leading zeroes, percentages, formula protection and source provenance')
bad={'pages':[{'page':1,'tables':[{'rows':1,'cols':1,'cells':[{'row':0,'col':0,'wordIds':['invented']}]}]}]}
try:run('export-excel',source,review=bad);raise AssertionError('Accepted hallucinated token')
except ValueError:pass
ok('Rejected ungrounded AI references')
for standard in ['1b','2b','3b']:
 r=run('pdfa',source,standard=standard);p=save(r,'conversion-'+standard+'.pdf');assert r['validation']['compliant'];assert run('validate-pdfa',p,standard=standard)['compliant'];ok('PDF/A-'+standard+' independent veraPDF validation')
assert not run('validate-pdfa',source)['compliant'];ok('Ordinary PDF does not falsely pass PDF/A')
fixtures=[]
d=Document();d.add_heading('Office import',0);d.add_paragraph('Editable Word content 12345.');d.save(out/'import.docx');fixtures.append(out/'import.docx')
w=Workbook();w.active.append(['Item','Value']);w.active.append(['Alpha',123]);w.save(out/'import.xlsx');fixtures.append(out/'import.xlsx')
for ext,text in [('md','# Markdown heading\n\nA readable paragraph.\n\n| Name | Value |\n|---|---|\n| Alpha | 12 |'),('txt','Plain text import\nSecond line.'),('csv','Item,Value\nAlpha,123')]:
 p=out/('import.'+ext);p.write_text(text,encoding='utf-8');fixtures.append(p)
Image.new('RGB',(320,200),'#235a83').save(out/'import.png');fixtures.append(out/'import.png')
for p in fixtures:
 r=run('import-office',p,extension=p.suffix[1:]);pdf=save(r,'import-'+p.suffix[1:]+'.pdf');assert len(fitz.open(pdf))>=1;ok('Import '+p.suffix)
parts=[{'name':p.name,'data':base64.b64encode(p.read_bytes()).decode(),'bookmark':'Section '+str(i)} for i,p in enumerate(fixtures[:2])]
parts.insert(1,{'current':True,'name':'Original.pdf','bookmark':'Original chapter'})
r=assemble({'input':str(source),'parts':parts,'bookmarkMode':'combined'});p=save(r,'mixed-merged.pdf');reader=PdfReader(p);assert len(reader.pages)==3;assert r['manifest'][1]['startPage']==2
assert [x.title for x in reader.outline if not isinstance(x,list)]==['Section 0','Original chapter','Section 1'];assert reader.outline[2][0].title=='Quarterly performance';ok('Mixed-format merge preserves order and nested original bookmarks')
pic=Image.effect_noise((1800,1800),60).convert('RGB');b=io.BytesIO();pic.save(b,format='PNG');d=fitz.open();p=d.new_page();p.insert_image(fitz.Rect(40,40,500,500),stream=b.getvalue());p.insert_text((40,600),'Searchable content retained');sourcepic=out/'compression-source.pdf';d.save(sourcepic);d.close()
r=run('compress',sourcepic,preset='screen',dpi=96,quality=60);p=save(r,'compression-output.pdf');assert r['reduction']>.5;assert 'Searchable content retained' in fitz.open(p)[0].get_text();ok('Image compression reduces size and keeps text searchable')
(out/'conversion-native-report.json').write_text(json.dumps({'status':'passed','checks':checks},indent=2),encoding='utf-8')
with fitz.open(source) as original:
 scan=fitz.open();page=scan.new_page(width=original[0].rect.width,height=original[0].rect.height);page.insert_image(page.rect,stream=original[0].get_pixmap(matrix=fitz.Matrix(2,2)).tobytes('png'));scan.save(out/'conversion-scan.pdf');scan.close()

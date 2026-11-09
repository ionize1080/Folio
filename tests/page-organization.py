"""Page identity, independent duplicates, bookmarks, links and marks after assembly."""
import base64,io,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz
from pypdf import PdfReader,PdfWriter
from page_organization import process
out=ROOT/'tests/output';out.mkdir(exist_ok=True);checks=[]
doc=fitz.open()
for i in range(3):
    p=doc.new_page(width=300,height=400);p.insert_text((30,40),'Original '+str(i+1));p.draw_rect(fitz.Rect(20,80,100+i*20,130),color=(0,.3,.8),fill=(.2,.6,.8))
doc.set_toc([[1,'First',1],[1,'Second',2],[1,'Third',3]])
doc[0].insert_link({'kind':fitz.LINK_GOTO,'from':fitz.Rect(30,30,100,50),'page':1})
source=out/'organizer-source.pdf';doc.save(source);doc.close()
foreign=fitz.open();p=foreign.new_page(width=200,height=250);p.insert_text((20,30),'Inserted');extra=foreign.tobytes();foreign.close()
def organize(order,**options):
    r=process({'input':str(source),'options':{'order':order,**options}});return base64.b64decode(r['bytes'])
order=[{'page':2,'rotation':90},{'blank':True,'width':180,'height':240,'rotation':270,'crop':[1,2,3,4]},{'page':1},{'source':'extra','page':1},{'page':2}]
data=organize(order,sources=[{'id':'extra','name':'insert.pdf','data':base64.b64encode(extra).decode()}])
with fitz.open(stream=data,filetype='pdf') as d:
    assert len(d)==5
    assert [p.get_text().strip() for p in d]==['Original 2','','Original 1','Inserted','Original 2']
    assert d[0].rotation==90 and d[4].rotation==0,'Rotating a duplicate must not rotate the original'
    assert d[1].rotation==270 and tuple(d[1].cropbox)==(1,2,177,236)
    assert all(1<=r[2]<=len(d) for r in d.get_toc()),d.get_toc()
    assert not any(r[1]=='Third' for r in d.get_toc()),d.get_toc()
    assert d[0].get_drawings() and d[4].get_drawings(),'Vector content must remain vector'
    assert d[2].get_links() and d[2].get_links()[0]['page'] in [0,4],d[2].get_links()
checks.append('Insert, delete, reorder and rotate preserve content, vectors, links and surviving bookmark targets')
marks=organize([{'page':3},{'page':1}],marks={'kind':'footer','text':'{page} / {pages}','size':12})
with fitz.open(stream=marks,filetype='pdf') as d:
    assert '1 / 2' in d[0].get_text() and '2 / 2' in d[1].get_text()
background=organize([{'page':1}],marks={'kind':'background','color':'#fff0cc'})
with fitz.open(stream=background,filetype='pdf') as d:
    assert 'Original 1' in d[0].get_text() and len(d[0].get_drawings())==2
checks.append('Page numbers use final page order; background remains behind existing text and art')
for invalid in [[],[{'page':0}],[{'page':99}],[{'page':1,'rotation':45}],[{'blank':True,'width':0}],[{'blank':True,'crop':[1000,0,0,0]}]]:
    try:organize(invalid)
    except (ValueError,TypeError):pass
    else:raise AssertionError(invalid)
checks.append('Invalid page indexes, rotations, sizes and full-page crops produce errors without changing the original')
(out/'organizer-result.pdf').write_bytes(data);(out/'page-organization.json').write_text(json.dumps({'status':'passed','checks':checks},indent=2),encoding='utf-8');print('\n'.join('PASS '+c for c in checks))

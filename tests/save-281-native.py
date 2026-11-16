"""Native edit fixtures and independent readers for in-place incremental saves.

FOLIO_SAVE_SAMPLES is a local JSON list of paths. Private samples never enter
the repository or CI; only copies below tests/output are changed.
"""
from pathlib import Path
import base64, hashlib, io, json, os, sys, urllib.request, subprocess
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor')]
import fitz, pypdfium2 as pdfium
from pypdf import PdfReader
from pypdf.generic import IndirectObject,DictionaryObject,ArrayObject
OUT=ROOT/'tests/output/save-281';OUT.mkdir(parents=True,exist_ok=True)
def digest(p):
    with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def prepare():
    from PIL import Image
    d=fitz.open()
    for i in range(4):
        p=d.new_page(width=420,height=595)
        p.insert_text((35,60),f'Folio document {i+1} 2025',fontsize=18)
        p.insert_textbox(fitz.Rect(35,90,380,220),'This paragraph preserves the original positions. The 2025 report includes a second line for paragraph editing and a visible baseline for comparison.',fontsize=14)
        b=io.BytesIO();Image.new('RGB',(60,40),(30+i*40,160,120)).save(b,format='PNG')
        p.insert_image(fitz.Rect(35,260,135,330),stream=b.getvalue())
        p.draw_rect(fitz.Rect(170,260,290,330),color=(.2,.4,.8),fill=(.8,.9,1))
        p.insert_link({'kind':fitz.LINK_URI,'from':fitz.Rect(35,350,180,370),'uri':'https://example.org/folio'})
        w=fitz.Widget();w.field_name=f'field-{i}';w.field_type=fitz.PDF_WIDGET_TYPE_TEXT;w.rect=fitz.Rect(35,400,180,430);w.field_value='Preserve form';p.add_widget(w)
        p.add_text_annot((330,400),'Preserve annotation')
    d.set_toc([[1,'First',1],[2,'Nested',2],[1,'Last',4]])
    d.set_metadata({'title':'Save integrity fixture','author':'Folio regression'})
    synthetic=OUT/'fixture.pdf';d.save(synthetic);d.close()
    d=fitz.open();p=d.new_page(width=420,height=595);p.insert_text((40,70),'Folio OCR 2026',fontsize=28)
    p.insert_text((40,120),'Searchable scan test',fontsize=22);image=p.get_pixmap(matrix=fitz.Matrix(2,2)).tobytes('png');d.close()
    d=fitz.open();p=d.new_page(width=420,height=595);p.insert_image(p.rect,stream=image);scan=OUT/'scan.pdf';d.save(scan);d.close()
    sources=[synthetic,scan]
    if os.environ.get('FOLIO_SAVE_SAMPLES'):
        sources += [Path(p) for p in json.loads(Path(os.environ['FOLIO_SAVE_SAMPLES']).read_text(encoding='utf-8-sig'))]
    else:
        for entry in json.loads((ROOT/'tests/public-editing-260.json').read_text())['documents'][:2]:
            target=OUT/(entry['sha256']+'.pdf')
            if not target.exists():
                cached=ROOT/'tests/output/editing-public-downloads'/(entry['sha256']+'.pdf')
                if cached.exists():target.write_bytes(cached.read_bytes())
                else:
                    req=urllib.request.Request(entry['url'],headers={'User-Agent':'Folio regression'})
                    with urllib.request.urlopen(req,timeout=90) as r:target.write_bytes(r.read(16*1024**2+1))
            assert digest(target)==entry['sha256'];sources.append(target)
    rows=[]
    for source in sources:
        sha=digest(source);folder=OUT/sha[:12];folder.mkdir(exist_ok=True)
        original=folder/'original.pdf';original.write_bytes(source.read_bytes())
        with fitz.open(original) as doc:count=len(doc)
        rows.append(dict(id=sha[:12],source=str(source),original=str(original),sha256=sha,pages=count,scan=source==scan))
    (OUT/'matrix.json').write_text(json.dumps(rows,ensure_ascii=False),encoding='utf8')
    print('Prepared',len(rows),'PDFs',flush=True)
def edit(source,target,phase):
    import worker
    from PIL import Image
    edits=[dict(type='text',id='save281-text',page=1,index=None,text='Folio saved 2026',matrix=[1,0,0,1,25,25],size=10)]
    if phase>=2:
        b=io.BytesIO();Image.new('RGB',(40,30),(200,70,40)).save(b,format='PNG')
        edits.append(dict(type='inserted-image',id='d5fd3571-5c7a-4c43-9a53-8babfc68c48c',page=1,matrix=[40,0,0,30,25,50],imageData=base64.b64encode(b.getvalue()).decode()))
    if phase>=3:
        edits.append(dict(type='vector-graphic',id='90dbb2b0-6e0c-4d3c-bc1c-f133f2c2c718',page=1,box=[80,50,40,30],svg='<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><path d="M0 30 Q20 0 40 30" stroke="blue" fill="none"/></svg>'))
    ocr=[]
    if phase>=4:ocr=[dict(page=1,text='Folio invisible OCR layer',confidence=1,quad=[[25,110],[220,110],[220,95],[25,95]])]
    result=worker.run(dict(command='apply',input=str(source),edits=edits,ocr=ocr))
    Path(target).write_bytes(base64.b64decode(result['bytes']))
def graph(reader):
    stack=[reader.trailer.raw_get('/Root')];seen=set()
    while stack:
        value=stack.pop()
        if isinstance(value,IndirectObject):
            key=(value.idnum,value.generation)
            if key in seen:continue
            seen.add(key);value=value.get_object();assert value is not None,'Broken indirect reference'
        if isinstance(value,DictionaryObject):stack.extend(value.values())
        elif isinstance(value,ArrayObject):stack.extend(value)
    return len(seen)
def verify_page(expected,actual,index):
    # A fresh rendering context distinguishes a warmed MuPDF font-cache rounding
    # difference from changed content. No pixel tolerance is accepted here.
    with fitz.open(expected) as a,fitz.open(actual) as b:
        for scale in (.35,1):
            assert a[index].get_pixmap(matrix=fitz.Matrix(scale,scale)).samples==b[index].get_pixmap(matrix=fitz.Matrix(scale,scale)).samples,('fresh MuPDF',index,scale)
    with pdfium.PdfDocument(expected) as a,pdfium.PdfDocument(actual) as b:
        x,y=a[index],b[index];px,py=x.render(scale=.35),y.render(scale=.35)
        assert px.to_numpy().tobytes()==py.to_numpy().tobytes(),('fresh PDFium',index)
        px.close();py.close();x.close();y.close()

def verify(expected,actual,all_pages=False):
    rechecks=[]
    with fitz.open(expected) as a,fitz.open(actual) as b:
        assert not b.is_repaired,'Broken cross-reference structure'
        assert len(a)==len(b),'Page count changed'
        indices=range(len(a)) if all_pages else sorted({0,len(a)//2,len(a)-1})
        for i in indices:
            x,y=a[i],b[i]
            assert x.rect==y.rect and x.rotation==y.rotation,('geometry',i)
            assert x.get_text()==y.get_text(),('text',i)
            px,py=x.get_pixmap(matrix=fitz.Matrix(.35,.35)),y.get_pixmap(matrix=fitz.Matrix(.35,.35))
            if px.samples!=py.samples:
                result=subprocess.run([sys.executable,__file__,'verify-page',expected,actual,str(i)],capture_output=True,text=True,timeout=90)
                assert result.returncode==0,('render',i,result.stderr)
                rechecks.append(i+1)
            def links(p):return [{k:v for k,v in r.items() if k not in ('xref','id')} for r in p.get_links()]
            assert links(x)==links(y),('links',i)
            assert [(w.field_name,w.field_value) for w in x.widgets() or []]==[(w.field_name,w.field_value) for w in y.widgets() or []],('widgets',i)
            assert [n.type for n in x.annots() or []]==[n.type for n in y.annots() or []],('annotations',i)
            assert len(x.get_images())==len(y.get_images()),('images',i)
        assert a.metadata['author']==b.metadata['author'],'Author changed'
        samples=sorted({0,len(a)//2,len(a)-1})
    for i in samples:
        with pdfium.PdfDocument(expected) as a,pdfium.PdfDocument(actual) as b:
            x,y=a[i],b[i];px,py=x.render(scale=.35),y.render(scale=.35)
            assert px.to_numpy().tobytes()==py.to_numpy().tobytes(),('PDFium',i)
            px.close();py.close();x.close();y.close()
    a,b=PdfReader(expected),PdfReader(actual)
    def fields(r):return {k:v.get('/V') for k,v in (r.get_fields() or {}).items()}
    assert fields(a)==fields(b),'Canonical AcroForm values changed'
    return dict(pagesChecked=len(list(indices)),objects=graph(b),readers=['MuPDF','PDFium','pypdf'],freshRasterRechecks=rechecks)
if __name__=='__main__':
    if sys.argv[1]=='prepare':prepare()
    elif sys.argv[1]=='edit':edit(sys.argv[2],sys.argv[3],int(sys.argv[4]))
    elif sys.argv[1]=='verify-page':verify_page(sys.argv[2],sys.argv[3],int(sys.argv[4]))
    else:print(json.dumps(verify(sys.argv[2],sys.argv[3],len(sys.argv)>4)))

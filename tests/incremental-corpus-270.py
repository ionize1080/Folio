"""Real PDF edit matrix and independent, exhaustive post-save validation.

prepare: pinned public papers plus an optional local PDF (read-only).
verify: compare every page against the ordinary full-save result, then compare
sample pages in a second renderer and traverse all reachable PDF references.
"""
import base64,hashlib,io,json,os,sys,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'native'),str(ROOT/'tests')]
import fitz,pypdfium2 as pdfium
from pypdf import PdfReader
from pypdf.generic import IndirectObject,DictionaryObject,ArrayObject
from page_organization import process
OUT=ROOT/'tests/output/incremental-corpus-270';OUT.mkdir(parents=True,exist_ok=True)
manifest=OUT/'matrix.json'
def sha(data):return hashlib.sha256(data).hexdigest()
def prepare():
    public=json.loads((ROOT/'tests/public-editing-260.json').read_text(encoding='utf8'))['documents'][:2]
    local={}
    plan=ROOT/'tests/output/editing-260-plan.json'
    if plan.exists():local={r['sha256']:r['path'] for r in json.loads(plan.read_text(encoding='utf8'))['documents']}
    inputs=[]
    for entry in public:
        cached=Path(local.get(entry['sha256'],ROOT/'tests/output/editing-public-downloads'/ (entry['sha256']+'.pdf')))
        if cached.exists():data=cached.read_bytes()
        else:
            req=urllib.request.Request(entry['url'],headers={'User-Agent':'Folio regression (+https://github.com/ionize1080/Folio)'})
            with urllib.request.urlopen(req,timeout=90) as response:data=response.read(16*1024**2+1)
        assert sha(data)==entry['sha256'];inputs.append((entry['sha256'][:12],data))
    if os.environ.get('FOLIO_TEST_REAL_PDF'):
        data=Path(os.environ['FOLIO_TEST_REAL_PDF']).read_bytes();inputs.append(('local-'+sha(data)[:12],data))
    rows=[]
    for key,data in inputs:
        folder=OUT/key;folder.mkdir(exist_ok=True);source=folder/'original.pdf';source.write_bytes(data)
        cases=[]
        def case(name,blob):
            path=folder/(name+'.pdf');path.write_bytes(blob);cases.append({'name':name,'snapshot':str(path.relative_to(ROOT))})
        for kind in ['text','image','vector','ocr','comments','form','metadata','bookmarks','rotate','crop']:
            with fitz.open(stream=data,filetype='pdf') as doc:
                p=doc[0]
                if kind=='text':p.insert_text((20,32),'Folio incremental text',fontsize=9)
                elif kind=='image':
                    from PIL import Image
                    b=io.BytesIO();Image.new('RGB',(40,30),(93,188,149)).save(b,format='PNG');p.insert_image(fitz.Rect(20,45,60,75),stream=b.getvalue())
                elif kind=='vector':p.draw_circle((55,80),20,color=(.8,.3,.2),fill=(.8,.7,.2))
                elif kind=='ocr':p.insert_text((20,50),'Folio invisible OCR',fontsize=10,render_mode=3)
                elif kind=='comments':
                    p.add_highlight_annot(fitz.Rect(20,40,120,60));p.add_text_annot((25,80),'Incremental note');p.add_ink_annot([[(30,100),(60,120),(90,100)]])
                elif kind=='form':
                    widget=fitz.Widget();widget.field_name='FolioRegression';widget.field_type=fitz.PDF_WIDGET_TYPE_TEXT;widget.rect=fitz.Rect(20,20,120,45);widget.field_value='Retained field';p.add_widget(widget)
                elif kind=='metadata':doc.set_metadata({**doc.metadata,'title':'Folio incremental metadata'})
                elif kind=='bookmarks':doc.set_toc([[1,'Changed bookmark',1],[2,'Last page',len(doc)]])
                elif kind=='rotate':p.set_rotation((p.rotation+90)%360)
                elif kind=='crop':
                    r=p.cropbox;p.set_cropbox(fitz.Rect(r.x0+3,r.y0+4,r.x1-5,r.y1-6))
                case(kind,doc.tobytes(garbage=0,deflate=False))
        count=len(PdfReader(source).pages);order=[{'page':i+1} for i in range(count)]
        variants={
            'insert-blank':order[:1]+[{'blank':True,'width':400,'height':500}]+order[1:],
            'duplicate-page':order[:1]+[{'page':1}]+order[1:],
            'delete-page':order[1:],
            'reorder-pages':order[-1:]+order[:-1],
            'resize-page':[{**order[0],'size':[450,650],'resize':{'keepAspect':True}}]+order[1:],
            'canvas-only':[{**order[0],'size':[700,900],'resize':{'canvasOnly':True}}]+order[1:],
            'crop-pages':[{**order[0],'crop':[3,4,5,6]}]+order[1:],
            'extract-split':order[:2],
            'replace-page':[{**order[-1],'replaces':{'source':'current','page':1},'keepTargetAnnotations':True}]+order[1:],
        }
        extra=fitz.open();extra.new_page(width=400,height=500).insert_text((30,60),'Inserted external page');blob=extra.tobytes();extra.close()
        variants['insert-file']=order[:1]+[{'source':'extra','page':1}]+order[1:]
        for name,items in variants.items():
            result=process({'input':str(source),'options':{'order':items,'sources':[{'id':'extra','name':'extra.pdf','data':base64.b64encode(blob).decode()}]}})
            case(name,base64.b64decode(result['bytes']))
        # Output from the actual native paragraph replacement pipeline, when the
        # existing public editing suite has produced it in this checkout.
        existing=sorted((ROOT/'tests/output/editing-260-corpus'/key).glob('p*-m*.pdf'))[:3]
        for i,path in enumerate(existing):case('native-paragraph-'+str(i),path.read_bytes())
        cases.append({'name':'undo-all','snapshot':str(source.relative_to(ROOT))})
        rows.append({'id':key,'source':str(source.relative_to(ROOT)),'sha256':sha(data),'cases':cases})
    manifest.write_text(json.dumps(rows),encoding='utf8');print('Prepared',len(rows),'real PDFs;',sum(len(r['cases']) for r in rows),'edit/save states',flush=True)

def validate_graph(reader):
    pending=[reader.trailer['/Root']];seen=set();objects=0
    while pending:
        value=pending.pop()
        if isinstance(value,IndirectObject):
            key=(value.idnum,value.generation)
            if key in seen:continue
            seen.add(key);value=value.get_object();assert value is not None,'Unresolved indirect reference';objects+=1
        if isinstance(value,DictionaryObject):pending.extend(value.values())
        elif isinstance(value,ArrayObject):pending.extend(value)
    return objects
def verify():
    rows=json.loads(manifest.read_text());checks=[];total_pages=0
    for row in rows:
        source=ROOT/row['source'];assert sha(source.read_bytes())==row['sha256']
        for c in row['cases']:
            original=ROOT/c['snapshot'];saved=original.parent/(c['name']+'-incremental.pdf')
            with fitz.open(original) as expected,fitz.open(saved) as actual:
                assert not actual.is_repaired,'Renderer repaired a broken cross-reference table'
                assert len(expected)==len(actual) and expected.get_toc()==actual.get_toc()
                assert expected.metadata==actual.metadata
                for n in range(len(expected)):
                    a,b=expected[n],actual[n]
                    assert a.rect==b.rect and a.rotation==b.rotation
                    assert a.get_text()==b.get_text(),(row['id'],c['name'],n,'text')
                    assert a.get_pixmap(matrix=fitz.Matrix(.25,.25)).samples==b.get_pixmap(matrix=fitz.Matrix(.25,.25)).samples,(row['id'],c['name'],n,'render')
                    def links(p):return [{k:v for k,v in item.items() if k not in ('xref','id')} for item in p.get_links()]
                    assert links(a)==links(b),(row['id'],c['name'],n,'links')
                    assert [(w.field_name,w.field_value) for w in a.widgets() or []]==[(w.field_name,w.field_value) for w in b.widgets() or []]
                total_pages+=len(actual)
                samples=sorted({0,len(actual)//2,len(actual)-1})
            first,second=pdfium.PdfDocument(original),pdfium.PdfDocument(saved)
            try:
                for n in samples:
                    pa,pb=first[n],second[n]
                    ba,bb=pa.render(scale=.4),pb.render(scale=.4)
                    assert ba.to_numpy().tobytes()==bb.to_numpy().tobytes(),(row['id'],c['name'],n,'PDFium render')
                    ba.close();bb.close();pa.close();pb.close()
            finally:first.close();second.close()
            refs=validate_graph(PdfReader(saved));checks.append({'document':row['id'],'edit':c['name'],'pages':len(PdfReader(original).pages),'objects':refs})
            print('PASS',row['id'],c['name'],flush=True)
    result={'status':'passed','documents':len(rows),'checks':checks,'renderedPages':total_pages,'engines':['MuPDF','PDFium','pypdf'],'originalsUnchanged':True}
    (ROOT/'tests/output/incremental-corpus-270.json').write_text(json.dumps(result),encoding='utf8');print('PASS',len(checks),'states;',total_pages,'pages',flush=True)
if __name__=='__main__':prepare() if sys.argv[1]=='prepare' else verify()

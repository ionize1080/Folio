"""Exercise the native writer without using its number formatter for fixtures."""
from pathlib import Path
import base64,io,json,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor')]
from pypdf import PdfReader,PdfWriter
from pypdf.generic import FloatObject,IndirectObject
from pdf_writer import clone_document,SourceFloat

def contracts():
    bodies=[
      b'<< /Type /Catalog /Pages 2 0 R /Dests << /Exact 5 0 R >> /Metadata 6 0 R >>',
      b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << >> /Contents 4 0 R >>',
      b'<< /Length 0 >>\nstream\n\nendstream',
      b'[3 0 R /XYZ 0 7 0 R 1.6409305325968633]',
      b'<< /Type /Metadata /Subtype /XML /Length 10 /FolioPrecise [-0.000000000000123456789 123456789123.45679] >>\nstream\n<keep-me/>\nendstream',
      b'418.7508745393122',
    ]
    data=b'%PDF-1.7\n';offsets=[]
    for i,body in enumerate(bodies,1):
        offsets.append(len(data));data+=f'{i} 0 obj\n'.encode()+body+b'\nendobj\n'
    xref=len(data);data+=b'xref\n0 8\n0000000000 65535 f \n'+b''.join(f'{n:010} 00000 n \n'.encode() for n in offsets)
    data+=f'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    for cycle in range(3):
        reader=PdfReader(io.BytesIO(data));dest=reader.trailer['/Root']['/Dests']['/Exact']
        assert isinstance(dest[3],IndirectObject)
        assert float(dest[3].get_object())==418.7508745393122
        assert float(dest[4])==1.6409305325968633
        original=dest[3].get_object();writer=clone_document(reader)
        assert type(original) is FloatObject,'Cloning must not mutate the reader'
        output=io.BytesIO();writer.write(output);data=output.getvalue()
        saved=PdfReader(io.BytesIO(data));metadata=saved.trailer['/Root']['/Metadata']
        assert metadata.get_data()==b'<keep-me/>'
        assert list(map(float,metadata['/FolioPrecise']))==[-0.000000000000123456789,123456789123.45679]
        assert b'418.7508745393122' in data and b'1.6409305325968633' in data
    assert SourceFloat('0.000000000000123456789').myrepr()=='0.000000000000123456789'
    assert FloatObject(418.7508745393122).myrepr()=='418.750875','No global pypdf formatting change'
    return ['Direct and indirect PDF reals preserve precision across three clones','Named destinations retain full coordinates and zoom','Stream payloads and reader objects remain unchanged','No process-wide pypdf patch']

def verify(original,actual,preview,edited_page,marker):
    import fitz,pypdfium2 as pdfium
    with fitz.open(original) as original_doc,fitz.open(actual) as saved,fitz.open(preview) as expected:
        assert len(original_doc)==len(saved)==len(expected)
        for i in range(len(saved)):
            a,b=expected[i],saved[i]
            assert a.get_text()==b.get_text(),('text',i+1)
            assert a.rect==b.rect and a.rotation==b.rotation,('geometry',i+1)
            assert a.get_pixmap(matrix=fitz.Matrix(.5,.5)).samples==b.get_pixmap(matrix=fitz.Matrix(.5,.5)).samples,('preview pixels',i+1)
            if i!=edited_page-1:
                old=original_doc[i]
                assert old.get_text()==b.get_text(),('untouched text',i+1)
                assert old.get_pixmap(matrix=fitz.Matrix(.5,.5)).samples==b.get_pixmap(matrix=fitz.Matrix(.5,.5)).samples,('untouched pixels',i+1)
            def annots(p):return [{'type':n.type,'info':{k:v for k,v in n.info.items() if k!='id'}} for n in p.annots() or []]
            assert annots(original_doc[i])==annots(b),('annotations',i+1)
        assert marker in ''.join(saved[edited_page-1].get_text().split())
        count=len(saved)
    with pdfium.PdfDocument(preview) as a,pdfium.PdfDocument(actual) as b:
        x,y=a[edited_page-1],b[edited_page-1];px,py=x.render(scale=1),y.render(scale=1)
        assert px.to_numpy().tobytes()==py.to_numpy().tobytes(),'Independent PDFium pixels'
        px.close();py.close();x.close();y.close()
    a,b=PdfReader(original),PdfReader(actual)
    fields=lambda r:{k:v.get('/V') for k,v in (r.get_fields() or {}).items()}
    assert fields(a)==fields(b),'Form values'
    return {'pagesChecked':count,'readers':['MuPDF','PDFium','pypdf']}

if __name__=='__main__':
    if sys.argv[1]=='contracts':print(json.dumps({'status':'passed','checks':contracts()}))
    elif sys.argv[1]=='verify':print(json.dumps(verify(*sys.argv[2:5],int(sys.argv[5]),sys.argv[6])))
    elif sys.argv[1]=='legacy':
        PdfWriter(clone_from=PdfReader(sys.argv[2])).write(sys.argv[3])
    else:
        import worker
        phase=sys.argv[4] if len(sys.argv)>4 else 'text';page=int(sys.argv[5]) if len(sys.argv)>5 else 1
        edits=[] if phase=='empty' else [{'type':'text','id':'precision282','page':page,'text':'合计付款','matrix':[1,0,0,1,25,25],'size':10}]
        result=worker.run({'command':'apply','input':sys.argv[2],'edits':edits})
        Path(sys.argv[3]).write_bytes(base64.b64decode(result['bytes']))

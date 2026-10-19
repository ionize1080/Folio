"""A complete generated paragraph may resize; inherited PDF clips remain binding."""
from pathlib import Path
import sys,io,json,base64,copy
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'native'),str(ROOT/'native/vendor')]
import fitz
from pypdf import PdfReader,PdfWriter
from pypdf.generic import ContentStream,NameObject,ArrayObject,FloatObject,DictionaryObject,DecodedStreamObject
from p8_helpers import models,save,pixels,dump,OUT
from story import layout
from text_semantics import mark_paragraph

checks=[]
doc=fitz.open();doc.new_page(width=300,height=300);doc.new_page(width=300,height=300)
doc[1].insert_text((20,30),'Untouched adjacent page');raw=doc.tobytes();doc.close()
model=dict(text='alpha beta\ngamma delta\nA hard paragraph',softBreaks=[10],sources=[],
    pageWidth=300,pageHeight=300,frame=dict(x=30,y=30,width=74,height=200),size=10,
    lineHeight=1.4,paragraphGap=0,columns=1,gap=18,align='left',color='#202020',font='sans',layoutMode='reflow')
initial=layout(model);first=save(raw,model,result=initial)

def widen(data):
    _,candidates=models(data)
    selected=next(m for m in candidates if m['text']==model['text'])
    changed=copy.deepcopy(model);changed['sources']=selected['sources'];changed['text']='a'+changed['text']
    changed['softBreaks']=[11];changed['frame']['width']=240
    result=layout(changed);assert result['mappingComplete'] and not result['overflow']
    return save(data,changed,result=result)

wide=widen(first)
assert pixels(raw,1)==pixels(first,1)==pixels(wide,1)
with fitz.open(stream=wide,filetype='pdf') as doc:
    text=doc[0].get_text()
    assert 'aalpha beta gamma delta' in text and 'A hard paragraph' in text,text
    assert text.count('aalpha')==1,text
checks.append('complete owned paragraph widens after reopen with unclipped once-only text and unchanged adjacent page')

def clipped(data,kind):
    reader=PdfReader(io.BytesIO(data));writer=PdfWriter();writer.clone_document_from_reader(reader);page=writer.pages[0]
    stream=ContentStream(page.get('/Contents'),writer)
    rect=[FloatObject(v) for v in [30,70,74,200]]
    if kind=='page rectangle':
        stream.operations=[([],b'q'),(rect,b're'),([],b'W'),([],b'n')]+stream.operations+[([],b'Q')]
    else:
        form=DecodedStreamObject();form.set_data(stream.get_data())
        form.update({NameObject('/Type'):NameObject('/XObject'),NameObject('/Subtype'):NameObject('/Form'),
            NameObject('/BBox'):ArrayObject([FloatObject(v) for v in [30,70,104,270]]),NameObject('/Resources'):page['/Resources']})
        page[NameObject('/Resources')]=DictionaryObject({NameObject('/XObject'):DictionaryObject({NameObject('/External'):writer._add_object(form)})})
        stream.operations=[([],b'q'),([NameObject('/External')],b'Do'),([],b'Q')]
    page[NameObject('/Contents')]=writer._add_object(stream)
    return dump(writer)

for kind in ['page rectangle','external Form BBox']:
    constrained=clipped(first,kind)
    assert pixels(first)==pixels(constrained),(kind,'fixture changed original visible pixels')
    assert pixels(first,1)==pixels(constrained,1)
    try:widen(constrained)
    except ValueError as error:assert '裁剪边界' in str(error),str(error)
    else:raise AssertionError(kind+' was bypassed by generated paragraph metadata')
    checks.append(kind+': inherited source clip still rejects widening; original and adjacent pixels unchanged')

# The same FolioText metadata in an ordinary page stream does not prove that
# its graphics clip belongs to an editable generated Form.
plain=mark_paragraph(base64.b64decode(initial['fragment']),model['text'],model['softBreaks'])
try:widen(plain)
except ValueError as error:assert '裁剪边界' in str(error),str(error)
else:raise AssertionError('unowned FolioText bypassed source clipping')
checks.append('FolioText alone cannot authorize escaping a source clip')
report={'checks':checks,'errors':[]}
(OUT/'v190-clip-reopen-report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))

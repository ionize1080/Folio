"""Focused inspection must match complete-document inspection and writable ownership."""
import base64
import io
import json
import sys
import time
from unittest.mock import patch
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'tests')]
import fitz
from pypdf import PdfReader,PdfWriter
from pypdf.generic import ArrayObject as A,DictionaryObject as D,NameObject as N,NumberObject as I,TextStringObject as T,DecodedStreamObject
import worker
from form_compat import reopen
from inspection_source import inspection_source
from p8_helpers import models,save,pixels,dump

OUT=ROOT/'tests/output/inspection-source'
OUT.mkdir(parents=True,exist_ok=True)
checks=[]
sys.stdout.reconfigure(encoding='utf8')

def b64(data):return base64.b64encode(data).decode()
def compare(name,data,page):
    start=time.perf_counter();legacy=reopen(data,[page]);old=worker.run(dict(command='inspect',bytes=b64(legacy),page=page,resolvedForms=True));before=time.perf_counter()-start
    start=time.perf_counter();new=worker.run(dict(command='inspect',bytes=b64(data),page=page));after=time.perf_counter()-start
    # Includes exact operator ownership, original glyph anchors, font restoration,
    # clipping, text runs, page boxes and paragraph-editability decisions.
    assert old==new,name
    checks.append(dict(name=name,page=page,objects=len(new['objects']),legacySeconds=round(before,4),focusedSeconds=round(after,4)))
    return new

doc=fitz.open()
doc.new_page(width=400,height=400).insert_text((20,35),'Untouched first page')
p=doc.new_page(width=400,height=400)
p.insert_text((35,65),'First editable paragraph.',fontsize=13)
p.insert_text((35,85),'Second line remains in place.',fontsize=13)
doc.new_page(width=400,height=400).insert_text((20,35),'Untouched third page')
raw=doc.tobytes();doc.close()
compare('ordinary-page-two',raw,2)
layers=PdfWriter(clone_from=io.BytesIO(raw));layer=layers._add_object(D({N('/Type'):N('/OCG'),N('/Name'):T('Visible text')}));lp=layers.pages[1]
lp['/Resources'][N('/Properties')]=D({N('/Layer'):layer})
content=DecodedStreamObject();content.set_data(b'/OC /Layer BDC '+lp.get_contents().get_data()+b' EMC');lp[N('/Contents')]=layers._add_object(content)
layers._root_object[N('/OCProperties')]=D({N('/OCGs'):A([layer]),N('/D'):D({N('/ON'):A([layer]),N('/Order'):A([layer])})})
compare('optional-content-catalog',dump(layers),2)
writer=PdfWriter(clone_from=io.BytesIO(raw));page=writer.pages[1]
form=DecodedStreamObject();form.set_data(page.get_contents().get_data());form.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Form'),N('/BBox'):A([I(0),I(0),I(400),I(400)]),N('/Resources'):page['/Resources']})
page[N('/Resources')]=D({N('/XObject'):D({N('/Wrapped'):writer._add_object(form)})})
stream=DecodedStreamObject();stream.set_data(b'q /Wrapped Do Q');page[N('/Contents')]=writer._add_object(stream)
wrapped=dump(writer);compare('wrapped-page-two',wrapped,2)
writer._root_object[N('/StructTreeRoot')]=writer._add_object(D({N('/Type'):N('/StructTreeRoot'),N('/K'):A()}))
tagged=dump(writer);compare('tagged-wrapper-keeps-protection',tagged,2)
assert any(o['type']=='form' for o in worker.run(dict(command='inspect',bytes=b64(tagged),page=2))['objects'])

inspection,candidates=models(wrapped,2)
model=max(candidates,key=lambda m:len(m['text']))
model['text']=model['text'].replace('First','Final')
result=save(wrapped,model,n=2)
assert pixels(raw,0)==pixels(result,0) and pixels(raw,2)==pixels(result,2)
compare('saved-and-reopened',result,2)
assert any('Final editable paragraph.' in m['text'] for m in models(result,2)[1])
checks.append(dict(name='focused-source-applies-to-original-multipage-document-and-reopens'))

from browser_fonts import opentype
source_font=fitz.Font('helv').buffer
with patch('fontTools.fontBuilder.timestampNow',return_value=2082844800):first=opentype(source_font)
with patch('fontTools.fontBuilder.timestampNow',return_value=3082844800):later=opentype(source_font)
assert first==later,'Generated font keys must not depend on the current time'
checks.append(dict(name='identical-restored-font-has-stable-bytes-and-key-across-different-clock-times'))

real=[
 (Path(r'C:\Users\haowe\Downloads\中国交通年鉴2025_1-edited.pdf'),62),
 (Path(r'D:\APP\PDF Samples\普通高中教科书·语文必修 上册.pdf'),8),
 (Path(r'D:\APP\PDF Samples\金融机构编码规范.pdf'),3),
 (Path(r'D:\APP\PDF Samples\Synology_DS1621_Plus_Data_Sheet_chs.pdf'),1),
]
for file,page in real:
    if file.exists():compare(file.stem,file.read_bytes(),page)

# Cached page results never retain a complete source book and stay byte bounded.
from inspection_source import _cache,MAX_BYTES
assert len(_cache)<=4 and sum(map(len,_cache.values()))<=MAX_BYTES
(OUT/'report.json').write_text(json.dumps(dict(status='passed',checks=checks),ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(dict(status='passed',checks=checks),ensure_ascii=False,indent=2))

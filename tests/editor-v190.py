"""Regressions from real corpus: semantics and inline image preservation."""
from pathlib import Path
import sys,io,json,base64
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'native')]
from p8_helpers import models,save,pixels,inspect,OUT
from text_semantics import mark_shows,mark_paragraph
from story import layout
from pypdf import PdfReader,PdfWriter
from pypdf.generic import DecodedStreamObject,NameObject
import fitz
checks=[]
# Exact ActualText newline semantics survive PDFium's whitespace flattening.
d=fitz.open();p=d.new_page();p.insert_text((50,80),'train- ing example',fontsize=12);raw=d.tobytes();d.close()
semantic=mark_paragraph(mark_shows(raw,'train-\ning example'),'train-\ning example')
r,ms=models(semantic);assert any('train-\ning example' in m['text'] for m in ms)
checks.append('Singleton ActualText containing newlines remains editable')
# Story may map a painted hyphen to U+00AD; preserve the exact submitted text.
_,ms=models(raw);m=ms[0];m['text']='Corvaja-Zannier';m['softBreaks']=[];m['runs']=[];m.pop('originalLayout',None);m['layoutMode']='reflow';m['frame']['width']=220;m['frame']['height']=60
changed=save(raw,m)
with fitz.open(stream=changed,filetype='pdf') as doc:assert 'Corvaja-Zannier' in doc[0].get_text()
_,again=models(changed);assert any(x['text']=='Corvaja-Zannier' for x in again)
checks.append('ASCII hyphen survives Story export, extraction and editable reopen')
# A pre-existing inline image remains a dictionary operand during own Form expansion.
w=PdfWriter();pg=w.add_page(PdfReader(io.BytesIO(raw)).pages[0]);s=DecodedStreamObject();s.set_data(pg.get_contents().get_data()+b'\nq 12 0 0 12 300 300 cm BI /W 1 /H 1 /CS /RGB /BPC 8 ID \xff\x00\x00 EI Q\n');pg[NameObject('/Contents')]=w._add_object(s);buf=io.BytesIO();w.write(buf);original=buf.getvalue()
_,ms=models(original);m=ms[0];m['text']=m['text'].replace('example','sample');m['runs']=[];m['softBreaks']=[]
changed=save(original,m);r,again=models(changed);assert any('sample' in x['text'] for x in again)
clip=fitz.Rect(298,528,314,544);assert pixels(original,clip=clip)==pixels(changed,clip=clip)
checks.append('Inline image survives paragraph replacement and editable reopen with identical pixels')
(OUT/'v190-native-report.json').write_text(json.dumps({'checks':checks,'errors':[]},indent=2))
print(json.dumps({'checks':checks,'errors':[]}))


# Deterministic browser fixtures; corpus tests can replace the outline fixture.
d=fitz.open();p=d.new_page();p.insert_text((50,80),'Original paragraph with enough width for navigation',fontsize=12);d.new_page();d.save(OUT/'v190-editor.pdf');d.close()
d=fitz.open();[d.new_page() for _ in range(4)];d.set_toc([[1,'Chapter one',1],[2,'Child section',2],[1,'Chapter two',3],[2,'Another child',4]]);d.save(OUT/'v190-outline.pdf');d.close()


"""Text replacement semantics may not introduce old line breaks into new shows."""
from pathlib import Path
import io, json, sys, base64
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'native'),str(ROOT/'native/vendor')]
import fitz
from p8_helpers import models, OUT
from text_semantics import mark_shows,mark_paragraph,soft_break_offsets
from generated_cmaps import repair
import worker, pypdfium2 as pdfium

checks=[]
def compact(text):return ''.join(text.split())
for label,painted,logical,font in [
    ('latin',['First line continuation','with the next physical line'],
     'First\nline continuation with\nthe next physical line',None),
    ('cjk',['甲乙丙丁戊己庚辛壬癸','中文段落重新排版后的内容'],
     '甲乙\n丙丁戊己庚辛壬癸中文段落\n重新排版后的内容',ROOT/'native/fonts/NotoSansSC.ttf'),
]:
    d=fitz.open();p=d.new_page(width=500,height=240)
    name='helv'
    if font:p.insert_font(fontname='Cjk',fontfile=str(font));name='Cjk'
    p.insert_text((40,60),'\n'.join(painted),fontname=name,fontsize=12,lineheight=2.5)
    d.subset_fonts();raw=repair(d.tobytes(),generated=True);d.close()
    marked=mark_paragraph(mark_shows(raw,logical),logical)
    with fitz.open(stream=marked,filetype='pdf')as doc:
        assert compact(doc[0].get_text())==compact(logical),(label,doc[0].get_text())
        with fitz.open(stream=raw,filetype='pdf')as before:
            assert before[0].get_pixmap().samples==doc[0].get_pixmap().samples
    r,ms=models(marked)
    assert any(m['text']==logical for m in ms),(label,[m['text'] for m in ms])
    checks.append(label+': changed source/visual line boundaries extract once, preserve pixels, reopen with exact logical text')
    # Keep the first source break soft and the second one intentional. Native
    # inspection must expose that distinction after the PDF is serialized.
    soft=[len(logical[:logical.index('\n')].encode('utf-16-le'))//2]
    metadata=mark_paragraph(mark_shows(raw,logical),logical,soft)
    decoded=worker.run(dict(command='inspect',bytes=base64.b64encode(metadata).decode(),page=1))
    grouped=[o for o in decoded['objects']if o.get('flowText')==logical]
    assert grouped and all(o.get('flowSoftBreaks')==soft for o in grouped)

assert soft_break_offsets('A😀\nB\nC',[3,5])==[3,5]
assert soft_break_offsets('A😀\nB\nC',[2]) is None
assert soft_break_offsets('A\ud800\nB',[2]) is None
for invalid in [[True],[1.5],[-1],[999]]:
    try:mark_paragraph(raw,logical,invalid)
    except ValueError:pass
    else:raise AssertionError('invalid soft-break metadata accepted')
checks.append('PDF soft-break metadata preserves soft versus hard breaks and validates UTF-16 offsets')

# A visible soft-hyphen glyph still needs exact ASCII-hyphen semantics. Preserve
# this correction without adding unrelated source breaks to its marked show.
d=fitz.open();p=d.new_page(width=500,height=240)
p.insert_text((40,60),'Corvaja\xadZannier test',fontsize=12)
raw=d.tobytes();d.close()
logical='Corvaja-Zannier\ntest'
marked=mark_paragraph(mark_shows(raw,logical),logical)
with fitz.open(stream=marked,filetype='pdf')as doc:
    assert compact(doc[0].get_text())==compact(logical)
r,ms=models(marked);assert any(m['text']==logical for m in ms)
checks.append('soft hyphen correction keeps ASCII source character and logical newline on reopen')

# Browser-style per-glyph export can put a visible hyphen at the end of a
# physical line. PDFium represents it as U+0002 plus IsHyphen, while its raw
# signature must stay unchanged. Inspect, preview and save must all agree.
from fast_layout import font_data,render
face=font_data('builtin-latin');text='Corvaja-Zannier';glyphs=[];x=40;y=60
for i,ch in enumerate(text):
    if i==8:x=40;y=90
    width=face['advances'][str(ord(ch))]*12
    glyphs.append(dict(text=ch,start=i,end=i+1,originX=x,baseline=y,x=x,y=y-12,
                       w=width,h=14,size=12,fontKey=face['key'],color='#000000',scale=1))
    x+=width
m=dict(text=text,pageWidth=300,pageHeight=200,frame=dict(x=40,y=45,width=200,height=70),
       size=12,lineHeight=1.3,color='#000000',align='left',
       fastLayout=dict(version=1,text=text,glyphs=glyphs,anchors=[]))
raw=mark_paragraph(base64.b64decode(render(m)['fragment']),text)
with pdfium.PdfDocument(raw)as pdf:
    pg=pdf[0];tp=pg.get_textpage()
    objects=[worker.describe(pdfium.raw,pdfium.raw.FPDFPage_GetObject(pg,i),i,tp)
             for i in range(pdfium.raw.FPDFPage_CountObjects(pg))]
    assert any('\x02' in o.get('text','')for o in objects),'fixture did not produce PDFium hyphen marker'
    tp.close();pg.close()
r,ms=models(raw);paragraph=next(v for v in ms if v['text']==text)
edit=dict(page=1,type='flow',sources=paragraph['sources'],model={'text':''},fragment='')
for command in ['flow-background','apply']:
    result=worker.run(dict(command=command,bytes=base64.b64encode(raw).decode(),page=1,edits=[edit]))
    changed=base64.b64decode(result['pdf' if command=='flow-background' else 'bytes'])
    with fitz.open(stream=changed,filetype='pdf')as doc:assert not doc[0].get_text().strip()
checks.append('proved PDFium line-end hyphen markers keep signatures and permit reopened preview/save')
report={'checks':checks,'errors':[]}
(OUT/'v190-semantics-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))

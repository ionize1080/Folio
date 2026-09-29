"""Synthetic reproductions of clipped photos and nested unowned marked content.
No user document content is included in these fixtures or published artifacts.
"""
import io,sys,json,base64,copy
from pathlib import Path
from p8_helpers import inspect,models,save,pixels,dump,OUT,ROOT
import fitz,pypdfium2 as pdfium,worker
from PIL import Image
from pypdf import PdfReader,PdfWriter
from pypdf.generic import DictionaryObject as D,NameObject as N,ArrayObject as A,NumberObject as I,DecodedStreamObject as S,TextStringObject as T,ContentStream
from form_compat import reopen
checks=[]
def stream(w,data):
 s=S();s.set_data(data);return w._add_object(s)
def form(w,data,resources):
 s=S();s.set_data(data);s.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Form'),N('/BBox'):A([I(v) for v in [0,0,240,160]]),N('/Resources'):resources});return w._add_object(s)
def fixture(properties=b'/MCID 0 /Lang (en-US)',protect=None):
 d=fitz.open();p=d.new_page(width=240,height=160);p.insert_text((20,60),'Yearbook 2026',fontsize=14)
 source=PdfReader(io.BytesIO(d.tobytes())).pages[0];w=PdfWriter()
 leaf=form(w,b'/Span <<'+properties+b'>> BDC '+source.get_contents().get_data()+b' EMC',source['/Resources'].clone(w))
 if protect=='form':leaf.get_object()[N('/StructParents')]=I(0)
 outer=form(w,b'q /Inner Do Q',D({N('/XObject'):D({N('/Inner'):leaf})}))
 for commands in [b'q /Outer Do Q q 1 0 0 1 260 0 cm /Outer Do Q',b'/Outer Do']:
  pg=w.add_blank_page(width=520,height=200);pg[N('/Resources')]=D({N('/XObject'):D({N('/Outer'):outer})});pg[N('/Contents')]=stream(w,commands)
 if protect=='catalog':w._root_object[N('/StructTreeRoot')]=w._add_object(D({N('/Type'):N('/StructTreeRoot')}))
 if protect=='page':w.pages[0][N('/StructParents')]=I(0)
 return dump(w)
def same(raw,new):
 assert pixels(raw)==pixels(new)
 with pdfium.PdfDocument(raw) as a,pdfium.PdfDocument(new) as b:
  assert a[0].render(scale=1.5).to_pil().tobytes()==b[0].render(scale=1.5).to_pil().tobytes()
raw=fixture();(OUT/'yearbook-wrapped.pdf').write_bytes(raw);expanded=reopen(raw,[1]);same(raw,expanded)
p=PdfReader(io.BytesIO(expanded)).pages[0];props=[args[1] for args,op in p.get_contents().operations if op==b'BDC']
assert len(props)==2 and all('/MCID' not in prop and prop['/Lang']=='en-US' for prop in props)
# Original resource graph remains untouched: the sibling still invokes MCID 0.
outer=p['/Resources']['/XObject']['/Outer'];leaf=outer['/Resources']['/XObject']['/Inner'];assert b'/MCID 0' in leaf.get_data()
current=raw
for year in ['2025','2024','2023']:
 _,ms=models(current);assert len(ms)==2
 m=next(m for m in ms if m['frame']['x']<250);m['text']=m['text'][:-4]+year;current=save(current,m)
 assert pixels(raw,1)==pixels(current,1)
 assert pixels(raw,0,fitz.Rect(260,0,520,200))==pixels(current,0,fitz.Rect(260,0,520,200))
 _,ms=models(current);assert {m['text'].strip() for m in ms}=={'Yearbook '+year,'Yearbook 2026'}
checks.append('Nested unowned MCIDs: exact dual-engine expansion, language preserved, shared source untouched, three edit/save/reopen cycles isolated')
for protection in ['catalog','page','form']:
 r=inspect(fixture(protect=protection));assert not any(o.get('flowEditable') for o in r['objects'])
for props in [b'/MCID 0 /Alt (alternate)',b'/MCID 0 /E (expanded)']:
 r=inspect(fixture(props));assert not any(o.get('flowEditable') for o in r['objects'])
raw_actual=fixture(b'/MCID 0 /Lang (en-US) /ActualText (Yearbook 2026)');_,ms=models(raw_actual);assert len(ms)==2
m=ms[0];m.update(text='Yearbook 2025',allowOverflow=True);m['frame']['width']=200;edited=save(raw_actual,m)
with fitz.open(stream=edited,filetype='pdf') as d:
 text=d[0].get_text();assert 'Yearbook 2025' in text and 'Yearbook 2026' in text, repr(text)
checks.append('Real structure ownership and Alt/E remain protected; singleton ActualText remains editable and copied text updates')
# A generated subset can keep empty cmap slots for unused digits. Reopening
# must use a populated fallback, rather than claiming an invisible glyph exists.
d=fitz.open();p=d.new_page(width=240,height=160);p.insert_font(fontname='F',fontfile=str(ROOT/'native/fonts/DejaVuSans.ttf'));p.insert_text((20,60),'3',fontname='F',fontsize=14);d.subset_fonts();current=d.tobytes()
from font_match import load_font
_,ms=models(current);f=load_font(ms[0]['fontKey']);assert ord('3') in f['coverage'] and ord('2') not in f['coverage']
for text in ['2','22','21']:
 _,ms=models(current);m=ms[0];m.update(text=text,allowOverflow=True);m['frame']['width']=180;m['runs']=[{**m['runs'][0],'start':0,'end':len(text)}];current=save(current,m)
 with fitz.open(stream=current,filetype='pdf') as d:assert d[0].get_text().strip()==text
checks.append('Subset font empty cmap slots excluded; successive new and repeated digits remain visible and extract exactly')
# Negative tracking is part of the original advance; it must not trigger an
# unrelated line wrap on a same-width numeric correction.
d=fitz.open();p=d.new_page(width=240,height=160);p.insert_font(fontname='F',fontfile=str(ROOT/'native/fonts/DejaVuSans.ttf'))
p.insert_text((20,50),'2024 report\n2024 report',fontname='F',fontsize=14)
for xref in p.get_contents():d.update_stream(xref,d.xref_stream(xref).replace(b'BT',b'BT -.5 Tc'))
current=d.tobytes();_,ms=models(current);m=next(m for m in ms if '\n' in m['text']);m['text']=m['text'].replace('2024','2023')
from story import layout
result=layout(m);assert result['layoutMode']=='原始字位',result['layoutMode'];edited=save(current,m,result=result)
with fitz.open(stream=edited,filetype='pdf') as doc:assert doc[0].get_text().splitlines()==['2023 report','2023 report']
checks.append('Negative tracking: numeric correction preserves original two-line layout and extracted repeated characters')
# Refining paint envelopes must still reject genuine interleaved overlap.
d=fitz.open();p=d.new_page(width=240,height=160);p.insert_text((20,50),'Report 2026',fontsize=14);p.insert_text((20,70),'Report 2026',fontsize=14);clean=d.tobytes();_,ms=models(clean);m=next(m for m in ms if '\n' in m['text'])
d=fitz.open();p=d.new_page(width=240,height=160);p.insert_text((20,50),'Report 2026',fontsize=14);p.draw_rect(fitz.Rect(25,40,55,52),color=(1,0,0),fill=(1,0,0));p.insert_text((20,70),'Report 2026',fontsize=14);raw=d.tobytes();r=inspect(raw)
m['sources']=[{'index':o['index'],'signature':o['signature']} for o in r['objects'] if o['type']=='text'];m['text']=m['text'].replace('2026','2025')
try:save(raw,m);raise AssertionError('Interleaved paint overlap accepted')
except ValueError as e:assert '交错重叠' in str(e),str(e)
checks.append('Genuine interleaved paint overlap still rejects rather than changing the original layer order')
# One image shared across two pages, with a partial rectangle crop on page one.
buf=io.BytesIO();im=Image.new('RGB',(200,200));im.putdata([(x,y,100) for y in range(200) for x in range(200)]);im.save(buf,format='PNG')
d=fitz.open();p=d.new_page(width=240,height=240);xref=p.insert_image(fitz.Rect(20,20,220,220),stream=buf.getvalue());p=d.new_page(width=240,height=240);p.insert_image(fitz.Rect(20,20,220,220),xref=xref)
w=PdfWriter(clone_from=PdfReader(io.BytesIO(d.tobytes())));pg=w.pages[0];original=pg.get_contents().get_data();pg[N('/Contents')]=stream(w,b'q 35 40 160 150 re W n '+original+b' Q');raw=dump(w);(OUT/'yearbook-clipped-image.pdf').write_bytes(raw)
def apply(data,obj,**kw):return base64.b64decode(worker.run({'command':'apply','bytes':base64.b64encode(data).decode(),'edits':[{**obj,'page':1,**kw}]})['bytes'])
obj=next(o for o in inspect(raw)['objects'] if o['type']=='image');assert obj['editable'];same(raw,apply(raw,obj))
current=raw
for options in [{'curves':[[0,0],[128,170],[255,255]]},{'contrast':20},{'brightness':-10}]:
 obj=next(o for o in inspect(current)['objects'] if o['type']=='image');assert obj['editable'];current=apply(current,obj,adjustments=options)
 assert pixels(raw,1)==pixels(current,1)
 for rect in [fitz.Rect(0,0,240,49),fitz.Rect(0,201,240,240),fitz.Rect(0,0,34,240),fitz.Rect(196,0,240,240)]:assert pixels(raw,0,rect)==pixels(current,0,rect)
assert pixels(raw)!=pixels(current)
checks.append('Partially rectangle-clipped photo: editable curves, identity exact, three saved edits keep crop, outside pixels and shared sibling')
for clip in [b'20 20 m 220 20 l 120 220 l h W n ',b'20 20 m 30 220 200 220 220 20 c h W n ']:
 pg[N('/Contents')]=stream(w,b'q '+clip+original+b' Q');r=inspect(dump(w));assert not next(o for o in r['objects'] if o['type']=='image')['editable']
checks.append('Nonrectangular and curved image clips remain protected; existing text-clip tests run separately')
(OUT/'yearbook-native-report.json').write_text(json.dumps({'platform':sys.platform,'checks':checks,'errors':[]},indent=2));print(json.dumps({'checks':checks,'errors':[]}))

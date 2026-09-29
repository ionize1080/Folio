"""Release blockers: paint order, TJ columns, own semantics/fonts and OCR bloat."""
from p8_helpers import *
import copy,shutil
from pypdf import PdfReader,PdfWriter
from pypdf.generic import ContentStream,NameObject as N,ArrayObject as A,ByteStringObject as B,FloatObject as F,DictionaryObject as D,NumberObject as I
import tempfile,font_match
font_match.CACHE=Path(tempfile.mkdtemp(prefix="folio-p8-cold-cache-"))
from font_match import CACHE,_load_font
checks=[]
# A default replacement stays below a later opaque rectangle.
d=fitz.open();p=d.new_page(width=400,height=300);p.insert_text((30,60),'12345678',fontsize=16);p.draw_rect(fitz.Rect(55,40,115,70),color=(1,0,0),fill=(1,0,0));raw=d.tobytes()
r,ms=models(raw);m=ms[0];m['text']='92345678';m['layoutMode']='reflow';m['allowOverflow']=True
changed=save(raw,m);assert pixels(raw,clip=fitz.Rect(56,41,114,69))==pixels(changed,clip=fitz.Rect(56,41,114,69))
checks.append('Default text redraw retains original paint position beneath later opaque graphics')
# A padded frame may overlap following text sharing a BT without any ink overlap.
d=fitz.open();p=d.new_page(width=400,height=300);p.insert_text((30,60),'First paragraph',fontsize=12);p.insert_text((30,95),'Next heading',fontsize=12)
w=PdfWriter();pg=w.add_page(PdfReader(io.BytesIO(d.tobytes())).pages[0]);st=ContentStream(pg.get('/Contents'),w)
st.operations=[([],b'BT')]+[(a,o) for a,o in st.operations if o not in (b'BT',b'ET')]+[([],b'ET')];pg[N('/Contents')]=w._add_object(st);raw=dump(w)
r,ms=models(raw);m=next(m for m in ms if m['text'].startswith('First'));m['text']='Revised paragraph';m.update(layoutMode='reflow',allowOverflow=True);m['frame']['height']=80;m['runs']=[{**m['runs'][0],'end':len(m['text'])}]
changed=save(raw,m);assert pixels(raw,clip=fitz.Rect(25,82,130,100))==pixels(changed,clip=fitz.Rect(25,82,130,100))
checks.append('Padded frame crossing next heading does not reject disjoint actual ink in a shared BT')
# Two independently positioned spans in ONE TJ remain separate on local edits.
d=fitz.open();p=d.new_page(width=400,height=300);p.insert_text((30,60),'C F',fontsize=12,fontname='cour');w=PdfWriter();pg=w.add_page(PdfReader(io.BytesIO(d.tobytes())).pages[0]);st=ContentStream(pg.get('/Contents'),w)
st.operations=[([A([B(b'C'),F(-7000),B(b'F')])],b'TJ') if op in (b'Tj',b'TJ') else (args,op) for args,op in st.operations];pg[N('/Contents')]=w._add_object(st);raw=dump(w);r,ms=models(raw);m=ms[0];m['text']=m['text'].replace('C','DD');m['runs']=[{**m['runs'][0],'end':len(m['text'])}]
result=layout(m);old_f=next(g for g in m['originalLayout']['glyphs'] if g['text']=='F');changed=save(raw,m,result=result)
with fitz.open(stream=changed,filetype='pdf') as d:
 f=next(c for span in d[0].get_texttrace() for c in span['chars'] if c[0]==ord('F'));assert abs(f[2][0]-old_f['originX'])<.02
checks.append('Same TJ fixed columns: growing first span preserves untouched second-span origin')
# Long Story output: all generated shows stay editable through three cold reopens.
d=fitz.open();p=d.new_page(width=400,height=400);p.insert_text((30,60),'Original 2026',fontsize=12);raw=d.tobytes()
for cycle in range(3):
 r,ms=models(raw);assert ms
 m=max(ms,key=lambda m:len(m['text']));m['text']=('Editable paragraph 2026 with several lines and CFF source fonts. '*3).replace('2026',str(2025-cycle));m.update(layoutMode='reflow',allowOverflow=True,softBreaks=[]);m['frame'].update(width=260,height=260);m['runs']=[{**m['runs'][0],'start':0,'end':len(m['text'])}]
 raw=save(raw,m);shutil.rmtree(CACHE,ignore_errors=True);_load_font.cache_clear();r,ms=models(raw)
 text=[o for o in r['objects'] if o['type']=='text' and o.get('text','').strip()]
 assert len(text)>2 and all(o.get('flowEditable') and o.get('fontKey') for o in text),[(o.get('reason'),o.get('fontFallback')) for o in text]
 assert ''.join(m['text'].split()) in ''.join(''.join(o['text'] for o in text).split())
(OUT/'p8-three-rounds.pdf').write_bytes(raw)
checks.append('Three cold-cache save/reopen/reflow cycles: generated multiline semantics and fonts remain editable')
# Native tagged MCID stays at the page owner; new Form call remains inside scope.
d=fitz.open();p=d.new_page();p.insert_text((30,60),'Tagged 2026');w=PdfWriter();pg=w.add_page(PdfReader(io.BytesIO(d.tobytes())).pages[0]);st=ContentStream(pg.get('/Contents'),w);st.operations=[([N('/P'),D({N('/MCID'):I(0)})],b'BDC')]+st.operations+[([],b'EMC')];pg[N('/Contents')]=w._add_object(st);pg[N('/StructParents')]=I(0)
root=w._add_object(D({N('/Type'):N('/StructTreeRoot')}));elem=w._add_object(D({N('/Type'):N('/StructElem'),N('/S'):N('/P'),N('/P'):root,N('/Pg'):pg.indirect_reference,N('/K'):I(0)}));root.get_object().update({N('/K'):A([elem]),N('/ParentTree'):w._add_object(D({N('/Nums'):A([I(0),A([elem])])}))});w._root_object[N('/StructTreeRoot')]=root;raw=dump(w);r,ms=models(raw);m=ms[0];m.update(text='Tagged revised words',layoutMode='reflow',allowOverflow=True);m['runs']=[{**m['runs'][0],'end':len(m['text'])}];changed=save(raw,m)
r=PdfReader(io.BytesIO(changed));st=ContentStream(r.pages[0].get('/Contents'),r);active=False;calls=0
for args,op in st.operations:
 if op==b'BDC' and args[1].get('/MCID')==0:active=True
 elif op==b'EMC':active=False
 elif op==b'Do':assert active;calls+=1
assert calls==1 and r.trailer['/Root']['/StructTreeRoot']['/K'][0].get_object()['/K']==0
checks.append('Tagged replacement retains page MCID/ParentTree ownership and paints replacement inside its original scope')
# Repeated OCR replacement does not keep dead Form/font streams.
d=fitz.open();d.new_page(width=200,height=150);raw=d.tobytes();sizes=[]
for i in range(10):
 out=worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),'edits':[],'ocr':[{'page':1,'text':'OCR cycle '+str(i),'quad':[[20,100],[140,100],[140,80],[20,80]],'confidence':1}]});raw=base64.b64decode(out['bytes']);sizes.append(len(raw))
 r=PdfReader(io.BytesIO(raw));owned=[v for v in r.pages[0]['/Resources']['/XObject'].values() if v.get_object().get('/FolioOCRVersion')==1];assert len(owned)==1
assert max(sizes[1:])<sizes[0]*1.05+10000,sizes
checks.append('Ten OCR replacements retain one active layer and bounded output size')
# Metric substitute: original-resource correction is allowed; redraw needs a choice.
d=fitz.open();p=d.new_page(width=400,height=300);p.insert_text((30,60),'2026',fontname='helv');w=PdfWriter();pg=w.add_page(PdfReader(io.BytesIO(d.tobytes())).pages[0]);font=next(iter(pg['/Resources']['/Font'].values())).get_object();font[N('/BaseFont')]=N('/Arial');font[N('/FirstChar')]=I(32);font[N('/LastChar')]=I(126);font[N('/Widths')]=A([F(fitz.Font('helv').glyph_advance(cp)*1000) for cp in range(32,127)]);raw=dump(w)
r,ms=models(raw);m=ms[0]
if m.get('fontResolution')=='metric-substitute':
 m['text']='2025';m['fastLayout']={'version':1}  # Original resource decision must not depend on preview kind.
 from content import map_objects,check_editable
 from original_patch import correction
 desc=r['objects'];pg=PdfReader(io.BytesIO(raw)).pages[0];mapped=check_editable(pg,desc);st,_=map_objects(pg)
 assert correction(pg,st,mapped[0],desc[0],{'model':m,'sources':m['sources']}) is not None
 m.pop('fastLayout');m['frame']['x']+=10
 try:save(raw,m);raise AssertionError('Implicit metric font redraw accepted')
 except ValueError as e:assert '明确选择' in str(e)
 m['fontResolution']='user-selected'
 for run in m['runs']:run['fontResolution']='user-selected'
 changed=save(raw,m);assert inspect(changed)['editSummary']['editableTextObjects']>0
checks.append('Metric-substitute redraw requires explicit selection; fast corrections can reuse original font resources')
from ocr_reading_order import reading_order
q=lambda text,x,y,width=80:dict(page=1,text=text,quad=[[x,y],[x+width,y],[x+width,y-10],[x,y-10]])
assert [b['text'] for b in reading_order([q('L1',0,80),q('R1',150,80),q('L2',0,65),q('R2',150,65),q('Title',0,120,230)])]==['Title','L1','L2','R1','R2']
checks.append('OCR whitespace ordering keeps a spanning heading followed by complete left and right columns')
(OUT/'p8-contracts-report.json').write_text(json.dumps({'checks':checks,'ocrSizes':sizes,'errors':[]},indent=2));print(json.dumps({'checks':checks,'errors':[]}))

"""Form instance isolation, resource scopes and semantic text round trips."""
from pathlib import Path
import sys, io, json, base64, subprocess, copy
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz, pypdfium2 as pdfium, worker
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject as D, NameObject as N, ArrayObject as A, FloatObject as F, NumberObject as I, DecodedStreamObject as Stream, ContentStream
from form_compat import reopen
from story import layout
from content import stream_identity
OUT=ROOT/'tests/output';OUT.mkdir(exist_ok=True);checks=[]

def dump(w):
 b=io.BytesIO();w.write(b);return b.getvalue()
def source(text='Shared 2026',font='helv'):
 d=fitz.open();p=d.new_page(width=220,height=150);p.insert_text((20,60),text,fontsize=14,fontname=font);return PdfReader(io.BytesIO(d.tobytes())).pages[0]
def form(w,pg,group=False, matrix=None):
 f=Stream();f.set_data(pg.get_contents().get_data());f.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Form'),N('/BBox'):A([F(v)for v in pg.mediabox]),N('/Resources'):pg['/Resources'].clone(w)})
 if group:f[N('/Group')]=D({N('/S'):N('/Transparency'),N('/CS'):N('/DeviceRGB')})
 if matrix:f[N('/Matrix')]=A([F(v)for v in matrix])
 return w._add_object(f)
def page(w,refs,commands,width=550,height=400):
 p=w.add_blank_page(width=width,height=height);p[N('/Resources')]=D({N('/XObject'):D({N(k):v for k,v in refs.items()})});s=Stream();s.set_data(commands);p[N('/Contents')]=w._add_object(s);return p

def inspect(raw,n=1):return worker.run({'command':'inspect','bytes':base64.b64encode(raw).decode(),'page':n})
def models(raw,n=1):
 r=inspect(raw,n);p=OUT/'p7-current.json';p.write_text(json.dumps(r))
 code="import fs from 'node:fs';import{pageCandidates}from './src/flow-page-model.mjs';const r=JSON.parse(fs.readFileSync('tests/output/p7-current.json'));console.log(JSON.stringify(pageCandidates(r.objects,...r.size,[],r.tables).map(c=>c.model)));"
 return r,json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT))
def save(raw,m,n=1):
 result=layout(m);assert result['mappingComplete'];out=worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),'edits':[{'page':n,'type':'flow','sources':m.get('sources',[]),'model':m,'fragment':result['fragment']}]});return base64.b64decode(out['bytes'])
def pixels(raw,n=0,clip=None):
 with fitz.open(stream=raw,filetype='pdf') as d:return d[n].get_pixmap(matrix=fitz.Matrix(1.5,1.5),clip=clip).samples

def both_unchanged(raw,new):
 with fitz.open(stream=raw,filetype='pdf') as a,fitz.open(stream=new,filetype='pdf') as b:
  assert len(a)==len(b)
  for i in range(len(a)):
   assert a[i].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).samples==b[i].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).samples
   assert a[i].get_text()==b[i].get_text()
 with pdfium.PdfDocument(raw) as a,pdfium.PdfDocument(new) as b:
  for i in range(len(a)):
   pa=a[i];pb=b[i];ba=pa.render(scale=1.5);bb=pb.render(scale=1.5)
   assert ba.to_pil().tobytes()==bb.to_pil().tobytes();ba.close();bb.close();pa.close();pb.close()

# One shared definition called twice on one page and again on another page.
w=PdfWriter();f=form(w,source());pg=page(w,{'/Same':f},b'q 1 0 0 1 20 190 cm /Same Do Q q 1 0 0 1 285 190 cm /Same Do Q');page(w,{'/Same':f},b'q 1 0 0 1 20 190 cm /Same Do Q')
raw=dump(w);(OUT/'p7-shared.pdf').write_bytes(raw);expanded=reopen(raw,[1]);both_unchanged(raw,expanded)
r,ms=models(raw);assert len(ms)==2 and all(m['text'].strip()=='Shared 2026' for m in ms)
m=ms[0];m['text']=m['text'].replace('2026','2025');changed=save(raw,m);(OUT/'p7-shared-edited.pdf').write_bytes(changed)
assert pixels(raw,1)==pixels(changed,1);assert pixels(raw,0,fitz.Rect(275,0,550,400))==pixels(changed,0,fitz.Rect(275,0,550,400))
with fitz.open(stream=changed,filetype='pdf') as doc:assert doc[0].get_text().count('Shared 2025')==1 and doc[0].get_text().count('Shared 2026')==1
_,again=models(changed);assert {m['text'].strip() for m in again}=={'Shared 2025','Shared 2026'}
checks.append('Same-page repeated Do and cross-page shared Form: exact dual-engine expansion, one instance edited, siblings and other page unchanged')

# Short/long replacements and complete deletion use the same shared instance.
for text in ['Short','Shared 2026 added phrase','Shared 2026 '+('A long edit contains 2026 words. '*12),'']:
 r,ms=models(raw);m=ms[0];m.update(text=text,allowOverflow=True,layoutMode='reflow')
 m['runs']=[{**m['runs'][0],'start':0,'end':len(text)}] if text else []
 changed=save(raw,m);after=inspect(changed)
 assert pixels(raw,1)==pixels(changed,1)
 logical=''.join(o.get('text','') for o in after['objects'])
 assert 'Shared 2026' in logical  # The untouched same-page instance.
 if text:assert text.replace(' ','') in logical.replace(' ','').replace('\r','').replace('\n','')
 else:assert logical.count('Shared 2026')==1
checks.append('Shared Form instance supports short/long replacement and complete deletion without changing other-page content')

# Both local scopes deliberately use /F1 with different fonts.
w=PdfWriter();refs={}
for k,font,text in [('A','helv','Regular 2026'),('B','tiro','Serif 2026')]:
 pg=source(text,font);st=ContentStream(pg.get('/Contents'),pg.pdf);fontdict=pg['/Resources']['/Font'];old=next(iter(fontdict));fontref=fontdict.raw_get(old)
 pg[N('/Resources')]=D({N('/Font'):D({N('/F1'):fontref})});st.operations=[([N('/F1'),args[1]],op)if op==b'Tf' else (args,op)for args,op in st.operations];pg[N('/Contents')]=st;refs['/'+k]=form(w,pg)
page(w,refs,b'q 1 0 0 1 20 190 cm /A Do Q q 1 0 0 1 285 190 cm /B Do Q')
raw=dump(w);both_unchanged(raw,reopen(raw,[1]));r,ms=models(raw);assert len({m['fontKey']for m in ms})==2;checks.append('Colliding /F1 resource names remain separate fonts after per-instance namespace remapping')

# Coordinate scope: nonzero CropBox, all page rotations and inner affine matrix.
for rotation in [0,90,180,270]:
 w=PdfWriter();f=form(w,source(),matrix=[.9,0,0,.9,7,11]);pg=page(w,{'/F':f},b'q 1 0 0 1 130 150 cm /F Do Q');pg.cropbox=A([F(v)for v in [100,80,500,380]]);pg.rotate(rotation)
 raw=dump(w);both_unchanged(raw,reopen(raw,[1]));r,ms=models(raw);assert len(ms)==1;m=ms[0];m['text']=m['text'].replace('2026','2025');changed=save(raw,m);r2,ms2=models(changed);assert ms2[0]['text']=='Shared 2025';assert r2['pageRotation']==rotation and r2['pageBox']==r['pageBox']
checks.append('Nested Matrix with offset CropBox and four page rotations preserves text, pixels, editing and page boxes')

# Opaque complex containers are diagnosed but never flattened.
for key in ['/Group','/StructParents','/OC']:
 w=PdfWriter();f=form(w,source());obj=f.get_object();obj[N(key)]=D({N('/S'):N('/Transparency')}) if key=='/Group' else I(0)
 page(w,{'/F':f},b'/F Do');raw=dump(w);assert reopen(raw,[1])==raw
 r=inspect(raw);assert r['editSummary']['nestedTextObjects']==1 and not r['editSummary']['editableTextObjects']
checks.append('Transparency, structure ownership and optional-content Form containers remain intact with nested-text evidence')

# Explicit semantics: stale ActualText must disappear when replacing a singleton.
for named in [False,True]:
 w=PdfWriter();pg=w.add_page(source('OLD'));st=ContentStream(pg.get('/Contents'),w);prop=D({N('/ActualText'):N('/bad')})
 from pypdf.generic import TextStringObject
 prop[N('/ActualText')]=TextStringObject('OLD')
 if named:
  pg['/Resources'][N('/Properties')]=D({N('/P1'):w._add_object(prop)});operand=N('/P1')
 else:operand=prop
 st.operations=[([N('/Span'),operand],b'BDC')]+st.operations+[([],b'EMC')];pg[N('/Contents')]=w._add_object(st);raw=dump(w)
 r,ms=models(raw);assert ms and ms[0]['text']=='OLD';m=ms[0];m['text']='NEW';changed=save(raw,m)
 with fitz.open(stream=changed,filetype='pdf') as d:assert 'NEW' in d[0].get_text() and 'OLD' not in d[0].get_text()
 with pdfium.PdfDocument(changed) as d:assert 'NEW' in d[0].get_textpage().get_text_range() and 'OLD' not in d[0].get_textpage().get_text_range()
checks.append('Inline and named ActualText singleton replacement changes both visible and copied text in MuPDF and PDFium')

# Multi-object semantics must not silently retain a stale combined value.
w=PdfWriter();pg=w.add_page(source('A'));st=ContentStream(pg.get('/Contents'),w);st.operations=[([N('/Span'),D({N('/ActualText'):TextStringObject('AB')})],b'BDC')]+st.operations+st.operations+[([],b'EMC')];pg[N('/Contents')]=w._add_object(st);r=inspect(dump(w));assert not any(o.get('flowEditable') for o in r['objects']);checks.append('Shared multi-object ActualText is explicitly protected against partial replacement')

# Equal payload does not imply equal resource semantics.
a=Stream();a.set_data(b'\x00\x01');a[N('/Subtype')]=N('/Type1C');b=Stream();b.set_data(b'\x00\x01');b[N('/Subtype')]=N('/CIDFontType0C');assert stream_identity(a)!=stream_identity(b)
b[N('/Resources')]=D();assert stream_identity(b) is None
checks.append('Stream deduplication includes scalar dictionaries and excludes resource-bearing graphs')

# Version is raised only for present features, including retained nested groups.
w=PdfWriter();w.pdf_header='%PDF-1.3';f=form(w,source(),group=True);page(w,{'/F':f},b'/F Do');raw=dump(w)
m=dict(text='New text',pageWidth=550,pageHeight=400,frame=dict(x=30,y=30,width=200,height=40),size=12,lineHeight=1.3,color='#000000',align='left',sources=[])
changed=save(raw,m);assert PdfReader(io.BytesIO(changed)).trailer['/Root']['/Version']=='/1.4'
w=PdfWriter();w.pdf_header='%PDF-1.3';w.add_blank_page(width=550,height=400);from pdf_features import ensure_version
ensure_version(w);assert '/Version' not in w._root_object
changed=save(dump(w),m);assert PdfReader(io.BytesIO(changed)).trailer['/Root']['/Version']=='/1.4'
checks.append('Retained transparency raises underdeclared PDF 1.3 to effective 1.4; ActualText is declared as 1.4 and plain documents keep their version')

# Cycle/depth checks terminate without modifying the cyclic definition.
w=PdfWriter();f=form(w,source());f.get_object()[N('/Resources')][N('/XObject')]=D({N('/Self'):f});f.get_object().set_data(b'/Self Do');page(w,{'/F':f},b'/F Do');raw=dump(w);reopened=reopen(raw,[1]);assert len(reopened)<len(raw)*4
checks.append('Cyclic wrapper reference terminates within instance/depth budget')

# Partial clips and transparency state must not become editable merely by expansion.
for command in [b'q 0 0 30 150 re W n /F Do Q',b'q /Alpha gs /F Do Q']:
 w=PdfWriter();f=form(w,source());pg=page(w,{'/F':f},command)
 if b'Alpha' in command:pg['/Resources'][N('/ExtGState')]=D({N('/Alpha'):D({N('/ca'):F(.5)})})
 raw=dump(w);r=inspect(raw);assert not any(o.get('flowEditable') for o in r['objects'])
checks.append('Partial BBox clips and external graphics-state wrappers remain protected')

(OUT/'p7-native-report.json').write_text(json.dumps({'platform':sys.platform,'checks':checks,'errors':[]},ensure_ascii=False,indent=2));print(json.dumps({'checks':checks,'errors':[]}))

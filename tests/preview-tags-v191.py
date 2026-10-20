"""Tagged backgrounds retain semantic ownership until edits are composed."""
from pathlib import Path
import base64, io, json, sys, subprocess
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'native'),str(ROOT/'native/vendor')]
from p8_helpers import models, save, dump, pixels, OUT
from story import layout
from generated_cmaps import repair
from structure_checks_v191 import assert_tag_structure_preserved
from preview_page import preview_source
import fitz, worker
from pypdf import PdfReader,PdfWriter
from pypdf.generic import ContentStream,DictionaryObject as D,ArrayObject as A,NameObject as N,NumberObject as I,TextStringObject as T

d=fitz.open();d.new_page(width=400,height=240).insert_text((30,60),'Untouched earlier page')
p=d.new_page(width=400,height=240)
p.insert_font(fontname='L',fontfile=str(ROOT/'native/fonts/DejaVuSans.ttf'))
p.insert_font(fontname='C',fontfile=str(ROOT/'native/fonts/NotoSansSC.ttf'))
p.insert_text((30,60),'1.3 ',fontsize=14,fontname='L')
p.insert_text((60,60),'未来产业与量化目标',fontsize=14,fontname='C')
d.subset_fonts();raw=repair(d.tobytes(),generated=True);d.close()
w=PdfWriter();w.clone_document_from_reader(PdfReader(io.BytesIO(raw)))
pg=w.pages[1];stream=ContentStream(pg.get('/Contents'),w);ops=[];mcid=0
for args,op in stream.operations:
    if op==b'BT':ops.append(([N('/Span' if mcid==0 else '/P'),D({N('/MCID'):I(mcid),N('/Lang'):T('en-US' if mcid==0 else 'zh-CN')})],b'BDC'))
    ops.append((args,op))
    if op==b'ET':ops.append(([],b'EMC'));mcid+=1
assert mcid==2
stream.operations=ops;pg[N('/Contents')]=w._add_object(stream);pg[N('/StructParents')]=I(7)
tree=D({N('/Type'):N('/StructTreeRoot')});tree_ref=w._add_object(tree)
block=D({N('/Type'):N('/StructElem'),N('/S'):N('/P'),N('/P'):tree_ref,N('/Pg'):pg.indirect_reference});block_ref=w._add_object(block)
span=D({N('/Type'):N('/StructElem'),N('/S'):N('/Span'),N('/P'):block_ref,N('/Pg'):pg.indirect_reference,N('/K'):I(0),N('/Lang'):T('en-US')});span_ref=w._add_object(span)
block[N('/K')]=A([span_ref,I(1)]);tree[N('/K')]=A([block_ref])
tree[N('/ParentTree')]=w._add_object(D({N('/Nums'):A([I(7),A([span_ref,block_ref])])}))
w._root_object[N('/StructTreeRoot')]=tree_ref;raw=dump(w)
_,candidates=models(raw,2);m=next(m for m in candidates if '未来产业' in m['text'])
assert len(m['sources'])==2
text=m['text'].replace('量化','量')
code="import{editStyles,editSoftBreaks}from'./src/flow-style.mjs';let s='';for await(const c of process.stdin)s+=c;const{m,text}=JSON.parse(s);m.runs=editStyles(m.runs,m.text,text,m);m.softBreaks=editSoftBreaks(m.softBreaks,m.text,text);m.text=text;console.log(JSON.stringify(m));"
m=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'m':m,'text':text}).encode()))
r=layout(m);assert r['mappingComplete'] and not r['overflow']
edit={'page':2,'type':'flow','sources':m['sources'],'model':m,'fragment':r['fragment']}
payload={'bytes':base64.b64encode(raw).decode(),'page':2,'edits':[edit]}
source,number,tagged=preview_source(payload)
assert tagged and number==2 and len(PdfReader(io.BytesIO(source)).pages)==2
background=base64.b64decode(worker.run({'command':'flow-background',**payload})['pdf'])
saved=save(raw,m,n=2,result=r)
assert_tag_structure_preserved(raw,saved)
assert pixels(raw,0)==pixels(saved,0)
assert pixels(background)==pixels(saved,1)
with fitz.open(stream=background,filetype='pdf') as view:
    assert len(view)==1 and ''.join(view[0].get_text().split())==''.join(text.split())
# Plain PDFs still use a single-page cached source.
plain=fitz.open();plain.new_page();plain.new_page();plain_raw=plain.tobytes();plain.close()
source,number,tagged=preview_source({'bytes':base64.b64encode(plain_raw).decode(),'page':2})
assert not tagged and number==1 and len(PdfReader(io.BytesIO(source)).pages)==1
report={'checks':['mixed-language MCIDs retain common ParentTree owner during preview','preview is one page and pixel-identical to actual saved page','save preserves full structure and untouched sibling','untagged preview retains single-page caching'],'errors':[]}
(OUT/'v191-preview-tags-report.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))

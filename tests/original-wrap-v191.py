"""Length changes on extracted soft wraps keep source baselines and save/reopen."""
from pathlib import Path
import base64, copy, json, subprocess, sys
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor'),str(ROOT/'tests')]
import fitz
from p8_helpers import models, save, pixels, OUT
from story import layout

doc=fitz.open();p=doc.new_page(width=400,height=400)
p.insert_font(fontname='test',fontfile=str(ROOT/'native/fonts/NotoSansSC.ttf'))
for i,line in enumerate(['春天的山野充满希望，','清晨阳光照亮了村庄，','孩子们走在田间小路，','一同欣赏美好的风光。']):
    p.insert_text((40,60+i*26),line,fontsize=14,fontname='test')
doc.new_page(width=400,height=400).insert_text((20,40),'Untouched sibling')
doc.subset_fonts();raw=doc.tobytes();doc.close()
from generated_cmaps import repair
raw=repair(raw,generated=True)
_,ms=models(raw);original=next(m for m in ms if len(m.get('softBreaks',[]))==3)
checks=[]
for operation in ['short-delete','long-delete','short-insert']:
    old=original['text'];at=old.index('\n')+3
    new=old[:at]+(old[at+1:] if operation=='short-delete' else old[at+5:] if operation=='long-delete' else old[at]+old[at:])
    code="import{editStyles,editSoftBreaks}from'./src/flow-style.mjs';let s='';for await(const c of process.stdin)s+=c;const{m,text}=JSON.parse(s);m.runs=editStyles(m.runs,m.text,text,m);m.softBreaks=editSoftBreaks(m.softBreaks,m.text,text);m.text=text;console.log(JSON.stringify(m));"
    m=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'m':original,'text':new}).encode()))
    if operation=='short-insert':m['frame']['width']+=28
    (OUT/('v191-wrap-'+operation+'.json')).write_text(json.dumps(m),encoding='utf8')
    r=layout(m)
    assert r['mappingComplete'] and not r['overflow'],(operation,{k:r.get(k) for k in ['engine','mappingComplete','overflow','fallbackCount']},m['frame'])
    assert r['engine']=='Folio anchored layout / MuPDF',operation
    assert sorted(g['start'] for g in r['glyphs'])==list(range(len(new))),operation
    assert {round(g['baseline'],3) for g in r['glyphs']} <= {round(g['baseline'],3) for g in original['originalLayout']['glyphs']}
    changed=save(raw,m,result=r)
    with fitz.open(stream=changed,filetype='pdf') as d:
        assert ''.join(d[0].get_text().split())==''.join(new.split()),operation
    assert pixels(raw,1)==pixels(changed,1)
    _,reopened=models(changed)
    assert any(x['text']==new and x['softBreaks']==m['softBreaks'] for x in reopened),operation
    checks.append(operation+': native local layout, unchanged baselines, complete offsets, exact saved text, reopened wraps and sibling pixels')
# A typed hard newline must still be laid out as a paragraph boundary.
m=copy.deepcopy(original);m['softBreaks']=[];m['text']=m['text'].replace('阳光','阳')
r=layout(m);assert r['engine']!='Folio anchored layout / MuPDF'
checks.append('typed hard breaks are not flattened by the soft-wrap fast path')
# English line wraps carry a word separator when text moves onto one line.
doc=fitz.open();p=doc.new_page(width=420,height=300)
p.insert_font(fontname='test',fontfile=str(ROOT/'native/fonts/DejaVuSans.ttf'))
for i,line in enumerate(['Some words will span','multiple physical rows','before paragraph ends.']):
    p.insert_text((40,60+i*18),line,fontsize=12,fontname='test')
doc.subset_fonts();latin_raw=repair(doc.tobytes(),generated=True);doc.close()
_,latin_models=models(latin_raw);latin=next(m for m in latin_models if len(m.get('softBreaks',[]))==2)
text=latin['text'].replace('words','word')
m=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'m':latin,'text':text}).encode()))
m['frame']['width']=320;m['frame']['height']=160
r=layout(m);assert r['engine']!='Folio anchored layout / MuPDF' and r['mappingComplete']
with fitz.open(stream=base64.b64decode(r['fragment']),filetype='pdf') as result:
    painted=result[0].get_text()
    assert 'spanmultiple' not in painted and 'rowsbefore' not in painted,painted
checks.append('English alphanumeric soft wraps retain word separators through Story fallback')
# Equal Python scalar counts are not equal UTF-16 offsets. A supplementary
# replacement before a hard newline must leave original-offset layout safely.
from original_layout import render as original_render
m=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'m':latin,'text':'😀'+latin['text'][1:]}).encode()))
m['softBreaks']=[]
assert original_render(m) is None
checks.append('BMP-to-supplementary replacement before a hard newline safely falls back without invalid UTF-16 offsets')
(OUT/'v191-original-wrap-report.json').write_text(json.dumps({'checks':checks,'errors':[]},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'checks':checks,'errors':[]}))

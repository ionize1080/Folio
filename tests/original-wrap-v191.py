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
# Length changes must not strand Chinese closing punctuation on the next line
# or an opening bracket on the previous line. Leave spare capacity at the end
# so these cases exercise local line layout rather than overflow protection.
doc=fitz.open();p=doc.new_page(width=400,height=400)
p.insert_font(fontname='test',fontfile=str(ROOT/'native/fonts/NotoSansSC.ttf'))
for i,line in enumerate(['春天的山野充满希望，','清晨，阳光照亮村庄。','孩子们走在田间小路，','真美好。']):
    p.insert_text((40,60+i*26),line,fontsize=14,fontname='test')
doc.new_page(width=400,height=400).insert_text((20,40),'Untouched sibling')
doc.subset_fonts();punct_raw=repair(doc.tobytes(),generated=True);doc.close()
_,punct_models=models(punct_raw);punct=next(m for m in punct_models if len(m.get('softBreaks',[]))==3)
from original_layout import _NO_LINE_START, _NO_LINE_END
cases=[(inserted,punct['text'][:3]+inserted+punct['text'][5 if inserted.startswith('（') else 3:]) for inserted in ['春','春天','（春天）']]
line_start=punct['text'].index('\n')+1
cases.append(('delete-line-prefix',punct['text'][:line_start]+punct['text'][line_start+2:]))
for label,new in cases:
    m=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'m':punct,'text':new}).encode()))
    r=layout(m)
    assert r['engine']=='Folio anchored layout / MuPDF' and not r['overflow'],(label,{k:r.get(k) for k in ('engine','overflow','mappingComplete')},m['text'],m['frame'])
    rows={}
    for g in r['glyphs']:
        ch=new[g['start']:g['end']]
        if ch!='\n':rows.setdefault(round(g['baseline'],3),[]).append((g['x'],ch))
    for row in rows.values():
        chars=''.join(ch for _,ch in sorted(row))
        assert chars[0] not in _NO_LINE_START and chars[-1] not in _NO_LINE_END,chars
    changed=save(punct_raw,m,result=r)
    assert pixels(punct_raw,1)==pixels(changed,1)
    _,reopened=models(changed)
    assert any(x['text']==new for x in reopened)
checks.append('Chinese commas, full stops and brackets obey local-wrap boundaries while preserving baselines, exact saved text and sibling pixels')
style=dict(fontKey=punct['fontKey'],size=14,color='#000000',bold=False,italic=False,charSpacing=0,wordSpacing=0,horizontalScale=100)
settings=dict(size=14,align='left',lineHeight=1.2,charSpacing=0,wordSpacing=0,bold=False,italic=False,firstIndent=0,paragraphBefore=0,paragraphGap=0)
frame=dict(x=40,y=40,width=120,height=100)
m={**style,**settings,'text':'春'+('，'*8)+'秋','frame':frame,'pageWidth':400,'pageHeight':300,'columns':1,
   'originalLayout':{'text':'春秋','frame':frame,'settings':settings,'glyphs':[
       dict(text=ch,start=i,end=i+1,originX=x,baseline=60,x=x,y=48,w=14,h=14,style=style)
       for i,(ch,x) in enumerate([('春',40),('秋',120)])]},'runs':[{**style,'start':0,'end':10}]}
try:
    original_render(m)
    raise AssertionError('unbreakable punctuation silently escaped fixed-column protection')
except ValueError as error:
    assert '固定列间距' in str(error)
checks.append('unbreakable punctuation retains fixed-column protection instead of escaping to paragraph reflow')
(OUT/'v191-original-wrap-report.json').write_text(json.dumps({'checks':checks,'errors':[]},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'checks':checks,'errors':[]}))

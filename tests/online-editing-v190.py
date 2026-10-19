"""Bounded, local-only corpus editing. No source PDF is ever written."""
from pathlib import Path
import sys, json, time, copy, hashlib, traceback, subprocess
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'native'),str(ROOT/'native/vendor')]
from p8_helpers import models,save,pixels
from story import layout
from system_fonts import catalog,select_font
import fitz
base=Path(sys.argv[1]); out=ROOT/'tests/output/online-v190';out.mkdir(parents=True,exist_ok=True)
specs=[('03_Multilingual','Beijing__2024',5),('03_Multilingual','HSK__',2),
 ('15_Chinese_Documents','佰维存储_',5),('15_Chinese_Documents','成都华微_',6),
 ('14_Papers','Self-Building Labs',2),('14_Papers','Beyond SAEs_',2),
 ('14_Papers','AI-Driven Reproducibility',2),('14_Papers','Mahler Method',2),
 ('06_Tables_Layouts','pdfplumber__ag-energy',1),('01_Text_Editing','pdf.js__basicapi',1),
 ('03_Multilingual','pdf.js__french_diacritics',1),('08_Navigation_Attachments','pdf.js__nested_outline',1)]
reports=[]
fallback=None
def replacement_font():
 global fallback
 if fallback is None:
  fonts=list(catalog().values()); f=next((f for f in fonts if f['postScriptName']=='SimSun'),None)
  if not f:f=next(f for f in fonts if f['postScriptName']=='MicrosoftYaHeiRegular')
  fallback=select_font(f['id'])
 return fallback
for index,(folder,prefix,page) in enumerate(specs):
 start=time.time();file=next((p for p in (base/folder).rglob('*.pdf') if p.name.startswith(prefix)),None)
 if len(sys.argv)>2 and prefix not in sys.argv[2:]:continue
 row={'sample':file.name if file else prefix,'checks':[],'limitations':[]};reports.append(row)
 try:
  if not file:raise ValueError('sample missing')
  digest=hashlib.sha256(file.read_bytes()).hexdigest();row['sha256']=digest
  with fitz.open(file) as doc:
   row['pages']=len(doc); page=min(page,len(doc));row['page']=page
   # A real sibling, so accidental shared-resource changes are detectable.
   sample=fitz.open();sample.insert_pdf(doc,from_page=page-1,to_page=min(page,len(doc)-1))
   if len(sample)==1:sample.new_page()
   raw=sample.tobytes();sample.close()
  inspected,ms=models(raw)
  row['textObjects']=sum(o['type']=='text' for o in inspected['objects']);row['paragraphs']=len(ms)
  (out/f'{index:02}-models.json').write_text(json.dumps(ms,ensure_ascii=False),encoding='utf8')
  candidates=[m for m in ms if 8<=len(m['text'].strip())<=1000 and m.get('size',0)<=20 and not m.get('cell')]
  candidates.sort(key=lambda m:(not bool('\n' in m['text']),not any('\u4e00'<=c<='\u9fff' for c in m['text'])))
  for candidate in candidates[:6]:
   m=copy.deepcopy(candidate);old=m['text'];pos=next((i for i,c in enumerate(old) if c.isalpha()),None)
   if pos is None:continue
   # Insert an existing glyph: tests reflow without relying on new font coverage.
   m['text']=old[:pos]+old[pos]+old[pos:]
   m['softBreaks']=[n+1 if n>=pos else n for n in m.get('softBreaks',[])]
   for run in m.get('runs',[]):
    if run['start']>pos:run['start']+=1
    if run['end']>=pos:run['end']+=1
   try:r=layout(m)
   except ValueError as e:
    row['limitations'].append(str(e))
    font=replacement_font();m.update(font);m['fontResolution']='user-selected';m['fontOriginalName']=font['fontName']
    for run in m.get('runs',[]):run.update(font);run['fontResolution']='user-selected';run['fontOriginalName']=font['fontName']
    m['frame']['height']=min(m['pageHeight']-m['frame']['y']-8,m['frame']['height']+m['size']*2)
    try:r=layout(m)
    except ValueError as e:row['limitations'].append(str(e));continue
    row['explicitReplacementFont']=font['fontName']
   if r.get('overflow') and r.get('mappingComplete'):
    # Match the editor's obstacle-aware downward growth, without overwriting nearby text.
    code="import{growthLimit}from './src/flow-page-model.mjs';let s='';for await(const c of process.stdin)s+=c;let {m,objects}=JSON.parse(s);console.log(growthLimit(m,objects,[],1,null));"
    limit=float(subprocess.check_output(['node','--input-type=module','-e',code],input=json.dumps({'m':m,'objects':inspected['objects']}).encode(),cwd=ROOT))
    if limit>m['frame']['height']+.5:
     old_height=m['frame']['height'];m['frame']['height']=limit
     trial=layout(m)
     if not trial.get('overflow'):r=trial;row['frameGrowth']='obstacle-limited down'
     else:m['frame']['height']=old_height
   if r.get('overflow') or not r.get('mappingComplete'):
    row['limitations'].append('insert-overflow-or-incomplete-map');continue
   try:changed=save(raw,m,result=r)
   except ValueError as e:row['limitations'].append(str(e));continue
   (out/f'{index:02}-edited.pdf').write_bytes(changed)
   (out/f'{index:02}-applied-model.json').write_text(json.dumps(m,ensure_ascii=False),encoding='utf8')
   with fitz.open(stream=changed,filetype='pdf') as doc:
    actual=''.join(doc[0].get_text().split());expected=''.join(m['text'].split())
    (out/f'{index:02}-extracted.json').write_text(json.dumps({'expected':expected,'actual':actual},ensure_ascii=False),encoding='utf8')
    assert expected in actual, 'saved text missing'
    doc[0].get_pixmap().save(out/f'{index:02}-after.png')
   assert pixels(raw,1)==pixels(changed,1),'sibling page changed'
   _,again=models(changed)
   (out/f'{index:02}-reopened-models.json').write_text(json.dumps(again,ensure_ascii=False),encoding='utf8')
   assert any(''.join(x['text'].split())==expected for x in again),'reopen model missing'
   with fitz.open(stream=raw,filetype='pdf') as doc:doc[0].get_pixmap().save(out/f'{index:02}-before.png')
   (out/f'{index:02}-edited.pdf').write_bytes(changed)
   row['checks']=['insert-save-text-roundtrip','real-sibling-pixels-unchanged','reopen-editable'];break
  row['status']='passed' if row['checks'] else 'limited-no-successful-edit'
  assert hashlib.sha256(file.read_bytes()).hexdigest()==digest
 except Exception as e:row['status']='failed';row['error']=str(e);traceback.print_exc()
 row['seconds']=round(time.time()-start,2)
 (out/'report.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps(row,ensure_ascii=False),flush=True)

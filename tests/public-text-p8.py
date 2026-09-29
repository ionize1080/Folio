"""Seeded random documents/pages, real local edits and three save/reopen rounds."""
from p8_helpers import *
import random,hashlib,urllib.request,copy,re
import pypdfium2 as pdfium
selected=json.loads((ROOT/'tests/public-text-p8.json').read_text(encoding='utf-8'));rng=random.Random(20260929);records=[]
for item in selected:
 source=OUT/'p8/text-originals'/(item['id']+'.pdf');source.parent.mkdir(parents=True,exist_ok=True)
 if not source.exists():
  req=urllib.request.Request(item['url'],headers={'User-Agent':'Mozilla/5.0 Folio regression'})
  with urllib.request.urlopen(req,timeout=180) as response:source.write_bytes(response.read())
 assert hashlib.sha256(source.read_bytes()).hexdigest()==item['sha256']
 with fitz.open(source) as document:
  number=rng.choice(item['selected']);d=fitz.open();d.insert_pdf(document,from_page=number-1,to_page=number-1);raw=d.tobytes()
 r,ms=models(raw)
 choices=[m for m in ms if m.get('originalLayout') and len(m['text'])>5 and m.get('fontKey') and not m.get('cell') and m.get('directionSupported') is not False and not m.get('rotation')]
 assert choices,item['id']
 # Random sample among supported ordinary text candidates; seed and original
 # source/page/text are recorded, so failures are exactly reproducible.
 rng.shuffle(choices);rejected=[];original_raw=raw;completed=False
 for initial in choices[:20]:
  raw=original_raw;m=copy.deepcopy(initial);edits=[]
  try:
   for cycle in range(3):
    if cycle:
     r,ms=models(raw);candidates=[p for p in ms if p.get('fontKey') and p.get('originalLayout') and p.get('directionSupported') is not False and not p.get('cell')]
     matching=[p for p in candidates if ''.join(last_text.split()) in ''.join(p['text'].split())];assert matching,('reopened paragraph missing',last_text)
     m=min(matching,key=lambda p:len(p['text']))
    before=m['text'];matches=[c for c in before if c.isascii() and c.isalnum()];assert matches
    from font_match import load_font
    face=fitz.Font(fontfile=load_font(m['fontKey'])['path'])
    unique=sorted(set(matches),key=lambda c:(face.text_length(c),c));target_char=unique[-1];replacement=unique[0];assert target_char!=replacement
    m['text']=before.replace(target_char,replacement,1);last_text=m['text'];result=layout(m)
    if not result['mappingComplete']:raise ValueError('字形映射不完整，界面禁止应用')
    raw=save(raw,m,result=result)
    with fitz.open(stream=raw,filetype='pdf') as d:assert len(d)==1 and d[0].get_pixmap().width>0
    with pdfium.PdfDocument(raw) as d:
     page=d[0];bm=page.render(scale=1);assert bm.width>0;bm.close();page.close()
    r,after=models(raw);assert any(o.get('flowEditable') for o in r['objects'])
    edits.append({'before':before,'after':m['text'],'editableObjects':sum(bool(o.get('flowEditable')) for o in r['objects'])})
   completed=True;break
  except ValueError as error:
   # Explicit unsupported ownership is a documented refusal, never a silent
   # successful edit. Any other error or damaged reopen fails this regression.
   if not any(reason in str(error) for reason in ['字形映射不完整','MCID','标签位于文字对象内部','绘制对象交错重叠','固定列间距','明确选择并确认替代字体']):raise
   rejected.append({'text':initial['text'],'reason':str(error),'completedCyclesBeforeRefusal':len(edits)})
 if not completed:
  assert rejected and all(x['completedCyclesBeforeRefusal']<3 for x in rejected)
  records.append({'id':item['id'],'url':item['url'],'sha256':item['sha256'],'page':number,'status':'explicitly-refused','edits':[],'explicitlyRejectedCandidates':rejected})
  print(item['id'],number,'explicit unsupported-scope refusals (NOT an editing pass)',flush=True)
  continue
 target=OUT/(item['id']+'-p8-text.pdf');target.write_bytes(raw)
 records.append({'id':item['id'],'url':item['url'],'sha256':item['sha256'],'page':number,'status':'three-cycle-pass','edits':edits,'explicitlyRejectedCandidates':rejected});print(item['id'],number,'three edits/reopens passed',flush=True)
assert sum(r.get('status')=='three-cycle-pass' for r in records)>=2,records
(OUT/'p8-public-text-report.json').write_text(json.dumps({'seed':20260929,'documents':records,'errors':[]},ensure_ascii=False,indent=2),encoding='utf-8')

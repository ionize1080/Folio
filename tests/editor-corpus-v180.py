"""Local-only real-page editing; originals never written or distributed."""
from pathlib import Path
import sys, json, time, copy, traceback
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'native'),str(ROOT/'native/vendor')]
from p8_helpers import models,save,pixels,OUT
import fitz
out=OUT/'editor-corpus-v180';out.mkdir(exist_ok=True)
files=[p for folder in sys.argv[1:] for p in ([Path(folder)] if Path(folder).is_file() else Path(folder).glob('*.pdf')) if '-test' not in p.name]
results=[]
for index,file in enumerate(files):
 row={'name':file.name,'checks':[],'errors':[]};start=time.time()
 try:
  with fitz.open(file) as original:
   row['pages']=len(original)
   candidates=[i for i in range(min(60,len(original))) if len(original[i].get_text().strip())>120]
   if not candidates:row['scanOnly']=True
   for i in candidates[:8]:
    sample=fitz.open();sample.insert_pdf(original,from_page=i,to_page=i);sample.new_page();raw=sample.tobytes();sample.close()
    inspected,ms=models(raw)
    editable=[m for m in ms if len(m.get('text','').strip())>=6 and any(c.isalpha() for c in m['text'])]
    editable.sort(key=lambda m:(m.get('size',99)>15,not any(c.isdigit() for c in m['text']),len(m['text'])>300))
    if not editable:continue
    row['page']=i+1;row['editableBlocks']=len(editable)
    m=copy.deepcopy(editable[0]);chars=m['text'];positions=[j for j,c in enumerate(chars) if c.isalpha()];j=positions[-1]
    from font_match import load_font
    font=load_font(m.get('fontKey'));face=fitz.Font(fontfile=font['path']) if font else None
    replacement=next((c for c in chars if c.isalpha() and c!=chars[j] and c.islower() and (not face or face.text_length(c)<=face.text_length(chars[j]))),None)
    if replacement is None:continue
    m['text']=chars[:j]+replacement+chars[j+1:]
    # Preserve glyph count to exercise normal in-place corrections.
    from story import layout
    try:result=layout(m)
    except ValueError as e:
     row.setdefault('blockedAttempts',[]).append({'page':i+1,'reason':str(e)});continue
    if result.get('overflow'):
     row.setdefault('blockedAttempts',[]).append({'page':i+1,'reason':'frame-overflow'});continue
    if not result.get('mappingComplete'):
     row.setdefault('blockedAttempts',[]).append({'page':i+1,'reason':'incomplete-glyph-map'});continue
    try:changed=save(raw,m,result=result)
    except ValueError as e:
     row.setdefault('blockedAttempts',[]).append({'page':i+1,'reason':str(e)});continue
    row['checks'].append('apply')
    (out/f'{index:02}-edited.pdf').write_bytes(changed)
    assert pixels(raw,1)==pixels(changed,1);row['checks'].append('other-page-unchanged')
    with fitz.open(stream=changed,filetype='pdf') as doc:
     text=doc[0].get_text();assert m['text'].replace(' ','').replace('\n','') in text.replace(' ','').replace('\n',''),{'expected':m['text'],'actual':text}
     doc[0].get_pixmap(matrix=fitz.Matrix(1,1)).save(out/f'{index:02}-after.png')
    with fitz.open(stream=raw,filetype='pdf') as doc:doc[0].get_pixmap(matrix=fitz.Matrix(1,1)).save(out/f'{index:02}-before.png')
    (out/f'{index:02}-edited.pdf').write_bytes(changed)
    row['checks'].append('saved-text-roundtrip');_,again=models(changed);assert again;row['checks'].append('reopen-editable');break
   if not row['checks'] and not row.get('scanOnly'):row['noEditableSample']=True
 except Exception as e:row['errors'].append(str(e));traceback.print_exc()
 row['seconds']=round(time.time()-start,2);results.append(row)
 (out/'report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps(row,ensure_ascii=False),flush=True)

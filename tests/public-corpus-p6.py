"""Pinned public regression corpus. Documents are downloaded, not redistributed.

50 pages across annual reports, a control catalog, SDK/manuals, RFC, datasheet,
research paper, government form and Unicode specification. Hashes pin content.
"""
from pathlib import Path
import os,sys,json,hashlib,urllib.request,time,base64,subprocess
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz,worker,pikepdf,shutil
from pypdf import PdfReader,PdfWriter
OUT=ROOT/'tests/output/p6';OUT.mkdir(exist_ok=True,parents=True)
cache=Path(os.environ.get('FOLIO_P6_CORPUS',OUT/'originals'));cache.mkdir(exist_ok=True,parents=True)
(OUT/'samples').mkdir(exist_ok=True);inventory=[];results=[]
for item in json.loads((ROOT/'tests/public-corpus-p6.json').read_text(encoding='utf-8')):
 source=cache/(item['id']+'.pdf')
 if not source.exists():
  request=urllib.request.Request(item['url'],headers={'User-Agent':'Mozilla/5.0 (Folio regression corpus)'})
  with urllib.request.urlopen(request,timeout=180) as response:data=response.read()
  assert hashlib.sha256(data).hexdigest()==item['sha256'],item['id'];source.write_bytes(data)
 assert hashlib.sha256(source.read_bytes()).hexdigest()==item['sha256'],item['id']
 reader=PdfReader(source);assert len(reader.pages)==item['pages']
 sample=OUT/'samples'/(item['id']+'-5pages.pdf')
 if item['pages']==5:shutil.copyfile(source,sample)
 else:
  with pikepdf.open(source) as pdf:
   selected=pikepdf.Pdf.new();selected.add_pages_from(pdf,[pn-1 for pn in item['selected']]);selected.save(sample)
 inventory.append({**item,'path':str(sample.resolve())});entry={'id':item['id'],'pages':[]}
 for index,pn in enumerate(item['selected'],1):
  t=time.perf_counter();r=worker.run({'command':'inspect','input':str(sample.resolve()),'page':index})
  text=[o for o in r['objects'] if o['type']=='text'];assert any(o.get('flowEditable') for o in text),(item['id'],pn)
  entry['pages'].append({'page':index,'originalPage':pn,'editable':sum(bool(o.get('flowEditable')) for o in text),'textObjects':len(text),'fonts':list(r['fonts'].values()),'seconds':round(time.perf_counter()-t,3)})
  (OUT/(item['id']+'-'+str(index)+'-inspect.json')).write_text(json.dumps(r,ensure_ascii=False),encoding='utf-8')
 results.append(entry);print(item['id'],'5 pages inspected',flush=True)
(OUT/'inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf-8')
(ROOT/'tests/output/p6-corpus-report.json').write_text(json.dumps({'documents':results,'pages':sum(len(r['pages']) for r in results),'errors':[]},ensure_ascii=False,indent=2),encoding='utf-8')

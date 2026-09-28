"""Optional private sample QA. Input remains external to repository artifacts."""
import sys,io,json,hashlib,base64,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import worker,fitz,pypdfium2 as pdfium,numpy as np
from form_compat import reopen
from story import layout
src=Path(sys.argv[1]);raw=src.read_bytes();out=ROOT/'tests/output';out.mkdir(exist_ok=True)
normalized=reopen(raw,list(range(1,21)));rows=[];edits=[]
with fitz.open(stream=raw,filetype='pdf') as a,fitz.open(stream=normalized,filetype='pdf') as b,pdfium.PdfDocument(raw) as pa,pdfium.PdfDocument(normalized) as pb:
 for i in range(len(a)):
  assert a[i].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).samples==b[i].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).samples
  assert a[i].get_text()==b[i].get_text()
  x=pa[i].render(scale=1.5);y=pb[i].render(scale=1.5);diff=np.abs(np.asarray(x.to_pil()).astype(int)-np.asarray(y.to_pil()).astype(int));x.close();y.close();assert diff.max()<=1
  r=worker.run({'command':'inspect','bytes':base64.b64encode(raw).decode(),'page':i+1});(out/'p7-yearbook-current.json').write_text(json.dumps(r))
  code="import fs from 'node:fs';import{pageCandidates}from './src/flow-page-model.mjs';const r=JSON.parse(fs.readFileSync('tests/output/p7-yearbook-current.json'));console.log(JSON.stringify(pageCandidates(r.objects,...r.size,[],r.tables).map(c=>c.model)));"
  models=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT))
  row={'page':i+1,'editable':sum(bool(o.get('flowEditable'))for o in r['objects']),'nested':r['editSummary']['nestedTextObjects'],'models':len(models),'mupdfPixelsExact':True,'textExact':True,'pdfiumMaxChannelDifference':int(diff.max()),'pdfiumChangedChannels':int(np.count_nonzero(diff))};rows.append(row)
  if i+1==19:
   for m in models:
    assert not ('新华社北京' in m['text'] and '员、国务院副总理' in m['text'])
   row['columnsSeparated']=True
  if i+1 in (2,12,19,20):
   before,after={2:('2025','2022'),12:('目录','录目'),19:('2024','2026'),20:('2024','2026')}[i+1]
   m=next(m for m in models if before in m['text']);m['text']=m['text'].replace(before,after,1);m['allowOverflow']=True
   res=layout(m);assert res['mappingComplete'];saved=worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),'edits':[{'page':i+1,'type':'flow','sources':m['sources'],'model':m,'fragment':res['fragment']}]});blob=base64.b64decode(saved['bytes'])
   with fitz.open(stream=blob,filetype='pdf') as d, fitz.open(stream=raw,filetype='pdf') as fresh:
    assert after in d[i].get_text()
    for j in range(len(a)):
     if j!=i:
      if fresh[j].get_pixmap().samples!=d[j].get_pixmap().samples:
       (out/'p7-yearbook-failed.pdf').write_bytes(blob)
       xx=np.frombuffer(fresh[j].get_pixmap().samples,np.uint8).astype(int);yy=np.frombuffer(d[j].get_pixmap().samples,np.uint8).astype(int)
       print('repeat diff',j+1,int(np.abs(xx-yy).max()),int(np.count_nonzero(xx-yy)),flush=True)
       raise AssertionError(('other page',j+1))
   again=worker.run({'command':'inspect','bytes':saved['bytes'],'page':i+1});assert after in ''.join(o.get('text','')for o in again['objects'])
   edits.append({'page':i+1,'mappingComplete':True,'overflow':res['overflow'],'frameOverset':res.get('frameOverset'),'layoutMode':res['layoutMode'],'otherPagesExact':len(a)-1,'reopen':True})
  print(json.dumps(row),flush=True)
report={'sha256':hashlib.sha256(raw).hexdigest(),'pages':rows,'edits':edits,'errors':[],'platform':sys.platform,'scope':'Private 20-page sample; no full yearbook or native Windows sample claim'}
(out/'p7-yearbook-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))

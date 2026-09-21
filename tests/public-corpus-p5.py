"""Download pinned public PDF.js fixtures and inspect every page.

Set FOLIO_CORPUS_DIR to reuse downloads. Optional file arguments add private
documents locally; neither their contents nor paths appear in public reports.
"""
from pathlib import Path
import sys, os, json, hashlib, urllib.request, time
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz,worker
OUT=ROOT/'tests/output';OUT.mkdir(exist_ok=True)
cache=Path(os.environ.get('FOLIO_CORPUS_DIR',OUT/'public-corpus'));cache.mkdir(exist_ok=True)
files=[]
for item in json.loads((ROOT/'tests/public-corpus-p5.json').read_text()):
    p=cache/item['file']
    if not p.exists():
        with urllib.request.urlopen(item['url'],timeout=60) as response:p.write_bytes(response.read())
    assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256'],item['file']
    files.append((item['file'],p))
files.extend((f'private-{i+1}',Path(p)) for i,p in enumerate(sys.argv[1:]))
results=[]
for name,p in files:
    doc=fitz.open(p);entry={'file':name,'pages':len(doc),'results':[]}
    for pn in range(1,len(doc)+1):
        start=time.perf_counter();r=worker.run({'command':'inspect','input':str(p),'page':pn})
        texts=[o for o in r['objects'] if o['type']=='text']
        controls=sum(sum(ord(c)<32 and c not in '\r\n\t' for c in o.get('text','')) for o in texts)
        if name=='ArabicCIDTrueType.pdf':assert all(f['fontResolution']=='embedded' for f in r['fonts'].values())
        if name=='tracemonkey.pdf':assert controls==0,(pn,controls)
        if name=='french_diacritics.pdf':assert all('nknown' not in f['fontName'] or f['fontName']=='Unknown' for f in r['fonts'].values())
        entry['results'].append({'page':pn,'textObjects':len(texts),'editableText':sum(bool(o.get('flowEditable')) for o in texts),'controlCharacters':controls,'tables':len(r['tables']),'fontResolutions':sorted(set(f['fontResolution'] for f in r['fonts'].values())),'seconds':round(time.perf_counter()-start,3)})
    results.append(entry);print(name,len(doc),'pages inspected',flush=True)
(OUT/'p5-corpus-report.json').write_text(json.dumps({'documents':results,'pages':sum(r['pages'] for r in results),'errors':[]},indent=2))

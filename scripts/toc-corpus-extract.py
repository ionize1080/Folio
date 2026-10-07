"""Optional corpus extraction: python scripts/toc-corpus-extract.py OUTPUT INPUT_DIR...
Requires PyMuPDF; input PDFs are not bundled. Then run node tests/smart-toc-corpus.mjs OUTPUT.
"""
from pathlib import Path
import fitz,json,time,math,hashlib
import sys
out=Path(sys.argv[1]);out.mkdir(exist_ok=True,parents=True)
files=[f for folder in sys.argv[2:] for f in sorted(Path(folder).glob('*.pdf'))]
for idx,file in enumerate(files):
 start=time.time();target=out/f'{idx:02}.json'
 if target.exists():continue
 try:
  doc=fitz.open(file);toc=[];pages={}
  for p in doc:
   blocks=p.get_text('dict', flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)['blocks'];fragments=[];lines=[]
   for b in blocks:
    for l in b.get('lines',[]):
     for s in l['spans']:
      if s['text'].strip():
       q=fitz.recover_quad(l['dir'],s);fragments.append(dict(text=s['text'],quad=[list(q.ul),list(q.ur),list(q.lr),list(q.ll)],angle=math.degrees(math.atan2(l['dir'][1],l['dir'][0]))))
     text=''.join(s['text'] for s in l['spans']).strip();x,y,r,bottom=l['bbox']
     if text:lines.append(dict(text=text,page=p.number+1,left=x,right=r,top=y,bottom=bottom,height=p.rect.height,x=x,y=p.rect.height-y,upX=0,upY=1))
   if p.number<50:toc.append(dict(page=p.number+1,width=p.rect.width,height=p.rect.height,fragments=fragments))
   pages[str(p.number+1)]=lines
  data=dict(name=file.name,path=str(file),pageCount=len(doc),toc=toc,pages=pages,seconds=round(time.time()-start,2))
  target.write_text(json.dumps(data,ensure_ascii=False),encoding='utf8');print(file.name,len(doc),data['seconds'],flush=True)
 except Exception as e:print(file.name,str(e),flush=True)


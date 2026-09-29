"""Seeded exploration corpus, independent of fixed P6 regressions.
Download exact public originals; test all pages up to five per file. Record real
scans separately from digital text. No scan is manufactured from native text.
"""
from pathlib import Path
import sys,json,hashlib,urllib.request,base64,io,time
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'native'))
import fitz,worker,pypdfium2 as pdfium
from pypdf import PdfReader,PdfWriter
OUT=ROOT/'tests/output/p8-public';OUT.mkdir(exist_ok=True,parents=True)
manifest=json.loads((ROOT/'tests/public-corpus-p8.json').read_text());documents=[];errors=[]
def call(data,command,**kw):return worker.run({'command':command,'bytes':base64.b64encode(data).decode(),**kw})
def pixels(data,page):
 with fitz.open(stream=data,filetype='pdf') as d:return d[page].get_pixmap(matrix=fitz.Matrix(.75,.75)).samples
for entry in manifest['documents']:
 path=OUT/entry['name']
 if not path.exists():path.write_bytes(urllib.request.urlopen(entry['url'],timeout=90).read())
 raw=path.read_bytes();assert hashlib.sha256(raw).hexdigest()==entry['sha256']
 with fitz.open(stream=raw,filetype='pdf') as d:count=len(d);types=[{'textCharacters':len(p.get_text().strip()),'images':len(p.get_images())} for p in d]
 result={**entry,'pageCount':count,'pages':[]}
 for page in range(1,min(count,5)+1):
  start=time.perf_counter();ins=call(raw,'inspect',page=page);record={'page':page,**types[page-1],'imageTests':[],'textTests':[],'limitedObjects':[]}
  for o in ins['objects']:
   if o['type']=='image' and not o['editable']:record['limitedObjects'].append({'index':o['index'],'reason':o.get('reason')})
  images=[o for o in ins['objects'] if o['type']=='image' and o['editable']]
  if images:
   obj=images[0]
   # Identity adjustment must preserve actual visible pixels, not merely leave
   # a parseable file. This catches blank output from an invalid decoder PDF.
   from PIL import Image,ImageChops,ImageStat
   matrix=list(obj['matrix']);matrix[4]+=ins['pageOrigin'][0];matrix[5]+=ins['pageOrigin'][1]
   identity=base64.b64decode(call(raw,'apply',edits=[{**obj,'page':page,'matrix':matrix,'adjustments':{}}])['bytes'])
   def raster(data):
    with fitz.open(stream=data,filetype='pdf') as d:
     pix=d[page-1].get_pixmap(matrix=fitz.Matrix(.75,.75),alpha=False)
     return Image.frombytes('RGB',(pix.width,pix.height),pix.samples)
   before_image,after_image=raster(raw),raster(identity)
   delta=ImageStat.Stat(ImageChops.difference(before_image,after_image)).mean
   # JPEG renderers may use scaled IDCT for the original DCT image, whereas
   # lossless adjusted RGB is resampled from full pixels. Verified at native
   # resolution (<0.2 mean difference); allow <0.8% at this thumbnail scale.
   assert max(delta)<2.0,(entry['name'],page,'identity pixels changed',delta)
   ink_before=255-ImageStat.Stat(before_image.convert('L')).mean[0]
   ink_after=255-ImageStat.Stat(after_image.convert('L')).mean[0]
   if ink_before>0.1:assert abs(ink_after-ink_before)/ink_before<.05,(entry['name'],'image ink lost',ink_before,ink_after)
   record['identityMeanPixelDelta']=delta
   for name,adjustments,crop in [('scan-color',{'preset':'scan-color'},[0,0,0,0]),('curves',{'contrast':20,'curves':[[0,0],[64,48],[190,210],[255,255]]},[0,0,0,0]),('blur-crop',{'blur':1.2},[3,4,2,0])]:
    preview=call(raw,'image-preview',page=page,index=obj['index'],adjustments=adjustments)
    matrix=list(obj['matrix']);matrix[4]+=ins['pageOrigin'][0];matrix[5]+=ins['pageOrigin'][1]
    edited=base64.b64decode(call(raw,'apply',edits=[{**obj,'page':page,'matrix':matrix,'adjustments':adjustments,'crop':crop}])['bytes'])
    with fitz.open(stream=edited,filetype='pdf') as d:assert len(d)==count;d[page-1].get_pixmap()
    with pdfium.PdfDocument(edited) as d:
     pg=d[page-1];bmp=pg.render(scale=.5);assert bmp.width>0;bmp.close();pg.close()
    for sibling in range(count):
     if sibling!=page-1:assert pixels(raw,sibling)==pixels(edited,sibling),(entry['name'],page,sibling)
    (OUT/(path.stem+f'-{page}-{name}.pdf')).write_bytes(edited)
    record['imageTests'].append(name)
   if not types[page-1]['textCharacters'] and page==1:
    ocr=call(raw,'ocr',page=page,profile='v6',dpi=180,threads=2,skipText=False)
    record['ocr']={'blocks':len(ocr['blocks']),'needsReview':sum(bool(b.get('needsReview')) for b in ocr['blocks']),'seconds':ocr['seconds']}
    assert ocr['blocks'],entry['name']+' OCR returned no candidates'
  text=[o for o in ins['objects'] if o.get('editable') and o['type']=='text']
  if text:
   obj=text[0]
   for label,value in [('short','P8'),('long','Folio long insertion 2026 '+ 'testing '*10),('delete','')]:
    matrix=list(obj['matrix']);matrix[4]+=ins['pageOrigin'][0];matrix[5]+=ins['pageOrigin'][1]
    edited=base64.b64decode(call(raw,'apply',edits=[{**obj,'page':page,'matrix':matrix,'text':value,'delete':not value}])['bytes'])
    with fitz.open(stream=edited,filetype='pdf') as d:assert len(d)==count
    for sibling in range(count):
     if sibling!=page-1:assert pixels(raw,sibling)==pixels(edited,sibling)
    record['textTests'].append(label)
  record['seconds']=round(time.perf_counter()-start,3);result['pages'].append(record)
 documents.append(result);print(entry['name'],len(result['pages']),'pages verified',flush=True)
report={'seed':manifest['seed'],'sourceCommit':manifest['sourceCommit'],'platform':sys.platform,'documents':documents,'pages':sum(len(d['pages']) for d in documents),'errors':errors}
(ROOT/'tests/output/p8-corpus-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));assert len(documents)==8

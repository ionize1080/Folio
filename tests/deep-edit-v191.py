"""Deep, reproducible native/editor-model corpus benchmark; never mutates samples.

Run from Folio with its clean packaged Python (or native/runtime/python.exe):
  python tests/deep-edit-v191.py --label final
  python tests/deep-edit-v191.py --label baseline --code-root tests/output/deep-edit-v191/baseline/code

The first run freezes four targets per real page in plan.json. Later runs replay
those same PDF text-object sets, reporting missing/changed candidates separately.
All produced PDFs, model text and renders stay in ignored tests/output/.
"""
from pathlib import Path
import argparse,base64,copy,hashlib,json,math,os,re,subprocess,sys,time,traceback
from collections import Counter
from datetime import datetime,timezone
from functools import lru_cache

ROOT=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser()
ap.add_argument('--samples',type=Path,default=Path(r'D:\APP\PDF Samples'))
ap.add_argument('--out',type=Path,default=ROOT/'tests/output/deep-edit-v191')
ap.add_argument('--code-root',type=Path,default=ROOT)
ap.add_argument('--label',default='final')
ap.add_argument('--pages',nargs='*',help='Optional IDs such as textbook-9 strategy-2')
ap.add_argument('--refresh-plan',action='store_true')
ap.add_argument('--whole-documents',action='store_true',help='Also edit/save both complete source PDFs and verify every untouched page')
args=ap.parse_args();CODE=args.code_root.resolve();OUT=args.out.resolve();RUN=OUT/args.label
RUN.mkdir(parents=True,exist_ok=True)
sys.path[:0]=[str(CODE/'native'),str(CODE/'native/vendor'),str(CODE/'tests'),str(ROOT/'tests')]
sys.stdout.reconfigure(encoding='utf8')
import fitz,worker,pypdfium2 as pdfium,fontTools
from story import layout
from structure_checks_v191 import assert_tag_structure_preserved
from annotation_checks_v191 import phonetic_audit

SPECS=[('textbook','义务教育教科书·语文五年级下册.pdf',n) for n in (7,9,10,12,14,25,40,60,100,110)]+[
 ('strategy','十五五规划投资全景_跨市场五年配置策略.pdf',n) for n in (2,3,4,5,6,7,8,9,11,12)]
OPERATIONS=('short-insert','long-insert','short-delete','long-delete','body-long-insert','body-long-delete')
ACTIVE_PAGE=1
JS="let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s);"

def js(code,data):
 return json.loads(subprocess.check_output(['node','--input-type=module','-e',JS+code],input=json.dumps(data).encode(),cwd=CODE))
def milliseconds(start):return round((time.perf_counter()-start)*1000,2)
def hashbytes(data):return hashlib.sha256(data).hexdigest()
def dump(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
def compact(text):return ''.join(text.split())
def characters(text):return Counter(compact(text.translate(str.maketrans(dict(zip('ﬀﬁﬂﬃﬄﬅﬆ',['ff','fi','fl','ffi','ffl','st','st']))))))
def source_ids(model):return sorted(s['index'] for s in model.get('sources',[]))
def fonts(model):
 keys=('fontName','fontOriginalName','fontResolution','fontKey','fontFallback','syntheticBold','syntheticItalic')
 return [dict({k:m.get(k) for k in keys if m.get(k) is not None},start=m.get('start'),end=m.get('end')) for m in [model]+model.get('runs',[])]
def inspect(raw):
 start=time.perf_counter();data=worker.run({'command':'inspect','bytes':base64.b64encode(raw).decode(),'page':ACTIVE_PAGE});native_ms=milliseconds(start)
 start=time.perf_counter();ms=js("import{pageCandidates}from'./src/flow-page-model.mjs';console.log(JSON.stringify(pageCandidates(v.objects,...v.size,[],v.tables).map(c=>c.model)));",data)
 return data,ms,{'inspectMs':native_ms,'paragraphModelMs':milliseconds(start)}
def classify(error):
 for needle,label in [('原字体','font-unavailable'),('字形','glyph-unavailable'),('字位','glyph-mapping'),('交错重叠','overlap'),('遮挡','overlap'),('分隔线','rule-overlap'),('MCID','tagged-boundary'),('裁剪','clip-boundary'),('映射','mapping'),('排版参数','typography')]:
  if needle in error:return label
 return 'rejected'
def edit_model(m,operation):
 text=m['text'];n=len(text);pos=max(1,min(n-1,round(n*{'short-insert':.2,'long-insert':.48,'short-delete':.35,'long-delete':.6,'body-long-insert':.72,'body-long-delete':.22}[operation])))
 operation=operation.removeprefix('body-')
 if operation=='short-insert':insert=''.join(c for c in text if c.isalnum())[:2];removed='';new=text[:pos]+insert+text[pos:]
 elif operation=='long-insert':
  fragment=''.join(c for c in text if not c.isspace());insert=(fragment*max(1,math.ceil(48/max(1,len(fragment)))))[:min(72,max(32,n//2))];removed='';new=text[:pos]+insert+text[pos:]
 else:
  length=2 if operation=='short-delete' else min(60,max(12,n//3));pos=min(pos,max(1,n-length-1));removed=text[pos:pos+length];insert='';new=text[:pos]+text[pos+length:]
 edited=js("import{editStyles,editSoftBreaks}from'./src/flow-style.mjs';let m=v.model;const old=m.text;m.runs=editStyles(m.runs||[],old,v.text,m);m.softBreaks=editSoftBreaks(m.softBreaks||[],old,v.text);m.text=v.text;console.log(JSON.stringify(m));",{'model':m,'text':new})
 return edited,dict(offset=pos,insertedCharacters=len(insert),deletedCharacters=len(removed),insertedText=insert,deletedText=removed)
def growth(m,objects,r,attempt):
 if not (r.get('overflow') or r.get('frameOverset')) or m.get('cell'):return r
 limits=js("import{growthLimit,horizontalLimit,suggestGrowth}from'./src/flow-page-model.mjs';const q=suggestGrowth(v.m,v.objects,[],[],1,null);const dimension=q.direction==='right'?'width':'height';console.log(JSON.stringify({direction:q.direction,dimension,limit:q.direction==='right'?horizontalLimit(v.m,v.objects,[],1,null):growthLimit(v.m,v.objects,[],1,null)}));",{'m':m,'objects':objects})
 dimension=limits['dimension'];low=m['frame'][dimension];original_size=low;high=limits['limit']
 if limits['direction']=='fixed' or high<=low+.5:return r
 trial=copy.deepcopy(m);trial['frame'][dimension]=high;result=layout(trial)
 if result.get('overflow') or not result.get('mappingComplete'):return r
 for _ in range(6):
  if high-low<=.5:break
  mid=(high+low)/2;trial['frame'][dimension]=mid;candidate=layout(trial)
  if candidate.get('overflow') or not candidate.get('mappingComplete'):low=mid
  else:high=mid;result=candidate
 m['frame'][dimension]=high;attempt['frameGrowth']={'direction':limits['direction'],'before':original_size,'after':high}
 return result
def prefix_positions(original,edited,result):
 old={g['start']:g for g in original.get('originalLayout',{}).get('glyphs',[])}
 new={g['start']:g for g in result.get('glyphs',[])};offset=0;distances=[]
 for a,b in zip(original['text'],edited['text']):
  if a!=b:break
  if not a.isspace() and offset in old and offset in new:
   left=old[offset];right=new[offset]
   distances.append(math.hypot(left.get('originX',left['x'])-right.get('originX',right['x']),left.get('baseline',left['y'])-right.get('baseline',right['y'])))
  offset+=len(a.encode('utf-16-le'))//2
 return dict(comparedGlyphs=len(distances),maxDriftPoints=round(max(distances,default=0),4),meanDriftPoints=round(sum(distances)/len(distances),4) if distances else None,within01Point=sum(x<=.1 for x in distances))
def mask_boxes(m,result,objects):
 ids=set(source_ids(m));h=m['pageHeight'];boxes=[]
 for o in objects:
  if o['index'] in ids:
   l,b,r,t=o['bounds'];boxes.append([l,h-t,r,h-b])
 boxes += [[g['x'],g['y'],g['x']+g['w'],g['y']+g['h']] for g in result.get('glyphs',[])]
 return [[b[0]-2,b[1]-2,b[2]+2,b[3]+2] for b in boxes]
def render(raw,index,engine,scale=1.5):
 if engine=='MuPDF':
  with fitz.open(stream=raw,filetype='pdf') as doc:
   p=doc[ACTIVE_PAGE-1+index].get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False);return p.width,p.height,p.n,p.stride,p.samples
 with pdfium.PdfDocument(raw) as doc:
  p=doc[ACTIVE_PAGE-1+index];bm=p.render(scale=scale);im=bm.to_pil().convert('RGB');result=(im.width,im.height,3,im.width*3,im.tobytes());bm.close();p.close();return result
def compare_pixels(before,after,boxes,engine):
 # Mask each source/new-glyph rectangle separately, never their broad page union.
 # This preserves coverage of neighbouring words/figures between edited lines.
 import numpy as np
 a=render(before,0,engine);b=render(after,0,engine)
 if a[:4]!=b[:4]:raise AssertionError('page geometry changed: '+engine)
 width,height,n,stride,_=a
 aa=np.frombuffer(a[-1],dtype=np.uint8).reshape(height,stride)[:,:width*n].reshape(height,width,n)
 bb=np.frombuffer(b[-1],dtype=np.uint8).reshape(height,stride)[:,:width*n].reshape(height,width,n)
 changed=np.any(aa!=bb,axis=2);mask=np.zeros((height,width),dtype=bool)
 for x0,y0,x1,y1 in boxes:mask[max(0,math.floor(y0*1.5)):min(height,math.ceil(y1*1.5)),max(0,math.floor(x0*1.5)):min(width,math.ceil(x1*1.5))]=True
 outside=changed & ~mask
 return dict(totalChangedPixels=int(changed.sum()),outsideChangedPixels=int(outside.sum()),maskedPixels=int(mask.sum()),totalPixels=width*height)
def standard_text(raw):
 with fitz.open(stream=raw,filetype='pdf') as doc:return doc[ACTIVE_PAGE-1].get_text()
def pdfium_text(raw):
 with pdfium.PdfDocument(raw) as doc:
  p=doc[ACTIVE_PAGE-1];tp=p.get_textpage();text=tp.get_text_range();tp.close();p.close();return text
def pdfium_unmapped_characters(raw):
 out=[]
 with pdfium.PdfDocument(raw) as doc:
  page=doc[ACTIVE_PAGE-1];tp=page.get_textpage();h=page.get_height()
  for i in range(tp.count_chars()):
   ch=tp.get_text_range(i,1)
   if ch not in ('\ufffe','\uffff','\ufffd'):continue
   left,bottom,right,top=tp.get_charbox(i);out.append(dict(index=i,text=ch,x=(left+right)/2,y=h-(bottom+top)/2))
  tp.close();page.close()
 return out
def font_names(raw):
 with fitz.open(stream=raw,filetype='pdf') as doc:return sorted(set(span['font'] for block in doc[ACTIVE_PAGE-1].get_text('dict')['blocks'] for line in block.get('lines',[]) for span in line['spans']))
@lru_cache(maxsize=256)
def font_resource(key):
 from font_match import load_font
 from fontTools.ttLib import TTFont
 info=load_font(key)
 if not info:return None
 font=TTFont(info['path']);return font,font.getBestCmap() or {},font.getGlyphSet(),font['head'].unitsPerEm
@lru_cache(maxsize=24000)
def glyph_signature(key,cp):
 from fontTools.pens.recordingPen import DecomposingRecordingPen
 resource=font_resource(key)
 if not resource:return None
 font,cmap,glyphs,upm=resource;name=cmap.get(cp)
 if not name:return None
 pen=DecomposingRecordingPen(glyphs);glyphs[name].draw(pen)
 def norm(value):
  if isinstance(value,(float,int)):return round(value/upm,5)
  if isinstance(value,(list,tuple)):return [norm(x) for x in value]
  return value
 # Compare the decomposed outline independently of subset glyph IDs, names or
 # advances. The writer can legally bake tracking into hmtx; raw advance equality
 # would incorrectly label an unchanged outline as a substituted typeface.
 return hashbytes(json.dumps(norm(pen.value),sort_keys=True).encode())
def audit_font_shapes(expected,actual):
 def style(model,offset):return next((r for r in model.get('runs',[]) if r['start']<=offset<r['end']),model)
 checked=0;unavailable=0;differences=[];size_differences=[];offset=0
 for ch in expected['text']:
  before=style(expected,offset);after=style(actual,offset);offset+=len(ch.encode('utf-16-le'))//2
  if ch.isspace():continue
  old=glyph_signature(before.get('fontKey',expected.get('fontKey')),ord(ch));new=glyph_signature(after.get('fontKey',actual.get('fontKey')),ord(ch))
  if old is None or new is None:unavailable+=1
  else:
   checked+=1
   if old!=new:differences.append(dict(offset=offset-1,character=ch,beforeFont=before.get('fontName'),afterFont=after.get('fontName')))
  oldsize=before.get('size',expected['size']);newsize=after.get('size',actual['size'])
  if abs(oldsize-newsize)>.06:size_differences.append(dict(offset=offset-1,before=oldsize,after=newsize))
 return dict(checkedCharacters=checked,unavailableCharacters=unavailable,outlineDifferences=len(differences),sizeDifferences=len(size_differences),examples=differences[:8],sizeExamples=size_differences[:8])
def verify(before,after,accepted,objects,has_sibling):
 errors=[];checks={};source_text=standard_text(before);expected=characters(source_text)
 expected_pdfium=characters(pdfium_text(before));unmapped=pdfium_unmapped_characters(before);normalized=[]
 for item in accepted:
  original=item['original'];encoded=original['text'].encode('utf-16-le')
  for bad in unmapped:
   if bad['index'] in normalized:continue
   candidates=[g for g in original.get('originalLayout',{}).get('glyphs',[]) if g['x']-1<=bad['x']<=g['x']+g['w']+1 and g['y']-1<=bad['y']<=g['y']+g['h']+1]
   if not candidates:continue
   g=min(candidates,key=lambda x:math.hypot(x['x']+x['w']/2-bad['x'],x['y']+x['h']/2-bad['y']));canonical=encoded[g['start']*2:g['end']*2].decode('utf-16-le')
   expected_pdfium.subtract(characters(bad['text']));expected_pdfium.update(characters(canonical));normalized.append(bad['index'])
 checks['preExistingPDFiumUnmappedCharacters']=len(unmapped);checks['unmappedCharactersInsideEditedSources']=len(normalized)
 try:checks['tagStructure']=assert_tag_structure_preserved(before,after)
 except AssertionError as error:errors.append('logical structure tree/MCIDs changed: '+str(error))
 for item in accepted:
  for counter in (expected,expected_pdfium):counter.subtract(characters(item['original']['text']));counter.update(characters(item['model']['text']))
 if any(v<0 for v in expected.values()):errors.append('source candidates do not match original page characters')
 for engine,text in [('MuPDF',standard_text(after)),('PDFium',pdfium_text(after))]:
  actual=characters(text);target=expected if engine=='MuPDF'else expected_pdfium;checks[engine+'PageTextExact']=actual==target
  if actual!=target:errors.append(engine+' page semantic characters lost/duplicated: '+str(dict(target-actual))[:160]+' extra='+str(dict(actual-target))[:160])
 boxes=[b for item in accepted for b in mask_boxes(item['model'],item['result'],objects)]
 for engine in ('MuPDF','PDFium'):
  metrics=compare_pixels(before,after,boxes,engine);checks[engine+'Pixels']=metrics
  if metrics['outsideChangedPixels']:errors.append(engine+' untouched-region pixels changed: '+str(metrics['outsideChangedPixels']))
  if has_sibling:
   checks[engine+'AdjacentPageIdentical']=render(before,1,engine)==render(after,1,engine)
   if not checks[engine+'AdjacentPageIdentical']:errors.append(engine+' adjacent page changed')
 start=time.perf_counter();again,models,timings=inspect(after);checks['reopenMs']=milliseconds(start)
 for item in accepted:
  m=item['model'];row=item['attempt'];exact=[x for x in models if x['text']==m['text']]
  row['exactReopenedParagraphs']=len(exact)
  if len(exact)!=1:errors.append(row['operation']+': exact paragraph missing/duplicated after reopen')
  else:
   row['savedFonts']=fonts(exact[0]);row['reopenedFrame']=exact[0]['frame']
   row['softBreaksExact']=exact[0].get('softBreaks',[])==m.get('softBreaks',[])
   row['styleMappingWarning']=exact[0].get('styleMappingWarning')
   row['fontAudit']=audit_font_shapes(m,exact[0])
   row['phoneticAudit']=phonetic_audit(item['original'],m,exact[0],objects,again['objects'],row['change']) if row.get('change') else {'notAudited':'missing change specification'}
   if row['phoneticAudit'].get('lostAssociations'):errors.append(row['operation']+': phonetic annotation detached from edited base character')
   if row['fontAudit']['outlineDifferences']:errors.append(row['operation']+': rendered glyph outlines changed')
   if row['fontAudit']['sizeDifferences']:errors.append(row['operation']+': rendered font size changed')
   if not row['softBreaksExact']:errors.append(row['operation']+': soft breaks changed')
   if row['styleMappingWarning']:errors.append(row['operation']+': reopened style mapping warning')
  # Require the exact edited text to be present as a contiguous sequence under
  # whitespace normalization in both independent standard extraction engines.
  for engine,text in [('MuPDF',standard_text(after)),('PDFium',pdfium_text(after))]:
   present=compact(text).count(compact(m['text']))==1;row[engine+'ParagraphExact']=present
   if not present:errors.append(row['operation']+': '+engine+' exact paragraph missing/duplicated')
 checks['actualRenderedFontsBefore']=font_names(before);checks['actualRenderedFontsAfter']=font_names(after)
 return checks,errors

plan_path=OUT/'plan.json';plans={} if args.refresh_plan or not plan_path.exists() else json.loads(plan_path.read_text(encoding='utf8'))
files=sorted((CODE/'native').glob('*.py'))+[CODE/'src'/name for name in ('flow-page-model.mjs','flow-model.mjs','flow-style.mjs','flow-regions.mjs','ruby-anchors.mjs') if (CODE/'src'/name).exists()]
if (CODE/'tests/structure_checks_v191.py').exists():files.append(CODE/'tests/structure_checks_v191.py')
if (CODE/'tests/annotation_checks_v191.py').exists():files.append(CODE/'tests/annotation_checks_v191.py')
hashes={str(p.relative_to(CODE)):hashbytes(p.read_bytes()) for p in files}
report=dict(label=args.label,startedAt=datetime.now(timezone.utc).isoformat(),runtime=sys.executable,engines=dict(MuPDF=fitz.VersionBind,PDFium=pdfium.PDFIUM_INFO.version,pypdfium2=pdfium.PYPDFIUM_INFO.version,fontTools=fontTools.__version__),codeRoot=str(CODE),codeHashes=hashes,
 methodology='Twenty selected physical PDF pages edited directly in complete original PDF bytes (no extraction before inspect/apply, preserving structure trees), four spread-out paragraph locations plus two additional substantial-body targets per page where available; 2-character insertion/deletion and 32–72-character insertion/12–60-character deletion. Insertions repeat existing paragraph characters to isolate native font preservation from missing-new-glyph fallback. The four spread-out edits and two body edits form separate disjoint commit batches; a rejected batch is retried one edit at a time to identify the blocker. Saved text is reopened and verified in MuPDF and PDFium. Blocked/failed operations never count as passed. Adjacent pages are real neighbouring source pages. Timing excludes rendering unless separately labelled.',
 limitations=['API/model benchmark does not measure human mouse/keyboard time or competitor applications.','Full-page character comparison ignores whitespace order; edited paragraph order is additionally checked as an exact whitespace-normalized sequence.','Font audit compares decomposed glyph outlines and point sizes by Unicode for available cached font resources; unavailable font resources are explicitly counted, not claimed identical. Raw font advances are not compared because the writer can bake tracking into them.','Physical source page numbers are 1-based and may differ from printed page numbers.'],pages=[])

for kind,name,pageno in SPECS:
 ident=f'{kind}-{pageno}'
 if args.pages and ident not in args.pages:continue
 ACTIVE_PAGE=pageno
 row=dict(id=ident,sample=name,page=pageno,completeOriginalDocument=True,attempts=[]);report['pages'].append(row);start_page=time.perf_counter()
 try:
  path=args.samples/name;original=path.read_bytes();source_hash=hashbytes(original)
  with fitz.open(stream=original,filetype='pdf') as doc:
   sibling=pageno if pageno<len(doc) else pageno-2 if pageno>1 else None
   raw=original;row.update(sourcePageCount=len(doc),adjacentPage=sibling+1 if sibling is not None else None)
   doc[pageno-1].get_pixmap(matrix=fitz.Matrix(1.25,1.25),alpha=False).save(RUN/f'{ident}-before.png')
  if not (RUN/f'{kind}-original.pdf').exists():(RUN/f'{kind}-original.pdf').write_bytes(raw)
  data,models,timings=inspect(raw);row.update(timings);row.update(textObjects=sum(o['type']=='text' for o in data['objects']),paragraphs=len(models),tableCells=sum(bool(m.get('cell')) for m in models))
  row['originalFonts']=sorted(set(o.get('fontName','') for o in data['objects'] if o['type']=='text'))
  row['protectedObjectReasons']=dict(Counter(o.get('reason','unspecified') for o in data['objects'] if o['type']=='text' and not o.get('flowEditable')))
  dump(RUN/f'{ident}-models.json',models)
  eligible=[m for m in models if len(compact(m['text']))>=12 and m.get('size',0)<=30 and m['frame']['y']>35 and m['frame']['y']<m['pageHeight']-40]
  eligible.sort(key=lambda m:(m['frame']['y'],m['frame']['x']))
  if ident not in plans:
   picked=[]
   for index,operation in enumerate(OPERATIONS[:4]):
    choices=[m for m in eligible if not any(set(source_ids(m))&set(source_ids(x)) for x in picked)]
    if not choices:plans.setdefault(ident,[]).append(dict(operation=operation,unavailable=True));continue
    # Spread targets through the actual content extent, including headings,
    # pinyin, table cells and prose instead of cherry-picking successful prose.
    target=eligible[0]['frame']['y']+(eligible[-1]['frame']['y']-eligible[0]['frame']['y'])*index/3
    chosen=min(choices,key=lambda m:abs(m['frame']['y']-target));picked.append(chosen)
    edited,change=edit_model(chosen,operation)
    plans.setdefault(ident,[]).append(dict(operation=operation,sources=source_ids(chosen),oldText=chosen['text'],newText=edited['text'],change=change,frame=chosen['frame']))
  if len(plans[ident])==4:
   body=sorted([m for m in eligible if not m.get('cell')],key=lambda m:-len(compact(m['text'])))
   picked=[]
   for operation in OPERATIONS[4:]:
    choices=[m for m in body if not any(set(source_ids(m))&set(source_ids(x)) for x in picked)]
    if not choices:plans[ident].append(dict(operation=operation,unavailable=True));continue
    chosen=choices[0];picked.append(chosen);edited,change=edit_model(chosen,operation)
    plans[ident].append(dict(operation=operation,sources=source_ids(chosen),oldText=chosen['text'],newText=edited['text'],change=change,frame=chosen['frame'],bodyTarget=True))
  dump(plan_path,plans)
  accepted_groups=[[],[]];row['resegmentedTargets']=0
  for spec in plans[ident]:
   operation=spec['operation'];attempt=dict(operation=operation,status='pending');row['attempts'].append(attempt)
   accepted=accepted_groups[1 if operation.startswith('body-') else 0]
   if spec.get('unavailable'):attempt.update(status='blocked',reason='fewer-than-four-distinct-targets');continue
   candidates=[m for m in models if source_ids(m)==spec['sources']]
   if len(candidates)!=1:
    # A corrected grouping is explicitly tracked and tested at the old location.
    # Do not pretend this is identical replay: text/length changes are reported.
    candidates=sorted([m for m in models if len(compact(m['text']))>=12 and set(source_ids(m))&set(spec['sources'])],key=lambda m:-len(set(source_ids(m))&set(spec['sources'])))
    if not candidates:attempt.update(status='blocked',reason='original-target-no-longer-editable',sources=spec['sources']);continue
    row['resegmentedTargets']+=1;attempt['targetResegmented']=True
   candidate=candidates[0]
   if any(set(source_ids(candidate))&set(source_ids(a['original'])) for a in accepted):attempt.update(status='blocked',reason='target-merged-with-previous-edit');continue
   m,change=edit_model(copy.deepcopy(candidate),operation)
   attempt.update(change=change,sourceCount=len(m['sources']),sourceCharacters=len(candidate['text']),targetCharacters=len(m['text']),frame=copy.deepcopy(m['frame']),cell=bool(m.get('cell')),fontsBefore=fonts(candidate))
   try:
    t=time.perf_counter();r=layout(m);attempt['initialLayoutMs']=milliseconds(t);r=growth(m,data['objects'],r,attempt);attempt['totalLayoutMs']=milliseconds(t)
    attempt.update(layoutMode=r.get('layoutMode'),engine=r.get('engine'),fallbackCount=r.get('fallbackCount'),fallbackDetails=r.get('fallbackDetails'),mappingComplete=bool(r.get('mappingComplete')),overflow=bool(r.get('overflow')),frameOverset=bool(r.get('frameOverset')),warnings=r.get('warnings'))
    attempt['unchangedPrefixPositions']=prefix_positions(candidate,m,r)
    if r.get('overflow') or not r.get('mappingComplete'):attempt.update(status='blocked',reason='layout-overflow' if r.get('overflow') else 'layout-mapping');continue
    pending=[dict(id=a['attempt']['operation'],type='flow',page=1,sources=a['model']['sources'],model=a['model'],ink=a['result'].get('glyphs',[])) for a in accepted]
    conflicts=js("import{flowConflicts}from'./src/flow-page-model.mjs';console.log(JSON.stringify(flowConflicts(v.m,v.objects,v.edits,1,null,v.glyphs)));",dict(m=m,objects=data['objects'],edits=pending,glyphs=r.get('glyphs',[])))
    if conflicts:attempt.update(status='blocked',reason='neighbour-conflict',conflicts=conflicts[:8]);continue
    attempt['status']='ready';accepted.append(dict(model=m,result=r,original=candidate,attempt=attempt))
   except ValueError as error:attempt.update(status='blocked',reason=classify(str(error)),error=str(error),totalLayoutMs=milliseconds(t))
   except Exception as error:attempt.update(status='failed',reason='unexpected-layout-error',error=str(error),totalLayoutMs=milliseconds(t));traceback.print_exc()
  batches=[(str(i),group) for i,group in enumerate(accepted_groups) if group]
  row['batches']=[]
  while batches:
   batch_id,accepted=batches.pop(0);batch=dict(id=batch_id,operations=[a['attempt']['operation'] for a in accepted]);row['batches'].append(batch)
   edits=[dict(page=ACTIVE_PAGE,type='flow',sources=a['model']['sources'],model=a['model'],fragment=a['result']['fragment']) for a in accepted]
   dump(RUN/f'{ident}-batch{batch_id}-applied-models.json',[dict(operation=a['attempt']['operation'],model=a['model']) for a in accepted])
   t=time.perf_counter()
   try:
    result=worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),'edits':edits});changed=base64.b64decode(result['bytes']);batch['saveMs']=milliseconds(t)
    (RUN/f'{ident}-batch{batch_id}-after.pdf').write_bytes(changed)
    checks,errors=verify(raw,changed,accepted,data['objects'],sibling is not None);batch['verification']=checks;batch['errors']=errors
    common_errors=[error for error in errors if not any(error.startswith(a['attempt']['operation']+':') for a in accepted)]
    for a in accepted:
     individual_errors=common_errors+[error for error in errors if error.startswith(a['attempt']['operation']+':')]
     a['attempt']['verificationErrors']=individual_errors;a['attempt']['status']='failed' if individual_errors else 'passed'
    for suffix,blob in [('before',raw),('after',changed)]:
     with fitz.open(stream=blob,filetype='pdf') as doc:doc[ACTIVE_PAGE-1].get_pixmap(matrix=fitz.Matrix(1.25,1.25),alpha=False).save(RUN/f'{ident}-batch{batch_id}-{suffix}.png')
   except ValueError as error:
    batch['saveError']=str(error)
    if len(accepted)>1:
     batch['retriedIndividually']=True;batches += [(batch_id+'-'+str(i),[a]) for i,a in enumerate(accepted)]
    else:
     for a in accepted:a['attempt'].update(status='blocked',reason='save-'+classify(str(error)),error=str(error))
   except Exception as error:
    batch['saveError']=str(error);traceback.print_exc()
    for a in accepted:a['attempt'].update(status='failed',reason='save-or-verify-exception',error=str(error))
  row['sourceUnchanged']=hashbytes(path.read_bytes())==source_hash
  if not row['sourceUnchanged']:raise AssertionError('original sample changed')
  statuses=Counter(a['status'] for a in row['attempts']);row['operationSummary']=dict(statuses)
  row['status']='failed' if statuses['failed'] else 'passed' if statuses['passed']==len(OPERATIONS) else 'partial' if statuses['passed'] else 'blocked'
 except Exception as error:row.update(status='harness-error',error=str(error));traceback.print_exc()
 row['totalMs']=milliseconds(start_page)
 report['operationSummary']=dict(Counter(a['status'] for p in report['pages'] for a in p['attempts']))
 report['pageSummary']=dict(Counter(p['status'] for p in report['pages']))
 dump(RUN/'report.json',report)
 print(json.dumps({k:v for k,v in row.items() if k in ('id','status','operationSummary','inspectMs','paragraphs','saveMs','totalMs','errors','error')},ensure_ascii=False),flush=True)
if args.whole_documents:
 report['wholeDocuments']=[]
 for kind,name in [('textbook',SPECS[0][1]),('strategy',SPECS[-1][1])]:
  row=dict(sample=name);report['wholeDocuments'].append(row)
  try:
   choices=[p for p in report['pages'] if p['id'].startswith(kind) and any(a['status']=='passed' for a in p['attempts'])]
   choices.sort(key=lambda p:abs(p['page']-(25 if kind=='textbook' else 6)))
   if not choices:row.update(status='blocked',reason='no-successful-page-edit');continue
   chosen=choices[0];attempt=next(a for a in chosen['attempts'] if a['status']=='passed');pageno=chosen['page'];row.update(page=pageno,operation=attempt['operation'])
   ACTIVE_PAGE=pageno
   path=args.samples/name;raw=path.read_bytes();source_hash=hashbytes(raw)
   t=time.perf_counter();data=worker.run({'command':'inspect','bytes':base64.b64encode(raw).decode(),'page':pageno});row['inspectMs']=milliseconds(t)
   ms=js("import{pageCandidates}from'./src/flow-page-model.mjs';console.log(JSON.stringify(pageCandidates(v.objects,...v.size,[],v.tables).map(c=>c.model)));",data)
   saved=[item for file in RUN.glob(chosen['id']+'-batch*-applied-models.json') for item in json.loads(file.read_text(encoding='utf8')) if item['operation']==attempt['operation']]
   candidate=next(m for m in ms if source_ids(m)==source_ids(saved[0]['model']))
   m,change=edit_model(candidate,attempt['operation']);t=time.perf_counter();r=layout(m);r=growth(m,data['objects'],r,row);row['layoutMs']=milliseconds(t)
   if r.get('overflow') or not r.get('mappingComplete'):raise ValueError('whole-document replay layout is blocked')
   t=time.perf_counter();saved=worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),'edits':[dict(type='flow',page=pageno,sources=m['sources'],model=m,fragment=r['fragment'])]});changed=base64.b64decode(saved['bytes']);row['saveMs']=milliseconds(t)
   (RUN/f'whole-{kind}.pdf').write_bytes(changed);row.update(originalBytes=len(raw),savedBytes=len(changed))
   row['tagStructure']=assert_tag_structure_preserved(raw,changed)
   t=time.perf_counter();worker.run({'command':'inspect','bytes':base64.b64encode(changed).decode(),'page':pageno});row['reopenInspectMs']=milliseconds(t)
   with fitz.open(stream=raw,filetype='pdf') as before,fitz.open(stream=changed,filetype='pdf') as after:
    if len(before)!=len(after):raise AssertionError('whole-document page count changed')
    row['pages']=len(before);row['untouchedPagesChecked']=0;row['changedUntouchedPages']=[]
    for n in range(len(before)):
     if n==pageno-1:continue
     row['untouchedPagesChecked']+=1
     if before[n].get_pixmap(alpha=False).samples!=after[n].get_pixmap(alpha=False).samples:row['changedUntouchedPages'].append(n+1)
    excerpts=[]
    for doc in (before,after):
     excerpt=fitz.open();excerpt.insert_pdf(doc,from_page=pageno-1,to_page=pageno);excerpts.append(excerpt.tobytes());excerpt.close()
   ACTIVE_PAGE=1
   _,models,_=inspect(excerpts[0]);before_m=next(x for x in models if x['text']==candidate['text']);# source indices remain the same after extraction
   item=dict(original=before_m,model=m,result=r,attempt=dict(operation=attempt['operation'],change=change))
   checks,errors=verify(excerpts[0],excerpts[1],[item],data['objects'],True);row.update(verification=checks,fontAudit=item['attempt'].get('fontAudit'),errors=errors)
   row['sourceUnchanged']=hashbytes(path.read_bytes())==source_hash
   row['status']='failed' if errors or row['changedUntouchedPages'] or not row['sourceUnchanged'] else 'passed'
  except ValueError as error:row.update(status='blocked',error=str(error))
  except Exception as error:row.update(status='failed',error=str(error));traceback.print_exc()
  dump(RUN/'report.json',report);print(json.dumps({'wholeDocument':kind,**{k:v for k,v in row.items() if k in ('status','page','pages','inspectMs','layoutMs','saveMs','reopenInspectMs','error')}},ensure_ascii=False),flush=True)
report['finishedAt']=datetime.now(timezone.utc).isoformat();report['codeUnchanged']=all(hashbytes((CODE/p).read_bytes())==h for p,h in hashes.items())
report['blockingReasons']=dict(Counter(a.get('reason') for p in report['pages'] for a in p['attempts'] if a['status']=='blocked'))
dump(RUN/'report.json',report)
print(json.dumps({k:report[k] for k in ('operationSummary','pageSummary','blockingReasons','codeUnchanged')},ensure_ascii=False),flush=True)
if not report['codeUnchanged'] or any(p['status'] in ('failed','harness-error') for p in report['pages']+report.get('wholeDocuments',[])):sys.exit(1)

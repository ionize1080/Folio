"""Read-only local corpus probe, with independently saved single-paragraph edits.

Run with the clean packaged runtime, not the developer's embedded site-packages.
Each success checks exact text, reopened editability, real adjacent-page pixels,
and untouched pixels outside the union of original/new paragraph bounds.
"""
from pathlib import Path
import base64, copy, hashlib, json, math, subprocess, sys, time, traceback
from collections import Counter
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'native'), str(ROOT / 'native/vendor')]
sys.stdout.reconfigure(encoding='utf-8')
import fitz, worker, fontTools
from story import layout
from system_fonts import catalog, select_font

BASE = Path(sys.argv[1])
OUT = ROOT / 'tests/output/corpus-followup-v190'
OUT.mkdir(parents=True, exist_ok=True)
RUN = OUT / ('run-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
RUN.mkdir()
SPECS = [
    ('Beijing__2024', 5, 'encoded-chinese'),
    ('HSK__', 2, 'scan'),
    ('佰维存储_', 5, 'chinese-table'),
    ('佰维存储_', 15, 'chinese-body'),
    ('佰维存储_', 20, 'chinese-body'),
    ('成都华微_', 8, 'chinese-table'),
    ('成都华微_', 15, 'chinese-table'),
    ('成都华微_', 20, 'chinese-body'),
    ('Self-Building Labs', 3, 'paper'),
    ('Beyond SAEs_', 1, 'paper'),
    ('Beyond SAEs_', 4, 'paper-formula'),
    ('Mahler Method', 3, 'paper-formula'),
    ('Mahler Method', 5, 'paper-formula'),
    ('AI-Driven Reproducibility', 3, 'paper'),
    ('pdfplumber__ag-energy', 1, 'newsletter'),
    ('pdf.js__basicapi', 2, 'simple-text'),
    ('pdf.js__french_diacritics', 1, 'accents'),
    ('pdf.js__nested_outline', 3, 'outline-document'),
    ('pdf.js__tracemonkey__', 2, 'paper-two-column'),
    ('USTB__Chinese_Research_Paper', 2, 'chinese-bilingual-paper'),
    ('USTB__Chinese_Research_Paper', 3, 'paper-two-column'),
    ('W3C__PDF3__reading-order-2cols-word', 1, 'paper-two-column'),
    ('Revisiting the Mass', 2, 'paper-formula'),
]

def js(code, data):
    return json.loads(subprocess.check_output(
        ['node', '--input-type=module', '-e',
         "let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s);" + code],
        input=json.dumps(data).encode(), cwd=ROOT))

def inspect(raw):
    data = worker.run({'command':'inspect','bytes':base64.b64encode(raw).decode(),'page':1})
    ms = js("import{pageCandidates}from'./src/flow-page-model.mjs';console.log(JSON.stringify(pageCandidates(v.objects,...v.size,[],v.tables).map(c=>c.model)))", data)
    return data, ms

def compact(text): return ''.join(text.split())
def semantic_characters(text):
    # MuPDF and PDFium expose Latin presentation ligatures differently. Expand
    # only those seven semantic equivalents; do not normalize math or accents.
    return Counter(compact(text.translate(str.maketrans(dict(zip('ﬀﬁﬂﬃﬄﬅﬆ',['ff','fi','fl','ffi','ffl','st','st']))))))
def cjk(text): return any('\u3400' <= c <= '\u9fff' for c in text)
def equation(model):
    # Do not exercise prose reflow by treating mathematical notation as prose.
    return (any('\ue000' <= c <= '\uf8ff' for c in model['text']) or
            sum(c in '∫∑∏∥≠≤≥∈⊂⊆⊗' for c in model['text']) > 1)

def change(model, operation):
    text=model['text'];pos=next((i for i,c in enumerate(text) if c.isalpha()), None)
    if pos is None: return None
    if operation=='insert': new=text[:pos]+text[pos]+text[pos:]
    else:
        replacement=next((c for c in text[pos+1:] if c.isalpha() and c!=text[pos]),None)
        if replacement is None:return None
        new=text[:pos]+replacement+text[pos+1:]
    return js("import{editStyles,editSoftBreaks}from'./src/flow-style.mjs';let m=v.model;const old=m.text;m.runs=editStyles(m.runs||[],old,v.text,m);m.softBreaks=editSoftBreaks(m.softBreaks||[],old,v.text);m.text=v.text;console.log(JSON.stringify(m));", {'model':model,'text':new})

font_cache={}
def explicit_font(model):
    language='zh' if cjk(model['text']) else 'latin'
    if language not in font_cache:
        entries=list(catalog().values())
        names=['SimSun','MicrosoftYaHeiRegular'] if language=='zh' else ['TimesNewRomanPSMT','ArialMT']
        found=next((f for name in names for f in entries if f.get('postScriptName')==name),None)
        if found is None:return None
        font_cache[language]=select_font(found['id'])
    m=copy.deepcopy(model);f=font_cache[language]
    m.update(f);m['fontResolution']='user-selected';m['fontOriginalName']=f['fontName']
    for run in m.get('runs',[]):run.update(f);run['fontResolution']='user-selected';run['fontOriginalName']=f['fontName']
    return m

def protection(error):
    if '原字体' in error or '字形' in error:return 'font-unavailable'
    if '交错重叠' in error or '遮挡' in error or '分隔线' in error:return 'overlap-protection'
    if '无法' in error and ('对应' in error or '映射' in error):return 'ownership-protection'
    if 'MCID' in error:return 'tagged-content-boundary'
    if '裁剪' in error:return 'clipping-boundary'
    if '精排字位不完整' in error:return 'unsupported-glyph-geometry'
    if '排版参数超出有效范围' in error:return 'unsupported-typography'
    return 'rejected'

def pixels(raw,index):
    with fitz.open(stream=raw,filetype='pdf') as doc:return doc[index].get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False).samples

def outside_equal(raw, changed, model, result, objects):
    indices={s['index'] for s in model.get('sources',[])};h=model['pageHeight'];boxes=[]
    for o in objects:
        if o['index'] in indices:
            l,b,r,t=o['bounds'];boxes.append([l,h-t,r,h-b])
    boxes += [[g['x'],g['y'],g['x']+g['w'],g['y']+g['h']] for g in result.get('glyphs',[])]
    box=[min(b[0] for b in boxes)-3,min(b[1] for b in boxes)-3,
         max(b[2] for b in boxes)+3,max(b[3] for b in boxes)+3]
    with fitz.open(stream=raw,filetype='pdf') as a, fitz.open(stream=changed,filetype='pdf') as b:
        ap=a[0].get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False)
        bp=b[0].get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False)
        assert (ap.width,ap.height,ap.n)==(bp.width,bp.height,bp.n),'page geometry changed'
        aa=ap.samples;bb=bp.samples;stride=ap.stride;n=ap.n
        x0=max(0,math.floor(box[0]*1.5));x1=min(ap.width,math.ceil(box[2]*1.5))
        y0=max(0,math.floor(box[1]*1.5));y1=min(ap.height,math.ceil(box[3]*1.5))
        for y in range(ap.height):
            left=y*stride;right=left+stride
            if y<y0 or y>=y1:
                assert aa[left:right]==bb[left:right],f'untouched pixels changed at row {y}'
            else:
                assert aa[left:left+x0*n]==bb[left:left+x0*n],f'left neighbour pixels changed at row {y}'
                assert aa[left+x1*n:right]==bb[left+x1*n:right],f'right neighbour pixels changed at row {y}'
    return [round(v,2) for v in box]

code_files=[ROOT/'src'/name for name in ('flow-page-model.mjs','flow-regions.mjs','flow-style.mjs','flow-model.mjs')]+sorted((ROOT/'native').glob('*.py'))
code_hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()for p in code_files}
report={'runtime':sys.executable,'fontTools':fontTools.__file__,'codeHashes':code_hashes,
    'startedAt':datetime.now(timezone.utc).isoformat(),
    'artifactDirectory':str(RUN.relative_to(ROOT)),
    'scope':'Selected representative pages, independently edited paragraph candidates; each page pairs its actual adjacent page when present. A passed page has at least one successful replacement and one successful insertion, not universal editability.',
    'samples':[]}
for number,(prefix,page,kind) in enumerate(SPECS):
    if len(sys.argv)>2 and prefix not in sys.argv[2:]:continue
    started=time.time();path=next(p for p in BASE.rglob('*.pdf') if p.name.startswith(prefix))
    row={'sample':path.name,'page':page,'kind':kind,'attempts':[],'checks':[]};report['samples'].append(row)
    artifact=RUN/f'{number:02}-p{page}'
    try:
        original=path.read_bytes();digest=hashlib.sha256(original).hexdigest()
        with fitz.open(stream=original,filetype='pdf') as doc:
            selected=[page-1]
            sibling=page if page<len(doc) else page-2 if page>1 else None
            if sibling is not None:selected.append(sibling)
            sample=fitz.open()
            for p in selected:sample.insert_pdf(doc,from_page=p,to_page=p)
            raw=sample.tobytes();sample.close()
            row['realAdjacentPage']=sibling+1 if sibling is not None else None
        with fitz.open(stream=raw,filetype='pdf') as doc:original_text=doc[0].get_text()
        inspected,ms=inspect(raw);row['textObjects']=sum(o['type']=='text' for o in inspected['objects']);row['paragraphs']=len(ms)
        artifact.with_suffix('.models.json').write_text(json.dumps(ms,ensure_ascii=False),encoding='utf-8')
        row['objectProtectionReasons']=sorted(set(o.get('reason','') for o in inspected['objects'] if o['type']=='text' and not o.get('flowEditable')))
        row['formulaParagraphs']=sum(equation(m) for m in ms)
        if kind=='paper-two-column':
            by_id={o['index']:o for o in inspected['objects']}
            threshold=100 if prefix.startswith('USTB') else 60
            violations=[]
            for m in ms:
                sides=set()
                for source in m['sources']:
                    o=by_id[source['index']];l,b,r,t=o['bounds'];center=(l+r)/2
                    if inspected['size'][1]-t<threshold:continue
                    if r-l>inspected['size'][0]*.5:continue
                    if center<inspected['size'][0]/2-8:sides.add('left')
                    if center>inspected['size'][0]/2+8:sides.add('right')
                if len(sides)>1:violations.append(m['text'][:100])
            row['crossColumnParagraphs']=violations
            assert not violations,'independent column audit found a paragraph spanning both columns'
        candidates=[m for m in ms if 8<=len(m['text'].strip())<=1600 and m.get('size',0)<=20 and not equation(m)]
        # Prefer substantial prose. Tables are explicitly exercised only on their dedicated pages.
        if kind not in ('chinese-table','newsletter'):candidates=[m for m in candidates if not m.get('cell')]
        candidates.sort(key=lambda m:(not ('\n' in m['text']),-min(len(m['text']),300)))
        if kind=='encoded-chinese':
            row['status']='protected-font-encoding';row['explanation']='Custom FzBookMaker glyph encoding does not provide reliable Chinese Unicode; replacement would change semantic text.'
        elif not row['textObjects']:
            row['status']='protected-no-text-layer'
        else:
            for operation in ('replace','insert'):
                success=False
                for candidate in candidates[:5]:
                    attempt={'operation':operation,'text':candidate['text'][:100],'cell':bool(candidate.get('cell'))};row['attempts'].append(attempt)
                    m=change(candidate,operation)
                    if not m:attempt['status']='no-change';continue
                    try:
                        try:r=layout(m)
                        except ValueError as e:
                            if '原字体' not in str(e):raise
                            attempt['originalProtection']=str(e);replacement=explicit_font(m)
                            if replacement is None:raise
                            m=replacement;attempt['explicitReplacementFont']=m['fontName'];r=layout(m)
                        if (r.get('overflow') or r.get('frameOverset')) and not m.get('cell'):
                            growth=js("import{growthLimit,horizontalLimit,suggestGrowth}from'./src/flow-page-model.mjs';const q=suggestGrowth(v.m,v.objects,[],[],1,null);const dimension=q.direction==='right'?'width':'height';console.log(JSON.stringify({direction:q.direction,dimension,limit:q.direction==='right'?horizontalLimit(v.m,v.objects,[],1,null):growthLimit(v.m,v.objects,[],1,null)}))",{'m':m,'objects':inspected['objects']})
                            dimension=growth['dimension'];limit=growth['limit'];old_size=m['frame'][dimension]
                            if growth['direction']!='fixed' and limit>old_size+.5:
                                trial={**m,'frame':{**m['frame'],dimension:limit}}
                                trial_result=layout(trial)
                                if not trial_result.get('overflow') and trial_result.get('mappingComplete'):
                                    low=old_size;high=limit;r=trial_result
                                    for _ in range(6):
                                        if high-low<=.5:break
                                        mid=(low+high)/2;trial['frame'][dimension]=mid
                                        attempt_result=layout(trial)
                                        if attempt_result.get('overflow') or not attempt_result.get('mappingComplete'):low=mid
                                        else:high=mid;r=attempt_result
                                    m['frame'][dimension]=high;attempt['growth']='obstacle-limited-'+growth['direction']
                        if r.get('overflow') or not r.get('mappingComplete'):
                            attempt.update(status='protected-layout',overflow=bool(r.get('overflow')),mappingComplete=bool(r.get('mappingComplete')),mappingReason=r.get('mappingReason'),warnings=r.get('warnings'));continue
                        conflicts=js("import{flowConflicts}from'./src/flow-page-model.mjs';console.log(JSON.stringify(flowConflicts(v.m,v.objects,[],1,null,v.glyphs)))",{'m':m,'objects':inspected['objects'],'glyphs':r.get('glyphs',[])})
                        if conflicts:attempt.update(status='protected-neighbour',conflicts=conflicts[:3]);continue
                        out=worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),'edits':[{'page':1,'type':'flow','sources':m['sources'],'model':m,'fragment':r['fragment']}]})
                        changed=base64.b64decode(out['bytes']);expected=compact(m['text'])
                        with fitz.open(stream=changed,filetype='pdf') as doc:
                            actual_text=doc[0].get_text()
                            assert compact(actual_text).count(expected)==1,'saved exact semantic text missing or duplicated'
                            if m['text'].isascii() and '\n' not in m['text'] and '\r' not in m['text']:
                                # A single-line Latin replacement must not gain a
                                # new word boundary when a narrower glyph retains
                                # the old advance. Folio-only metadata is not enough.
                                start=compact(actual_text).index(expected)
                                offsets=[i for i,c in enumerate(actual_text)if not c.isspace()]
                                segment=actual_text[offsets[start]:offsets[start+len(expected)-1]+1]
                                assert ' '.join(segment.split())==' '.join(m['text'].split()),'standard PDF extraction changed single-line word boundaries'
                            expected_page=semantic_characters(original_text)
                            expected_page.subtract(semantic_characters(candidate['text']))
                            expected_page.update(semantic_characters(m['text']))
                            assert all(n>=0 for n in expected_page.values()),'source paragraph does not match original page semantics'
                            assert semantic_characters(actual_text)==expected_page,'saved page lost or duplicated semantic characters'
                        if sibling is not None:assert pixels(raw,1)==pixels(changed,1),'real adjacent page pixels changed'
                        box=outside_equal(raw,changed,m,r,inspected['objects'])
                        _,again=inspect(changed)
                        reopened=next((x for x in again if x['text']==m['text']),None)
                        assert reopened is not None,'reopened logical paragraph text changed or is not editable as one unit'
                        assert reopened.get('softBreaks',[])==m.get('softBreaks',[]),'reopened soft wraps changed'
                        assert not reopened.get('styleMappingWarning'),'reopened font/style mapping is incomplete'
                        attempt.update(status='passed',changedBounds=box)
                        row['checks'].append(operation+'-save-reopen-neighbours')
                        (RUN/f'{number:02}-p{page}-{operation}.pdf').write_bytes(changed)
                        (RUN/f'{number:02}-p{page}-{operation}.model.json').write_text(json.dumps(m,ensure_ascii=False),encoding='utf-8')
                        success=True;break
                    except ValueError as e:attempt.update(status='protected-'+protection(str(e)),error=str(e))
                    except Exception as e:
                        attempt.update(status='bug',error=str(e));traceback.print_exc()
                        (RUN/f'{number:02}-p{page}-{operation}.failed-model.json').write_text(json.dumps(m,ensure_ascii=False),encoding='utf-8')
                        if 'changed' in locals():(RUN/f'{number:02}-p{page}-{operation}.failed.pdf').write_bytes(changed)
                        break
                if not success:row.setdefault('uncompletedOperations',[]).append(operation)
            if any(a['status']=='bug' for a in row['attempts']):row['status']='bug'
            elif len(row['checks'])==2:row['status']='passed'
            elif row['checks']:row['status']='partial-protected'
            else:row['status']='protected-no-successful-edit'
        assert hashlib.sha256(path.read_bytes()).hexdigest()==digest,'source file changed'
        row['sourceUnchanged']=True
    except AssertionError as e:row.update(status='bug',error=str(e));traceback.print_exc()
    except Exception as e:row.update(status='harness-error',error=str(e));traceback.print_exc()
    row['seconds']=round(time.time()-started,2)
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in row.items() if k!='attempts'},ensure_ascii=False),flush=True)
report['codeUnchanged']=all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==digest for p,digest in code_hashes.items())
report['finishedAt']=datetime.now(timezone.utc).isoformat()
report['summary']=dict(Counter(row['status']for row in report['samples']))
report['successfulEdits']=sum(a.get('status')=='passed'for row in report['samples']for a in row.get('attempts',[]))
report['unclassifiedRejections']=dict(Counter(a['error']for row in report['samples']for a in row.get('attempts',[])if a.get('status')=='protected-rejected'))
(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
assert report['codeUnchanged'],'tested source code changed during the corpus run'
assert not any(row['status']in('bug','harness-error')for row in report['samples']),'corpus run found failed invariants; inspect report.json'

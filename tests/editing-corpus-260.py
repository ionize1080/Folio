"""Reproducible file/page sampling, real save/reopen checks and append-only ledger.

Local originals never leave the samples directory. CI downloads only the pinned
public manifest. Every attempt is reported; limitations are never counted as a
successful edit. Run workers in separate processes (PDF engines are not thread safe).
"""
import argparse, base64, collections, concurrent.futures, copy, hashlib, json
import math, os, pathlib, random, subprocess, sys, time, traceback, urllib.request
from datetime import datetime, timezone
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor'),str(ROOT/'tests')]
sys.stdout.reconfigure(encoding='utf-8')
OUT=ROOT/'tests/output/editing-260-corpus'


def digest(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def stamp():return datetime.now(timezone.utc).isoformat()


def js(code,data):
    script="let s='';for await(const c of process.stdin)s+=c;let v=JSON.parse(s);"+code
    return json.loads(subprocess.check_output(['node','--input-type=module','-e',script],input=json.dumps(data).encode(),cwd=ROOT,timeout=60))


def candidates(data):
    return js("import{pageCandidates}from'./src/flow-page-model.mjs';console.log(JSON.stringify(pageCandidates(v.objects,...v.size,[],v.tables).map(c=>c.model)));",data)


def edit(model,text):
    return js("import{editStyles,editSoftBreaks}from'./src/flow-style.mjs';let m=v.model;m.runs=editStyles(m.runs||[],m.text,v.text,m);m.softBreaks=editSoftBreaks(m.softBreaks||[],m.text,v.text);m.text=v.text;console.log(JSON.stringify(m));",{'model':model,'text':text})


def compact(text):
    return ''.join(text.translate(str.maketrans(dict(zip('ﬀﬁﬂﬃﬄﬅﬆ',['ff','fi','fl','ffi','ffl','st','st'])))).split())


def pixels(raw,page):
    import fitz
    with fitz.open(stream=raw,filetype='pdf') as doc:
        pg=doc[page-1];pg.set_rotation(0)
        return pg.get_pixmap(matrix=fitz.Matrix(1,1),alpha=False)


def outside_equal(before,after,model,result,objects):
    selected={s['index'] for s in model.get('sources',[])};h=model['pageHeight']
    boxes=[[o['bounds'][0],h-o['bounds'][3],o['bounds'][2],h-o['bounds'][1]] for o in objects if o['index'] in selected]
    boxes += [[g['x'],g['y'],g['x']+g['w'],g['y']+g['h']] for g in result.get('glyphs',[])]
    box=[min(b[0] for b in boxes)-3,min(b[1] for b in boxes)-3,max(b[2] for b in boxes)+3,max(b[3] for b in boxes)+3]
    assert (before.width,before.height,before.n)==(after.width,after.height,after.n),'Page geometry changed'
    a,b=before.samples,after.samples;stride=before.stride;n=before.n
    x0=max(0,math.floor(box[0]));x1=min(before.width,math.ceil(box[2]));y0=max(0,math.floor(box[1]));y1=min(before.height,math.ceil(box[3]))
    for y in range(before.height):
        start=y*stride;end=start+stride
        if y<y0 or y>=y1:assert a[start:end]==b[start:end],f'Unedited pixels changed at row {y}'
        else:
            assert a[start:start+x0*n]==b[start:start+x0*n],f'Left neighbour changed at row {y}'
            assert a[start+x1*n:end]==b[start+x1*n:end],f'Right neighbour changed at row {y}'
    return box


def run_document(spec):
    import fitz,worker
    from story import layout
    path=pathlib.Path(spec['path']);raw=path.read_bytes()
    assert hashlib.sha256(raw).hexdigest()==spec['sha256'],'Sample content changed'
    encoded=base64.b64encode(raw).decode();folder=OUT/spec['sha256'][:12];folder.mkdir(parents=True,exist_ok=True)
    report={**spec,'started':stamp(),'pages':[],'errors':[]}
    document=fitz.open(stream=raw,filetype='pdf')
    for page in spec['samplePages']:
        row={'page':page,'attempts':[]};report['pages'].append(row)
        try:
            start=time.perf_counter();data=worker.run({'command':'inspect','input':str(path),'page':page});row['inspectMs']=round((time.perf_counter()-start)*1000,2)
            start=time.perf_counter();models=candidates(data);row['groupMs']=round((time.perf_counter()-start)*1000,2)
            owners=collections.Counter(s['index'] for m in models for s in m.get('sources',[]))
            assert not any(v!=1 for v in owners.values()),'Duplicate paragraph ownership'
            available={o['index'] for o in data['objects'] if o['type']=='text' and o.get('flowEditable') and o.get('text','').strip()}
            assert available<=owners.keys(),'Editable source objects missing from paragraphs'
            row.update(objects=len(data['objects']),paragraphs=len(models),images=sum(o['type']=='image' for o in data['objects']),tables=len(data.get('tables',[])),editableText=len(available),unavailable=dict(collections.Counter(o.get('reason','unknown') for o in data['objects'] if o['type']=='text' and not o.get('flowEditable'))))
            before=pixels(raw,page);before.save(folder/f'p{page}-before.png')
            sibling=page+1 if page<len(document) else page-1 if page>1 else None
            sibling_before=pixels(raw,sibling).samples if sibling else None
            sample=[m for m in models if len(compact(m['text']))>=12]
            random.Random(spec['sha256']+str(page)).shuffle(sample)
            sample=sample[:3]
            if '中期选举' in path.name and page==2:
                adrian=next(m for m in models if 'Adrian Day' in m['text']);sample=[adrian]+[m for m in sample if m is not adrian][:2]
                assert adrian['text'].startswith('Adrian Day'),'Lost the initial A'
            for mi,model in enumerate(sample):
                model['allowOverflow']=True  # Same default as flow-ui.activateNow.
                positions=[i for i,c in enumerate(model['text']) if c.isalpha() and ord(c)<0xd800]
                if not positions:continue
                pos=positions[len(positions)//2];old=model['text']
                alternatives=[old[i] for i in positions if old[i]!=old[pos]]
                replacement=alternatives[0] if alternatives else old[pos]*2
                operations=[('replace',old[:pos]+replacement+old[pos+1:]),('insert',old[:pos]+old[pos]+old[pos:])]
                if '中期选举' in path.name and page==2 and mi==0:operations.append(('missing-glyphs',old.replace('下跌。','下跌测试测试。')))
                for operation,text in operations:
                    attempt={'model':mi,'operation':operation,'characters':len(old),'status':'running'};row['attempts'].append(attempt)
                    try:
                        m=edit(model,text);start=time.perf_counter();result=layout(m);attempt['layoutMs']=round((time.perf_counter()-start)*1000,2)
                        if not result.get('mappingComplete'):raise ValueError('字形映射不完整：'+str(result.get('mappingReason')))
                        start=time.perf_counter();changed=worker.run({'command':'apply','bytes':encoded,'edits':[{'type':'flow','page':page,'sources':m['sources'],'model':m,'fragment':result['fragment']}]});changed=base64.b64decode(changed['bytes']);attempt['saveMs']=round((time.perf_counter()-start)*1000,2)
                        after=pixels(changed,page);attempt['changedBounds']=outside_equal(before,after,m,result,data['objects'])
                        if sibling:assert sibling_before==pixels(changed,sibling).samples,'Adjacent page pixels changed'
                        start=time.perf_counter();reopened=worker.run({'command':'inspect','bytes':base64.b64encode(changed).decode(),'page':page});again=candidates(reopened);attempt['reopenMs']=round((time.perf_counter()-start)*1000,2)
                        if not any(compact(x['text'])==compact(text) for x in again):
                            (folder/f'p{page}-m{mi}-{operation}-failure.json').write_text(json.dumps({'model':m,'result':{k:v for k,v in result.items() if k not in ('fragment','svg')},'reopened':reopened,'models':again},ensure_ascii=False),encoding='utf-8')
                            (folder/f'p{page}-m{mi}-{operation}-failure.pdf').write_bytes(changed)
                            raise AssertionError('Edited paragraph not preserved on reopen')
                        with fitz.open(stream=changed,filetype='pdf') as doc:
                            assert len(doc)==len(document),'Page count changed'
                            expected=collections.Counter(compact(document[page-1].get_text()))-collections.Counter(compact(old))+collections.Counter(compact(text))
                            actual=collections.Counter(compact(doc[page-1].get_text()))
                            # Some originals expose OCR duplicates or presentation
                            # ligatures differently; report exact semantic deltas.
                            assert expected==actual,('Unexpected extracted text delta',dict(expected-actual),dict(actual-expected))
                        attempt.update(status='passed',mode=result.get('layoutMode'),frameOverset=result.get('frameOverset',False),fallbacks=result.get('fallbackCount',0),checks=['saved text','editable reopen','outside pixels','adjacent page','page count','unique ownership'])
                        if operation=='insert' or operation=='missing-glyphs':
                            (folder/f'p{page}-m{mi}-{operation}.pdf').write_bytes(changed)
                            after.save(folder/f'p{page}-m{mi}-{operation}.png')
                    except (ValueError,RuntimeError) as error:
                        attempt.update(status='limited',error=str(error))
                    except Exception as error:
                        attempt.update(status='failed',error=str(error));report['errors'].append({'page':page,'operation':operation,'error':str(error)})
            if not sample:row['classification']='scan-or-no-editable-prose'
        except Exception as error:
            row['error']=str(error);report['errors'].append({'page':page,'error':str(error),'trace':traceback.format_exc()})
        (folder/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    report['finished']=stamp();report['sourceUnchanged']=digest(path)==spec['sha256']
    assert report['sourceUnchanged']
    (folder/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report


def make_plan(base,count,seed,reuse_files=False):
    import fitz
    manifest=json.loads((base/'Online Samples/_catalog/manifest.json').read_text(encoding='utf-8-sig'))
    rng=random.Random(seed);own=list(base.glob('*.pdf'));rng.shuffle(own)
    own.sort(key=lambda p:0 if '中期选举' in p.name else 1)
    public=[m for m in manifest if m.get('status')=='downloaded' and not m.get('needs_password') and m.get('pages',0)>=2 and m.get('sampled_text_chars',0)>100 and m.get('bytes',0)<12*1024**2 and m.get('category') in ('01_Text_Editing','03_Multilingual','06_Tables_Layouts','07_Graphics_Color','14_Papers','15_Chinese_Documents')]
    rng.shuffle(public)
    sources=[(p,None) for p in own if p.stat().st_size<80*1024**2]
    sources += [(base/'Online Samples'/m['relative_path'],m) for m in public]
    seen=set();records=[]
    ledger=base/'_folio-tests/editing-ledger.jsonl';history=collections.defaultdict(set)
    if ledger.exists():
        for line in ledger.read_text(encoding='utf-8').splitlines():
            try:
                v=json.loads(line);history[v['sha256']].update(v.get('samplePages',[]))
            except (ValueError,KeyError):pass
    for path,meta in sources:
        if meta is None and sum(r['source']=='local' for r in records)>=count//2:continue
        if not path.exists():continue
        sha=digest(path)
        if sha in seen or (sha in history and not reuse_files):continue
        try:
            with fitz.open(path) as doc:
                if doc.needs_pass or not len(doc):continue
                remaining=[i for i in range(1,len(doc)+1) if i not in history[sha]]
                if not remaining:continue
                pages=sorted(rng.sample(remaining,min(3,len(remaining))))
                if '中期选举' in path.name:pages=sorted(set(pages+[2]))
                total=len(doc)
        except Exception:continue
        seen.add(sha);records.append({'name':path.name,'path':str(path),'sha256':sha,'pageCount':total,'bytes':path.stat().st_size,'samplePages':pages,'source':'public' if meta else 'local','url':meta.get('download_url') if meta else None,'category':meta.get('category') if meta else 'user-corpus'})
        if len(records)>=count:break
    assert len(records)==count,(len(records),count)
    return {'created':stamp(),'seed':seed,'documents':records,'ledger':str(ledger)}


def launch(spec_path):
    spec=json.loads(spec_path.read_text(encoding='utf-8'))
    log=OUT/spec['sha256'][:12]/'run.log';log.parent.mkdir(parents=True,exist_ok=True)
    # A crash/timeout on retry must never reuse a successful earlier report.
    (log.parent/'report.json').unlink(missing_ok=True)
    with log.open('w',encoding='utf-8') as stream:
        try:
            completed=subprocess.run([sys.executable,__file__,'--one',str(spec_path)],stdout=stream,stderr=stream,timeout=600,cwd=ROOT)
            return spec,completed.returncode
        except subprocess.TimeoutExpired:return spec,124


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base',default=r'D:\APP\PDF Samples');parser.add_argument('--count',type=int,default=32);parser.add_argument('--seed',type=int,default=20261111)
    parser.add_argument('--plan');parser.add_argument('--run');parser.add_argument('--one');parser.add_argument('--workers',type=int,default=4);parser.add_argument('--retry',action='store_true');parser.add_argument('--reuse-files',action='store_true',help='Allow previously tested files, selecting untested pages only')
    args=parser.parse_args();OUT.mkdir(parents=True,exist_ok=True)
    if args.one:
        report=run_document(json.loads(pathlib.Path(args.one).read_text(encoding='utf-8')));sys.exit(bool(report['errors']))
    if args.plan:
        plan=make_plan(pathlib.Path(args.base),args.count,args.seed,args.reuse_files);pathlib.Path(args.plan).write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'documents':len(plan['documents']),'pages':sum(len(d['samplePages']) for d in plan['documents'])}));return
    plan=json.loads(pathlib.Path(args.run).read_text(encoding='utf-8'));jobs=[]
    for spec in plan['documents']:
        folder=OUT/spec['sha256'][:12];folder.mkdir(parents=True,exist_ok=True);target=folder/'spec.json';target.write_text(json.dumps(spec,ensure_ascii=False),encoding='utf-8')
        prior=folder/'report.json'
        if args.retry and prior.exists() and not json.loads(prior.read_text(encoding='utf-8')).get('errors'):continue
        jobs.append(target)
    exits={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures=[pool.submit(launch,p) for p in jobs]
        for future in concurrent.futures.as_completed(futures):
            spec,code=future.result();exits[spec['sha256']]=code;print(json.dumps({'file':spec['name'],'exit':code},ensure_ascii=False),flush=True)
    reports=[]
    for spec in plan['documents']:
        path=OUT/spec['sha256'][:12]/'report.json'
        report=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {**spec,'errors':['No completed report']}
        if exits.get(spec['sha256'],0) or not report.get('finished') or not report.get('sourceUnchanged'):
            report.setdefault('errors',[]).append({'error':'Worker did not complete','exit':exits.get(spec['sha256'])})
        reports.append(report)
    attempts=[a for r in reports for p in r.get('pages',[]) for a in p.get('attempts',[])]
    result={'created':stamp(),'seed':plan['seed'],'documents':len(reports),'pages':sum(len(r.get('pages',[])) for r in reports),'attempts':dict(collections.Counter(a['status'] for a in attempts)),'errorFiles':sum(bool(r.get('errors')) for r in reports),'reports':reports}
    (OUT/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    ledger=pathlib.Path(plan['ledger']);ledger.parent.mkdir(parents=True,exist_ok=True)
    with ledger.open('a',encoding='utf-8') as stream:
        for report in reports:stream.write(json.dumps({'time':stamp(),'sha256':report['sha256'],'name':report['name'],'samplePages':report['samplePages'],'seed':plan['seed'],'errors':report.get('errors',[]),'report':str(OUT/report['sha256'][:12]/'report.json')},ensure_ascii=False)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='reports'},ensure_ascii=False));sys.exit(bool(result['errorFiles']))


if __name__=='__main__':main()

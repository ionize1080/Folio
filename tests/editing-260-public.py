"""Run a pinned public subset with explicit success floors and reported limits."""
import argparse,concurrent.futures,importlib.util,json,os,pathlib,sys,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('corpus',ROOT/'tests/editing-corpus-260.py');corpus=importlib.util.module_from_spec(spec);spec.loader.exec_module(corpus)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--shard',type=int,required=True);parser.add_argument('--shards',type=int,default=4);parser.add_argument('--local',action='store_true');args=parser.parse_args()
    assert 1<=args.shard<=args.shards
    manifest=json.loads((ROOT/'tests/public-editing-260.json').read_text(encoding='utf-8'))
    entries=[r for i,r in enumerate(manifest['documents']) if i%args.shards==args.shard-1]
    folder=ROOT/'tests/output/editing-public-downloads';folder.mkdir(parents=True,exist_ok=True)
    local={}
    if args.local:
        plan=json.loads((ROOT/'tests/output/editing-260-plan.json').read_text(encoding='utf-8'));local={r['sha256']:r['path'] for r in plan['documents']}
    def prepare(entry):
        path=pathlib.Path(local.get(entry['sha256'],folder/(entry['sha256']+'.pdf')))
        if not path.exists() or corpus.digest(path)!=entry['sha256']:
            assert not args.local,'Local test source changed'
            last=None
            for retry in range(3):
                try:
                    request=urllib.request.Request(entry['url'],headers={'User-Agent':'Folio PDF regression/2.6 (+https://github.com/ionize1080/Folio)'})
                    with urllib.request.urlopen(request,timeout=90) as response:raw=response.read(16*1024**2+1)
                    assert len(raw)<=16*1024**2 and raw.startswith(b'%PDF-'),'Unexpected public response'
                    import hashlib
                    assert hashlib.sha256(raw).hexdigest()==entry['sha256'],'Public source hash changed'
                    path.write_bytes(raw);last=None;break
                except Exception as e:last=e;time.sleep(retry+1)
            if last:raise last
        item={**entry,'path':str(path)};target=corpus.OUT/entry['sha256'][:12]/'spec.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(item,ensure_ascii=False),encoding='utf-8');return target
    errors=[];documents=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures={pool.submit(prepare,entry):entry for entry in entries};targets=[]
        for future in concurrent.futures.as_completed(futures):
            try:targets.append(future.result())
            except Exception as error:errors.append({'name':futures[future]['name'],'error':str(error)})
        for item,code in pool.map(corpus.launch,targets):
            path=corpus.OUT/item['sha256'][:12]/'report.json';r=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
            attempts=[a for p in r.get('pages',[]) for a in p.get('attempts',[])]
            passed=sum(a['status']=='passed' for a in attempts)
            valid=code==0 and not r.get('errors') and r.get('sourceUnchanged') and passed>=item['minPassed'] and len(r.get('pages',[]))==len(item['samplePages'])
            row={k:item[k] for k in ('name','sha256','url','samplePages','minPassed')};row.update(passed=passed,limited=[{'page':p['page'],'reason':a['error']} for p in r.get('pages',[]) for a in p.get('attempts',[]) if a['status']=='limited'],pages=r.get('pages',[]),status='passed' if valid else 'failed')
            documents.append(row)
            if not valid:errors.append({'name':item['name'],'exit':code,'passed':passed,'required':item['minPassed'],'errors':r.get('errors')})
    result={'status':'failed' if errors else 'passed','shard':args.shard,'shards':args.shards,'manifestDocuments':len(manifest['documents']),'documents':documents,'errors':errors}
    (ROOT/f'tests/output/editing-{args.shard}-260.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in result.items() if k!='documents'},ensure_ascii=True));return bool(errors)
if __name__=='__main__':sys.exit(main())

import sys,json,pathlib
sys.path.insert(0,'native')
from worker import run
for n in [2,14]:
 r=run({'command':'inspect','input':'../upload/QDII额度与纳指标普产品比较_20260831(1).pdf','page':n})
 pathlib.Path(f'tests/output/v10-qdii-{n}.json').write_text(json.dumps(r))
 print(n,len(r['objects']),[(f['fontName'],f['fontFallback']) for f in r['fonts'].values()])

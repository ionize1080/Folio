"""1.2 bounded original-font edits and owned content markers."""
import sys,io,json,base64,copy,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
import fitz,worker,logging
logging.getLogger("pypdf").setLevel(logging.ERROR)
from pypdf import PdfReader
from story import layout
out=root/'tests/output';out.mkdir(exist_ok=True);checks=[]
def model(raw):
 r=worker.run({'command':'inspect','bytes':base64.b64encode(raw).decode()});p=out/'v12-inspect.json';p.write_text(json.dumps(r))
 js="import {pageCandidates} from './src/flow-page-model.mjs';import fs from 'node:fs';const r=JSON.parse(fs.readFileSync('tests/output/v12-inspect.json'));console.log(JSON.stringify(pageCandidates(r.objects,595,842)[0].model));"
 return json.loads(subprocess.check_output(['node','--input-type=module','-e',js],cwd=root))
def apply(raw,m):
 r=layout(m);e={'id':'v12','page':1,'type':'flow','sources':m['sources'],'model':m,'fragment':r['fragment'],'ink':r['glyphs']}
 return base64.b64decode(worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),'edits':[e]})['bytes'])
for embedded in [False,True]:
 d=fitz.open();p=d.new_page(width=595,height=842)
 if embedded:p.insert_font(fontname='Original',fontfile=str(root/'native/fonts/DejaVuSans.ttf'))
 p.insert_text((70,100),'ABCDABCD',fontname='Original' if embedded else 'helv',fontsize=12)
 if embedded:d.subset_fonts()
 raw=d.tobytes();d.close();m=model(raw);assert len(m['sources'])==1
 m['text']='AACDABCD';edited=apply(raw,m);p=PdfReader(io.BytesIO(edited)).pages[0]
 assert not p['/Resources'].get('/XObject'),p['/Resources']
 with fitz.open(stream=edited,filetype='pdf') as d:assert 'AACDABCD' in d[0].get_text()
 with fitz.open(stream=raw,filetype='pdf') as a,fitz.open(stream=edited,filetype='pdf') as b:
  ga=[c for bl in a[0].get_text('rawdict')['blocks'] if 'lines' in bl for l in bl['lines'] for s in l['spans'] for c in s['chars']]
  gb=[c for bl in b[0].get_text('rawdict')['blocks'] if 'lines' in bl for l in bl['lines'] for s in l['spans'] for c in s['chars']]
  assert len(ga)==len(gb)
  assert all(abs(x['origin'][0]-y['origin'][0])<.002 and abs(x['origin'][1]-y['origin'][1])<.002 for x,y in zip(ga,gb))
 checks.append('Original font resource and glyph origins retained: '+('embedded subset' if embedded else 'standard font'))
 # Unsupported geometry/style changes use identified fragment, never patch original codes.
 changed=copy.deepcopy(m);changed['size']=14;edited=apply(raw,changed);p=PdfReader(io.BytesIO(edited)).pages[0]
 assert any(x.get_object().get('/FolioLayerVersion')==2 for x in p['/Resources']['/XObject'].values())
 checks.append('Style change uses versioned content form')
print(json.dumps({'checks':checks},ensure_ascii=False));(out/'v12-native-report.json').write_text(json.dumps({'checks':checks},ensure_ascii=False,indent=2))

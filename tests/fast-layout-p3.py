"""End-to-end font/direction/retained-break fixtures without private documents."""
import sys,json,base64,subprocess,time,copy
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
import fitz,worker
from fast_layout import font_data,render
out=root/'tests/output';out.mkdir(exist_ok=True);checks=[]
d=fitz.open();p=d.new_page(width=595,height=842);font=str(root/'native/fonts/DejaVuSans.ttf');p.insert_font(fontname='Body',fontfile=font)
p.insert_text((70,100),'Quarterly report',fontname='Body',fontsize=14,render_mode=2,border_width=.35)
p.insert_text((70,140),'Original first line',fontname='Body',fontsize=12)
p.insert_text((70,156),'Original second line',fontname='Body',fontsize=12)
p.insert_text((70,200),'Selection bold and italic',fontname='Body',fontsize=12)
p.insert_text((400,100),'ROTATED',fontname='Body',fontsize=12,rotate=270)
raw=d.tobytes();d.close();(out/'p3-fixture.pdf').write_bytes(raw)
r=worker.run({'command':'inspect','bytes':base64.b64encode(raw).decode()});assert any(o.get('bold') and o.get('renderMode')==2 for o in r['objects']);checks.append('PDF fill/stroke synthetic bold recognized')
(out/'p3-inspect.json').write_text(json.dumps(r))
js="import fs from 'node:fs';import {pageCandidates} from './src/flow-page-model.mjs';const r=JSON.parse(fs.readFileSync('tests/output/p3-inspect.json'));console.log(JSON.stringify(pageCandidates(r.objects,...r.size).map(c=>c.model)));"
models=json.loads(subprocess.check_output(['node','--input-type=module','-e',js],cwd=root));assert any('first line\nOriginal second' in m['text'] for m in models);assert any(m.get('rotation')==90 for m in models);checks.append('Hard line boundaries and rotated region survive extraction')
m=next(m for m in models if m['text']=='Selection bold and italic')
fd=font_data(m['fontKey']);font=fitz.Font(fontbuffer=base64.b64decode(fd['base64']));widths={c:font.text_length(c,fontsize=m['size']) for c in m['text']};(out/'p3-fast-input.json').write_text(json.dumps({'model':m,'widths':widths}))
js="import fs from 'node:fs';import {fastLayout} from './src/fast-layout.mjs';const {model:m,widths}=JSON.parse(fs.readFileSync('tests/output/p3-fast-input.json'));m.runs=[{...m.runs[0],start:0,end:m.text.length,bold:true,italic:true}];m.fastLayout=fastLayout(m,(c,s)=>({width:widths[c],fontKey:s.fontKey}));console.log(JSON.stringify(m));"
m=json.loads(subprocess.check_output(['node','--input-type=module','-e',js],cwd=root));result=render(m)
e={'id':'p3','page':1,'type':'flow','sources':m['sources'],'model':m,'fragment':result['fragment'],'ink':result['glyphs']}
saved=base64.b64decode(worker.run({'command':'apply','bytes':base64.b64encode(raw).decode(),'edits':[e]})['bytes']);(out/'p3-saved.pdf').write_bytes(saved)
with fitz.open(stream=saved,filetype='pdf') as pdf:
 assert 'Selection' in pdf[0].get_text();traces=[t for t in pdf[0].get_texttrace() if 180<t['bbox'][1]<210];assert any(t['type']==1 for t in traces)
 assert any(abs(t['dir'][0]-1)<.01 for t in traces)
checks.append('Selected synthetic bold and italic exported as actual searchable PDF text')
# A stale/malformed cache must not silently export other text.
bad=copy.deepcopy(m);bad['text']+='X'
try:render(bad);raise AssertionError('stale accepted')
except ValueError:pass
checks.append('Stale glyph mapping rejected before save')
# Both fast and precise must retain synthetic bold.
from story import layout
precise={**m,'layoutMode':'reflow','frame':{**m['frame'],'height':100}};res=layout(precise)
assert not res['overflow'] and res['mappingComplete']
with fitz.open(stream=base64.b64decode(res['fragment']),filetype='pdf') as pdf:assert any(t['type']==1 for t in pdf[0].get_texttrace())
checks.append('Story precision preview preserves synthetic bold')
(out/'p3-native-report.json').write_text(json.dumps({'checks':checks},indent=2));print(json.dumps({'checks':checks}))

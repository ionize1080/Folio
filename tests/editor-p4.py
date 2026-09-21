"""Native regressions for narrow cells and anchored visual-only formatting."""
from pathlib import Path
import sys,base64,json,subprocess,copy
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native'))
import fitz,worker
from story import layout
out=root/'tests/output';out.mkdir(parents=True,exist_ok=True);d=fitz.open();p=d.new_page(width=600,height=800)
p.insert_font(fontname='Body',fontfile=str(root/'native/fonts/DejaVuSans.ttf'))
for row in range(3):
 for col in range(2):
  x=[80,98,180];y=80+row*20;p.draw_rect(fitz.Rect(x[col],y,x[col+1],y+20),color=(0,0,0),width=.5)
  p.insert_text((x[col]+2,y+13),'A' if col==0 else 'Body text',fontname='Body',fontsize=11)
raw=d.tobytes();d.close();(out/'p4-narrow.pdf').write_bytes(raw)
r=worker.run({'command':'inspect','bytes':base64.b64encode(raw).decode()});(out/'p4-narrow-inspect.json').write_text(json.dumps(r))
js="import fs from 'fs';import {createRequire} from 'module';import {pageCandidates} from './src/flow-page-model.mjs';let r=JSON.parse(fs.readFileSync('tests/output/p4-narrow-inspect.json'));let ms=pageCandidates(r.objects,...r.size,[],r.tables).map(c=>c.model).filter(m=>m.cell);let {validateModel}=createRequire(import.meta.url)('./flow-validation.cjs');ms.forEach(validateModel);console.log(JSON.stringify(ms));"
ms=json.loads(subprocess.check_output(['node','--input-type=module','-e',js],cwd=root));(out/'p4-narrow-models.json').write_text(json.dumps(ms))
m=next(m for m in ms if m['text'].strip()=='A');assert m['frame']['width']<m['size']*2
before=layout(m);oldglyphs=m['originalLayout']['glyphs'];m['bold']=True
for run in m['runs']:run['bold']=True;run['italic']=True
r=layout(m);assert not r['overflow'] and r['mappingComplete'];assert r['layoutMode']=='原始字位'
assert [(g['originX'],g['baseline']) for g in r['glyphs']]==[(g['originX'],g['baseline']) for g in oldglyphs]
with fitz.open(stream=base64.b64decode(r['fragment']),filetype='pdf') as d:
 assert 'A' in d[0].get_text();assert any(t['type']==1 for t in d[0].get_texttrace())
# Table row translation carries source anchors, with no paragraph reflow.
m['frame']['y']+=20;r2=layout(m);assert r2['layoutMode']=='原始字位'
assert all(abs(b['baseline']-a['baseline']-20)<.001 for a,b in zip(r['glyphs'],r2['glyphs']))
print('PASS narrow single-character cell; bold/italic preserve anchors and searchable text; row translation retains glyph geometry')

# Directional regions must keep the established direction-aware route.
from fast_layout import anchored_style
for change in ({'rotation':90},{'writingMode':'vertical-rl'}):
 directed=copy.deepcopy(m);directed.update(change);assert anchored_style(directed) is None

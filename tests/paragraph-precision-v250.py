"""Invisible advances must not force reflow; cached coverage follows font bytes."""
import copy
import io
import json
import sys
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'native'),str(ROOT/'native/vendor'),str(ROOT/'tests')]
import fitz
from p8_helpers import models,save,pixels
from story import layout
import font_match
from fontTools.ttLib import TTFont

doc=fitz.open();page=doc.new_page(width=300,height=200)
page.insert_text((40,60),'ABCABC ',fontsize=14)
page.insert_text((40,80),'ABCD',fontsize=14)
doc.new_page(width=300,height=200).insert_text((30,50),'Untouched neighbor')
raw=doc.tobytes();doc.close()
_,candidates=models(raw);model=next(m for m in candidates if m['text']=='ABCABC \nABCD')
original=model['originalLayout'];right=model['frame']['x']+model['frame']['width']
assert any(g['text']==' ' and g['x']+g['w']>right+.5 for g in original['glyphs'])
model['text']='BBCABC \nABCD'
result=layout(model)
assert result['mappingComplete'] and not result['overflow'] and result['layoutMode']=='原始字位'
for old,new in zip(original['glyphs'],result['glyphs']):
    if old['text']=='\n':continue
    assert abs(old['originX']-new['originX'])<.001 and abs(old['baseline']-new['baseline'])<.001
edited=save(raw,model,result=result)
assert pixels(raw,1)==pixels(edited,1)
assert any(m['text']==model['text'] for m in models(edited)[1])
# Visible source ink outside the frame still needs the ordinary overflow warning.
outside=copy.deepcopy(model);outside['originalLayout']['glyphs'][5]['x']+=10
assert layout(outside)['overflow']

blob=(ROOT/'native/fonts/DejaVuSans.ttf').read_bytes();requested={32,65,66}
expected=font_match._populated_coverage(blob,requested)
assert expected==requested
assert font_match.populated_coverage(blob,requested)==expected
with patch.object(font_match,'_populated_coverage',side_effect=AssertionError('reparsed identical font')):
    assert font_match.populated_coverage(blob,set(requested))==expected
font=TTFont(io.BytesIO(blob),recalcTimestamp=False)
name=font.getBestCmap()[65];advance,bearing=font['hmtx'].metrics[name]
font['hmtx'].metrics[name]=(0,bearing)
changed=io.BytesIO();font.save(changed);font.close()
assert font_match.populated_coverage(changed.getvalue(),requested)=={32,66}
assert font_match.populated_coverage(blob,{66})=={66}
assert len(font_match._coverage_cache)<=32
assert sum(len(k[1]) for k in font_match._coverage_cache)<=font_match.MAX_CACHED_CODEPOINTS
report=dict(status='passed',checks=[
    'invisible trailing space beyond ink frame preserves anchors without false overflow',
    'same-width correction saves and reopens exact paragraph text with unchanged adjacent pixels',
    'visible overflow is still reported',
    'identical font bytes reuse verified coverage; changed font metrics and requested cmap invalidate it',
])
out=ROOT/'tests/output/paragraph-precision-v250.json';out.write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))

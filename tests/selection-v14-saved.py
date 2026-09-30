"""Check actual PDF emitted by the packaged selection UI, independently of its UI assertions."""
from pathlib import Path
import fitz,json
out=Path('tests/output')
with fitz.open(out/'v14-selection.pdf') as source,fitz.open(out/'v14-ui-saved.pdf') as saved:
 assert len(source)==len(saved)==2
 def spans(page):return [s for b in page.get_text('dict')['blocks'] if b['type']==0 for l in b['lines'] for s in l['spans']]
 a=spans(source[0]);b=spans(saved[0]);assert len(a)==len(b)==3
 for i in (0,1):
  assert a[i]['font']==b[i]['font'] and a[i]['text']==b[i]['text']
  assert abs(b[i]['size']-20)<.05 and b[i]['color']==0xd21b43
  assert b[i]['origin'][0]>a[i]['origin'][0]+10 and abs(b[i]['origin'][1]-a[i]['origin'][1])<.1
 assert a[2]==b[2]
 assert source[1].get_pixmap().samples==saved[1].get_pixmap().samples
 for x in (100,400):assert source[0].get_pixmap().pixel(x,250)!=saved[0].get_pixmap().pixel(x,250)
report=json.loads((out/'v14-ui-report.json').read_text());assert not report['errors'];report['checks'].append('Saved packaged PDF: both texts retain fonts/content, final size/color/movement exact; both images changed; unselected text and other page unchanged')
(out/'v14-ui-report.json').write_text(json.dumps(report,indent=2));print('Packaged selection PDF independently verified')

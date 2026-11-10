import os,json,sys
from pathlib import Path
import fitz
import numpy as np
from collections import Counter
out=Path(__file__).resolve().parent/'output'
user=os.environ.get('FOLIO_USER_PDF');prefix='user-' if user else ''
source=Path(user) if user else out/'workflow-250-source.pdf'
original=fitz.open(source);saved=fitz.open(out/(prefix+'workflow-250.pdf'))
assert len(saved)==len(original)+2
for page in list(saved)[:2]:
    assert abs(page.rect.width-260*72/25.4)<.02 and abs(page.rect.height-180*72/25.4)<.02
    assert not page.get_text().strip()
old_outline=original.get_toc();new_outline=saved.get_toc()
assert len(old_outline)==len(new_outline)
assert [[r[0],r[1],r[2]+2 if r[2]>0 else r[2]] for r in old_outline]==new_outline
number=61 if user else 0
assert '2026' in saved[number+2].get_text()
def glyphs(page):
    return Counter((c['c'],round(c['origin'][0],2),round(c['origin'][1],2)) for b in page.get_text('rawdict')['blocks'] if b['type']==0 for l in b['lines'] for s in l['spans'] for c in s['chars'])
a=glyphs(original[number]);b=glyphs(saved[number+2]);retained=sum((a&b).values())/max(1,sum(a.values()))
assert retained>.97,retained
for index in {0,len(original)-1}-{number}:
    a=original[index].get_pixmap();b=saved[index+2].get_pixmap()
    assert a.width==b.width and a.height==b.height and a.samples==b.samples,'Untouched page changed'
report_path=out/(prefix+'workflow-'+('live-' if '--live' in sys.argv else '')+'250.json')
report=json.loads(report_path.read_text(encoding='utf8'))
report['independent']={'retainedOriginalGlyphPositions':retained,'blankDimensionsVerified':True,'bookmarksRemapped':len(old_outline),'untouchedPagesIdentical':True}
report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print('PASS saved document: page geometry, outline destinations, original glyph positions and untouched pages',report['independent'])

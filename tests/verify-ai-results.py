"""Verify the written PDF, not the model's claims or current tree labels."""
import json,re,sys
from pathlib import Path
import pymupdf
root=Path(__file__).resolve().parent/'output/ai-corpus'
checks=[]
for meta in sorted(root.glob('model-result-*.json')):
 item=json.loads(meta.read_text(encoding='utf8'))
 with pymupdf.open(item['file']) as doc:
  outline=doc.get_toc(False)
  rows=[r for r in outline if r[1]==item['title']]
  assert len(rows)==1,(item['title'],rows)
  row=rows[0]
  assert row[2]==item['expectedPage'],(item['title'],row[2],item['expectedPage'])
  raw=doc.xref_object(row[3]['xref'])
  if any(k in item['title'] for k in ['古诗三首','范围','rejuvenation']):
   assert re.search(r'/XYZ\s+[-\d.]+\s+[-\d.]+',raw),(item['title'],'coordinates missing',raw)
  if '古诗三首' in item['title']:
   assert row[0]==2,'child hierarchy missing'
   assert any(r[0]==1 and r[1]=='AI验收 第一单元' and r[2]==6 for r in outline)
  terms = {'AI验收 古诗三首': ('古诗三首', 0), 'AI验收 范围': ('范围', 5*72/25.4), 'AI验收 The great tech rejuvenation': ('The great', 0)}
  if item['title'] in terms:
   term, margin = terms[item['title']]
   page = doc[row[2]-1]
   xy = re.search(r'/XYZ\s+([-\d.]+)\s+([-\d.]+)',raw)
   point = pymupdf.Point(float(xy[1]),float(xy[2])) * page.transformation_matrix
   boxes = page.search_for(term)
   assert boxes and min(abs(point.y-(box.y0-margin)) for box in boxes) < 4, (item['title'], point, boxes, margin)
  checks.append({'name':item['name'],'page':row[2],'level':row[0],'destination':raw})
assert len(checks)==5,('expected five completed model workflows',len(checks))
(root/'verified-results.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf8')
print('PASS saved PDF pages, hierarchy and explicit XYZ destinations:',len(checks))

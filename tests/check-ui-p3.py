from pathlib import Path
import fitz,json
out=Path(__file__).resolve().parent/'output'
with fitz.open(out/'p3-ui-fragment.pdf') as doc:
 traces=doc[0].get_texttrace()
 assert any(t['type']==1 for t in traces),'Selected bold must survive UI commit'
 assert 'Selection' in doc[0].get_text(),'UI export must be searchable'
report=json.loads((out/'p3-ui-report.json').read_text());assert not report['errors'];assert report['perf']['requests']==0
print('P3 UI output independently verified: searchable text, synthetic bold, no per-key backend request')

"""Read-only object/paragraph audit of the supplied investment strategy PDF."""
from pathlib import Path
import base64, hashlib, json, subprocess, sys, time
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'native'), str(ROOT / 'native/vendor')]
sys.stdout.reconfigure(encoding='utf-8')
import fitz, worker
from table_geometry import inspect_tables

SOURCE = Path(r'D:\APP\PDF Samples\十五五规划投资全景_跨市场五年配置策略.pdf')
OUT = ROOT / 'tests/output/deep-edit-v191-paragraphs'
OUT.mkdir(parents=True, exist_ok=True)
label = sys.argv[1] if len(sys.argv) > 1 else 'before'
raw = SOURCE.read_bytes()
encoded = base64.b64encode(raw).decode()
doc = fitz.open(stream=raw, filetype='pdf')
report = {'source': str(SOURCE), 'sourceSha256': hashlib.sha256(raw).hexdigest(), 'pages': len(doc), 'label': label, 'results': []}
for page in range(1, len(doc) + 1):
    cached = OUT / f'inspect-{page:02d}.json'
    if cached.exists():
        data = json.loads(cached.read_text(encoding='utf-8'))
    else:
        data = worker.run({'command': 'inspect', 'bytes': encoded, 'page': page})
        cached.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    if label != 'before':
        data['tables'] = inspect_tables(raw, page)
    began = time.perf_counter()
    models = json.loads(subprocess.check_output(
        ['node', '--input-type=module', '-e',
         "import{pageCandidates}from'./src/flow-page-model.mjs';let s='';for await(const c of process.stdin)s+=c;let v=JSON.parse(s);console.log(JSON.stringify(pageCandidates(v.objects,...v.size,[],v.tables)));"],
        input=json.dumps(data).encode(), cwd=ROOT))
    elapsed = round((time.perf_counter() - began) * 1000, 2)
    (OUT / f'{label}-{page:02d}.json').write_text(json.dumps(models, ensure_ascii=False, indent=2), encoding='utf-8')
    records = [{'id': c['id'], 'text': c['model']['text'], 'frame': c['model']['frame'], 'sources': [s['index'] for s in c['model']['sources']], 'warning': c['model'].get('styleMappingWarning')} for c in models]
    checked = []
    if label != 'before':
        before = json.loads((OUT / f'before-{page:02d}.json').read_text(encoding='utf-8'))
        old_ids = Counter(s['index'] for c in before for s in c['model']['sources'])
        new_ids = Counter(s['index'] for c in models for s in c['model']['sources'])
        assert old_ids == new_ids, (page, old_ids - new_ids, new_ids - old_ids)
        assert all(count == 1 for count in new_ids.values()), (page, new_ids)
        assert not any(c['model'].get('styleMappingWarning') for c in models), page
        expected = {2: (7, 4), 6: (5, 2), 7: (4, 5), 9: (4, 4), 11: (8, 5)}
        if page in expected:
            t = data['tables'][0]
            assert (t['rows'], t['columns']) == expected[page], (page, t)
            assert len(t['cells']) == t['rows'] * t['columns'], page
        checked = ['source ownership preserved exactly once', 'no style mapping warning', 'expected ruled-table dimensions']
    report['results'].append({'page': page, 'models': len(models), 'msWithNodeStartup': elapsed, 'checks': checked, 'candidates': records})
    print(json.dumps({'page': page, 'models': len(models), 'ms': elapsed}, ensure_ascii=False), flush=True)
    if label == 'before':
        doc[page - 1].get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False).save(OUT / f'page-{page:02d}.png')
(OUT / f'{label}-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

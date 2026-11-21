"""Verify the independent Reader XI application observes each named stream fixture."""
import argparse
import importlib.util
import json
from pathlib import Path

def main():
    ap = argparse.ArgumentParser()
    for name in ('viewer','pdfs','evidence'):
        ap.add_argument(name, type=Path)
    args = ap.parse_args()
    args.evidence.mkdir(parents=True, exist_ok=True)
    helper = Path(__file__).with_name('reader-xi-isolated-gui.py')
    spec = importlib.util.spec_from_file_location('xi_gui', helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    matrix = json.loads((args.pdfs/'stream-manifest.json').read_text(encoding='utf-8'))['cases']
    expected = {'stream-original', 'stream-fixed-first', 'stream-fixed-second',
                'stream-legacy-first', 'stream-legacy-second',
                'stream-migrated-first', 'stream-migrated-second'}
    assert {Path(case['file']).stem for case in matrix} == expected and len(matrix) == 7
    result = []
    for case in matrix:
        filename = case['file']
        try:
            row = module.check(args.viewer, args.pdfs/filename, args.evidence)
        except Exception as exc:
            row = {'file':filename,'passed':False,'error':str(exc)}
        row['legacyControl'] = case['legacyControl']
        row['markersRead'] = [m for m in case['expectedMarkers'] if m in row.get('copiedText','')]
        row['verified'] = bool(row['passed'] and row['markersRead'] == case['expectedMarkers'])
        result.append(row)
        print('XI_STREAM ' + json.dumps(row, ensure_ascii=True), flush=True)
    (args.evidence/'reader-stream-observations.json').write_text(
        json.dumps(result,ensure_ascii=False,indent=2) + '\n',encoding='utf-8')
    assert all(r['verified'] for r in result if not r['legacyControl']), 'Reader XI did not verify a required document'
    assert all('error' not in r for r in result), 'Unexpected observation failure on the QA machine'

if __name__ == '__main__':
    main()

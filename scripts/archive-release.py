"""Package verified portable runtime and source. Python standard library only."""
from pathlib import Path
import hashlib, json, sys, zipfile
root = Path(__file__).resolve().parents[1]
package = json.loads((root / 'package.json').read_text())
version = package['version'] + ('-' + package['releaseChannel'].upper() if package.get('releaseChannel') else '')
out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root.parent / 'deliverables'
out.mkdir(parents=True, exist_ok=True)
files = [out / f'Folio-PDF-Studio-{version}-win-x64.zip', out / f'Folio-PDF-Studio-{version}-source.zip']
base = root / 'dist/Folio-PDF-Studio-win-x64'
with zipfile.ZipFile(files[0], 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for f in sorted(base.rglob('*')):
        rel = f.relative_to(base)
        if f.is_file() and not any(p.startswith('.') for p in rel.parts) and f.name not in ['electron.exe', 'default_app.asar']:
            z.write(f, Path('Folio-PDF-Studio') / rel)
with zipfile.ZipFile(files[1], 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for f in sorted(root.rglob('*')):
        rel = f.relative_to(root)
        if not f.is_file() or any(p.startswith('.') or p in ['node_modules', 'dist', '__pycache__'] for p in rel.parts):
            continue
        if rel.parts[:2] == ('native', 'runtime'):
            continue
        if len(rel.parts) == 1 and (f.name.startswith('diagnose-') or f.name == 'verify-calibration-cause.mjs'):
            continue
        if rel.parts[:2] == ('tests', 'output') and not ((f.name.startswith(('v6-', 'v8-', 'v9-', 'v10-'))) and f.name.endswith('report.json')) and f.name not in ['benchmark.json', 'package-report.json', 'v2-ui-report.json','v3-ui-report.json','v3-native-report.json','v4-native-report.json','v4-ui-report.json','v4-jobs-report.json','v5-native-report.json','v5-ui-report.json','v5-jobs-report.json','v5-scheduler-report.json']:
            continue
        z.write(f, Path('Folio-PDF-Studio-source') / rel)
result = []
for f in files:
    with zipfile.ZipFile(f) as z:
        assert z.testzip() is None
    result.append({'file': f.name, 'bytes': f.stat().st_size, 'sha256': hashlib.sha256(f.read_bytes()).hexdigest()})
(out / f'Folio-PDF-Studio-{version}-SHA256.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))

"""Verify engine revision, Folio adaptations, and every shipped byte before packaging."""
import hashlib,json,runpy,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def verify(kinds=('photo','vector')):
    lock=json.loads((ROOT/'integrations/creative/source-lock.json').read_text())
    fingerprint=runpy.run_path(str(ROOT/'scripts/build-creative.py'))['source_fingerprint']()
    for kind in kinds:
        folder=ROOT/'.creative-web'/kind;build=json.loads((folder/'build.json').read_text())
        assert build['revision']==lock[kind]['revision'] and build['repository']==lock[kind]['repository'], 'Unexpected engine source'
        assert build['sourceFingerprint']==fingerprint, 'Editing engine requires rebuilding: '+kind
        for name,digest in build['files'].items():
            file=(folder/name).resolve();assert file.is_relative_to(folder.resolve()), 'Invalid build path'
            assert hashlib.sha256(file.read_bytes()).hexdigest()==digest, 'Editing engine checksum: '+kind+'/'+name
        for name in ['engine_bg.wasm','engine.js','index.html','licenses/LICENSE-MIT','licenses/LICENSE-APACHE','licenses/Folio.md','fonts/manifest.txt']:
            assert name in build['files'], 'Missing engine asset: '+name
        print('PASS pinned source and asset integrity: '+kind)
if __name__=='__main__':verify(sys.argv[1:] or ('photo','vector'))

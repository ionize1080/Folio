"""Validate reproducible intermediate AI builds and cap optional cache writes."""
from pathlib import Path
import hashlib, json, os, subprocess, sys
ROOT=Path(__file__).resolve().parents[1]
AI=['.ai-runtime/Chatbox','.ai-runtime/pdf-runtime','.ai-runtime/chatbox-source/.git']
def files(paths):
    for name in paths:
        p=ROOT/name
        if p.is_file(): yield p
        elif p.exists():
            yield from (f for f in p.rglob('*') if f.is_file() and '__pycache__' not in f.parts)
def fingerprint(paths):
    return {p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files(paths)}
def main():
    action=sys.argv[1];manifest=ROOT/'.ci-cache/ai-manifest.json'
    if action=='record':
        manifest.parent.mkdir(exist_ok=True)
        manifest.write_text(json.dumps({'key':os.environ['FOLIO_BUILD_KEY'],'files':fingerprint(AI)},sort_keys=True),encoding='utf-8')
    elif action=='verify':
        data=json.loads(manifest.read_text(encoding='utf-8'))
        assert data['key']==os.environ['FOLIO_BUILD_KEY'] and data['files']==fingerprint(AI),'Intermediate cache integrity mismatch'
        for name in ['tool-schema.cjs','profile.cjs','result-cache.cjs','network.cjs']:
            assert (ROOT/'.ai-runtime/Chatbox'/name).read_bytes()==(ROOT/'integrations/chatbox'/name).read_bytes()
        provenance=json.loads((ROOT/'.ai-runtime/pdf-runtime/provenance.json').read_text())
        assert provenance['folioPatchSha256']==hashlib.sha256((ROOT/'integrations/pdf-mcp-folio.patch').read_bytes()).hexdigest()
    elif action=='budget':
        paths=AI if sys.argv[2]=='ai' else ['.ai-runtime/conversion-downloads','native/models']
        size=sum(p.stat().st_size for p in files(paths))
        usage=json.loads(subprocess.check_output(['gh','api',f"repos/{os.environ['GITHUB_REPOSITORY']}/actions/cache/usage"],text=True))['active_caches_size_in_bytes']
        allowed=size<=4*1024**3 and usage+size<=8*1024**3
        with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf-8') as f:f.write('allowed='+str(allowed).lower()+'\n')
        print(f'Optional cache write: {allowed}; conservative added bytes={size}; existing bytes={usage}. No paid cache limit changes.')
    else:raise ValueError('Unknown cache action')
if __name__=='__main__':main()

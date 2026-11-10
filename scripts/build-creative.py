"""Build the pinned, embedded editors. No platform desktop binaries are packaged."""
import argparse,hashlib,json,os,runpy,shutil,subprocess
try:import tomllib
except ImportError:import tomli as tomllib
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def source_fingerprint():
    names=['scripts/build-creative.py','scripts/patch-creative.py']
    names += [p.relative_to(ROOT).as_posix() for p in (ROOT/'integrations/creative').rglob('*') if p.is_file()]
    return hashlib.sha256(b''.join(n.encode()+b'\0'+(ROOT/n).read_bytes().replace(b'\r\n',b'\n')+b'\0' for n in sorted(names))).hexdigest()
def run(*args,cwd=None):subprocess.run([str(a) for a in args],cwd=cwd or ROOT,check=True)
def build(kind,skip_build=False):
    lock=json.loads((ROOT/'integrations/creative/source-lock.json').read_text());spec=lock[kind]
    source=ROOT/'.creative-sources'/spec['package'].removesuffix('-web')
    source.parent.mkdir(exist_ok=True)
    if not (source/'.git').exists():
        run('git','init',source);run('git','remote','add','origin',spec['repository'],cwd=source)
        run('git','-c','core.longpaths=true','fetch','--depth','1','origin',spec['revision'],cwd=source)
        run('git','-c','core.longpaths=true','checkout','--detach','FETCH_HEAD',cwd=source)
    actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()
    if actual!=spec['revision']:raise RuntimeError('Editor source revision does not match source-lock.json')
    runpy.run_path(str(ROOT/'scripts/patch-creative.py'))['patch'](kind,source)
    out=ROOT/'.creative-web'/kind;out.mkdir(parents=True,exist_ok=True)
    if not skip_build:
        # Short diagnostics avoid rustc's snippet-renderer panic on deeply nested
        # Windows/WSL checkouts; this does not suppress compiler diagnostics.
        run('cargo','build','--locked','--message-format=short','--profile','folio-web','--target','wasm32-unknown-unknown','-p',spec['package'],*( ['--features','heif'] if kind=='photo' else []),cwd=source)
        cargo_lock=tomllib.loads((source/'Cargo.lock').read_text())
        version=next(p['version'] for p in cargo_lock['package'] if p['name']=='wasm-bindgen')
        current=subprocess.run(['wasm-bindgen','--version'],capture_output=True,text=True).stdout.strip() if shutil.which('wasm-bindgen') else ''
        if current!='wasm-bindgen '+version:run('cargo','install','wasm-bindgen-cli','--version',version,'--locked','--force')
        target=Path(os.environ.get('CARGO_TARGET_DIR',source/'target'))
        run('wasm-bindgen','--target','web','--out-name','engine','--out-dir',out,target/'wasm32-unknown-unknown/folio-web'/(spec['package']+'.wasm'))
    title='Folio 图像编辑' if kind=='photo' else 'Folio 矢量编辑'
    canvas='photocraft_canvas' if kind=='photo' else 'vectorcraft_canvas'
    # Retain IDs used by the upstream shell's startup and device-loss handlers.
    (out/'index.html').write_text(f'''<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><link rel="stylesheet" href="editor.css"></head><body><canvas id="{canvas}" tabindex="0"></canvas><div id="{canvas.replace('_canvas','_loading')}" role="status">正在准备画布…</div><div id="{canvas.replace('_canvas','_stopped')}" hidden role="alert"><p id="{canvas.replace('_canvas','_stopped_detail')}"></p><a href="">重新载入编辑器</a></div><script type="module" src="start.mjs"></script></body></html>''',encoding='utf-8')
    (out/'editor.css').write_text('html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f3f4f6;color:#344054;font:14px system-ui}canvas{display:block;width:100%;height:100%;outline:0;touch-action:none}body>div{position:fixed;inset:0;display:grid;place-content:center;gap:16px;text-align:center;background:#f3f4f6}body>[hidden]{display:none}',encoding='utf-8')
    (out/'start.mjs').write_text("import init from './engine.js';\ntry { await init({module_or_path:new URL('./engine_bg.wasm',import.meta.url)}); } catch(e) { const loading=document.querySelector('[role=status]');loading.textContent='画布载入失败：'+e.message;window.folioStartError=e.message; }\n",encoding='utf-8')
    notices=out/'licenses';notices.mkdir(exist_ok=True)
    for name in ['LICENSE-MIT','LICENSE-APACHE','NOTICE','ATTRIBUTION.md','ASSETS.md']:
        if (source/name).exists():shutil.copy2(source/name,notices/name)
    shutil.copy2(ROOT/'integrations/creative/NOTICES.md',notices/'Folio.md')
    # The app already ships these redistributable fonts; the editor uses the same files.
    fonts=out/'fonts';fonts.mkdir(exist_ok=True)
    rows=[]
    for source_name,name,family,scripts,license_id,license_file in [
        ('NotoSansSC-variable.ttf','NotoSansSC.ttf','Noto Sans SC','Hans,Hant,Jpan','OFL-1.1','OFL.txt'),
        ('DejaVuSans.ttf','DejaVuSans.ttf','DejaVu Sans','Latn,Grek,Cyrl','Bitstream-Vera','DejaVu-LICENSE.txt')]:
        shutil.copy2(ROOT/'native/fonts'/source_name,fonts/name)
        digest=hashlib.sha256((fonts/name).read_bytes()).hexdigest()
        rows.append(f'{family} | Regular | fonts/{name} | {scripts} | {license_id} | licenses/{license_file} | {digest} | Folio font bundle')
    (fonts/'manifest.txt').write_text('\n'.join(rows)+'\n',encoding='utf-8')
    for file in (ROOT/'native/fonts').glob('*'):
        if file.is_file() and file.suffix.lower() not in ['.ttf','.otf']:shutil.copy2(file,notices/file.name)
    files={str(p.relative_to(out)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file() and p.name!='build.json'}
    (out/'build.json').write_text(json.dumps({'kind':kind,**spec,'sourceFingerprint':source_fingerprint(),'files':files},indent=2),encoding='utf-8')
    print(json.dumps({'kind':kind,'files':len(files),'wasmBytes':(out/'engine_bg.wasm').stat().st_size}))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('kind',choices=['photo','vector']);ap.add_argument('--skip-build',action='store_true');a=ap.parse_args();build(a.kind,a.skip_build)

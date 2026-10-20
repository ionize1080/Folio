"""Reopen a real first-save PDF, edit with fast export, then save twice again.

The local source is supplied explicitly and is never copied into public reports.
Example: --source tests/output/packaged-deep-v191/textbook-12-0-saved.pdf
"""
from pathlib import Path
import argparse, base64, hashlib, json, subprocess, sys
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'tests'), str(ROOT / 'native'), str(ROOT / 'native/vendor')]
sys.stdout.reconfigure(encoding='utf-8')
import fitz, pypdfium2 as pdfium
from p8_helpers import models, save
from fast_layout import font_data, render
from structure_checks_v191 import assert_tag_structure_preserved

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
OUT = ROOT / 'tests/output/deep-edit-v191-paragraphs'
OUT.mkdir(parents=True, exist_ok=True)
source = args.source.resolve()
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
checks = []


def js(code, value):
    return json.loads(subprocess.check_output(
        ['node', '--input-type=module', '-e', code], cwd=ROOT,
        input=json.dumps(value).encode(),
    ))


for cycle, deleted in enumerate(('凡', '是')):
    raw = source.read_bytes()
    _, candidates = models(raw, 12)
    m = next(m for m in candidates if '健补充康' in m['text'])
    assert deleted in m['text']
    new = m['text'].replace(deleted, '', 1)
    m = js("""
import {editStyles,editSoftBreaks} from './src/flow-style.mjs';
let input='';for await(const c of process.stdin)input+=c;
const {m,text}=JSON.parse(input);
m.runs=editStyles(m.runs||[],m.text,text,m);
m.softBreaks=editSoftBreaks(m.softBreaks||[],m.text,text);m.text=text;
console.log(JSON.stringify(m));
""", dict(m=m, text=new))
    keys = {s.get(k) for s in [m] + m.get('runs', []) for k in ('fontKey', 'latinFontKey', 'cjkFontKey')}
    keys.add('builtin-latin')
    fonts = {k: {n: v for n, v in font_data(k).items() if n != 'base64'} for k in keys if k}
    m = js("""
import {fastLayout} from './src/fast-layout.mjs';
let input='';for await(const c of process.stdin)input+=c;
const {m,fonts}=JSON.parse(input);
m.fastLayout=fastLayout(m,(c,s)=>{
  const cp=c.codePointAt(0),key=(cp<0x300?s.latinFontKey:s.cjkFontKey)||s.fontKey;
  let f=fonts[key];
  if(!f.coverage.includes(cp)) f=Object.values(fonts).find(f=>f.coverage.includes(cp));
  if(!f)throw Error('Unavailable glyph '+cp);
  return {width:f.advances[cp]*s.size,fontKey:f.key,fontBold:f.fontBold,fontItalic:f.fontItalic};
});
console.log(JSON.stringify(m));
""", dict(m=m, fonts=fonts))
    result = render(m)
    assert result['mappingComplete'] and not result['overflow']
    native = save(raw, m, 12, result)
    assert_tag_structure_preserved(raw, native)
    native_path = OUT / f'bookmark-reopen-{cycle}-native.pdf'
    final_path = OUT / f'bookmark-reopen-{cycle}-saved.pdf'
    native_path.write_bytes(native)
    info = js("""
import fs from 'node:fs';import assert from 'node:assert/strict';
import {PdfEngine} from './src/pdf-core.mjs';
let input='';for await(const c of process.stdin)input+=c;
const paths=JSON.parse(input),engine=new PdfEngine();
const before=await engine.open(fs.readFileSync(paths.source));
const saved=await engine.save({nodes:before.nodes,contentBytes:fs.readFileSync(paths.native)});
fs.writeFileSync(paths.saved,saved);
const reopened=new PdfEngine(),after=await reopened.open(saved);
const identities=r=>r.nodes.map(({title,target,color,bold,italic})=>({title,target,color,bold,italic}));
assert.deepEqual(identities(after),identities(before));
assert.equal(after.pageCount,131);assert.equal(after.nodes.length,3);
assert(after.nodes.every(n=>n.raw.includes('/SE')));
console.log(JSON.stringify({pages:after.pageCount,bookmarks:after.nodes.length}));
""", dict(source=str(source), native=str(native_path), saved=str(final_path)))
    final = final_path.read_bytes()
    assert_tag_structure_preserved(native, final)
    with fitz.open(stream=raw, filetype='pdf') as before, fitz.open(stream=native, filetype='pdf') as content, fitz.open(stream=final, filetype='pdf') as after:
        compact = lambda text: ''.join(text.split())
        expected = Counter(compact(before[11].get_text()))
        expected.subtract(deleted)
        assert Counter(compact(after[11].get_text())) == +expected
        for page in (10, 11, 12):
            assert content[page].get_pixmap().samples == after[page].get_pixmap().samples
        for page in (10, 12):
            assert before[page].get_pixmap().samples == after[page].get_pixmap().samples
    with pdfium.PdfDocument(native) as content, pdfium.PdfDocument(final) as after:
        for page in (10, 11, 12):
            assert content[page].render().to_pil().tobytes() == after[page].render().to_pil().tobytes()
    checks.append(f'Cycle {cycle + 1}: fresh reopen, fast keyboard-equivalent deletion, native apply and new engine save; 131 pages, 3 exact bookmark identities, structure graph and dual-engine pixels preserved')
    source = final_path

assert hashlib.sha256(args.source.read_bytes()).hexdigest() == source_hash
report = dict(checks=checks, errors=[], sourceSha256=source_hash)
(OUT / 'bookmark-reopen-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(report, ensure_ascii=False))

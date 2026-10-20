"""Consecutive Word-style MCIDs keep their ParentTree through save/reopen."""
from pathlib import Path
import base64, copy, io, json, logging, subprocess, sys
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'tests'), str(ROOT / 'native'), str(ROOT / 'native/vendor')]
sys.stdout.reconfigure(encoding='utf-8')
logging.getLogger('pypdf').setLevel(logging.ERROR)
from p8_helpers import models, save, pixels, dump, OUT
from structure_checks_v191 import assert_tag_structure_preserved
from content import map_objects
from form_compat import reopen
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject as D, NameObject as N, ArrayObject as A, NumberObject as I, TextStringObject as T, ContentStream
import fitz, pypdfium2 as pdfium


def fixture(split_owner=False, nested=False, link=False, partial=False, actual_text=False):
    d = fitz.open()
    p = d.new_page(width=420, height=260)
    p.insert_font(fontname='F', fontfile=str(ROOT / 'native/fonts/DejaVuSans.ttf'))
    p.insert_text((30, 60), 'First run ', fontsize=12, fontname='F')
    p.insert_text((90, 60), 'with separate tags', fontsize=12, fontname='F')
    p.insert_text((30, 80), 'continues on the next line.', fontsize=12, fontname='F')
    d.new_page(width=420, height=260).insert_text((30, 60), 'Untouched adjacent page')
    w = PdfWriter()
    w.clone_document_from_reader(PdfReader(io.BytesIO(d.tobytes())))
    pg = w.pages[0]
    st = ContentStream(pg.get('/Contents'), w)
    ops = []
    mcid = 0
    for args, op in st.operations:
        if op == b'BT' and (not partial or mcid == 0):
            properties = D({N('/MCID'): I(0 if partial else mcid)})
            if actual_text and mcid == 1:
                properties[N('/ActualText')] = T('Original semantic alternative')
            ops.append(([N('/P'), properties], b'BDC'))
        ops.append((args, op))
        if op == b'ET':
            if not partial or mcid == 2:
                ops.append(([], b'EMC'))
            mcid += 1
    if nested:
        ops = [([N('/P'), D({N('/MCID'): I(3)})], b'BDC')] + ops + [([], b'EMC')]
    st.operations = ops
    pg[N('/Contents')] = w._add_object(st)
    pg[N('/StructParents')] = I(0)
    root = D({N('/Type'): N('/StructTreeRoot')})
    rootref = w._add_object(root)
    block = D({N('/Type'): N('/StructElem'), N('/S'): N('/P'), N('/P'): rootref, N('/Pg'): pg.indirect_reference})
    blockref = w._add_object(block)
    inline = D({N('/Type'): N('/StructElem'), N('/S'): N('/Link' if link else '/Span'), N('/P'): blockref, N('/Pg'): pg.indirect_reference, N('/K'): I(1)})
    inlineref = w._add_object(inline)
    block[N('/K')] = A([I(0), inlineref, I(2)])
    parentrefs = [blockref, inlineref, blockref]
    blocks = [blockref]
    if split_owner:
        other = D({N('/Type'): N('/StructElem'), N('/S'): N('/P'), N('/P'): rootref, N('/Pg'): pg.indirect_reference, N('/K'): I(2)})
        parentrefs[2] = w._add_object(other)
        blocks.append(parentrefs[2])
        block[N('/K')] = A([I(0), inlineref])
    if nested:
        parentrefs.append(blockref)
    root[N('/K')] = A(blocks)
    root[N('/ParentTree')] = w._add_object(D({N('/Nums'): A([I(0), A(parentrefs)])}))
    root[N('/ParentTreeNextKey')] = I(1)
    w._root_object[N('/StructTreeRoot')] = rootref
    w._root_object[N('/MarkInfo')] = D({N('/Marked'): I(1)})
    return dump(w)


def edit(model, text):
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
        "import{editStyles,editSoftBreaks}from'./src/flow-style.mjs';let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s),m=v.model;m.runs=editStyles(m.runs||[],m.text,v.text,m);m.softBreaks=editSoftBreaks(m.softBreaks||[],m.text,v.text);m.text=v.text;console.log(JSON.stringify(m));"],
        input=json.dumps({'model': model, 'text': text}).encode(), cwd=ROOT))


def tags(raw):
    reader = PdfReader(io.BytesIO(raw))
    root = reader.trailer['/Root']['/StructTreeRoot']
    parents = root['/ParentTree']['/Nums'][1]
    def shape(value):
        value = value.get_object() if hasattr(value, 'get_object') else value
        if isinstance(value, list):
            return [shape(v) for v in value]
        if isinstance(value, dict):
            return {key: shape(value[key]) for key in ('/S', '/K') if key in value}
        return value
    return [shape(v) for v in parents], shape(root['/K'])


raw = fixture()
original_tags = tags(raw)
current = raw
checks = []
out = OUT / 'deep-edit-v191-paragraphs'
out.mkdir(exist_ok=True)
for cycle in range(2):
    _, candidates = models(current)
    m = max(candidates, key=lambda m: len(m['text']))
    changed_text = m['text'].replace('First', 'Final') if cycle == 0 else m['text'].replace('separate', 'separate edited')
    assert changed_text != m['text']
    m = edit(m, changed_text)
    m['frame']['width'] = 330
    m['frame']['height'] = 120
    current = save(current, m)
    assert tags(current) == original_tags, 'ParentTree/semantic hierarchy changed'
    assert_tag_structure_preserved(raw, current)
    expanded = reopen(current, [1])
    stream, mapped = map_objects(PdfReader(io.BytesIO(expanded)).pages[0])
    ids = [int(args[1]['/MCID']) for args, op in stream.operations if op == b'BDC' and isinstance(args[1], dict) and '/MCID' in args[1]]
    assert sorted(ids) == [0, 1, 2], ids
    inspection, again = models(current)
    (OUT / 'deep-edit-v191-paragraphs' / f'tagged-cycle-{cycle}.pdf').write_bytes(current)
    if not any(c['text'] == changed_text for c in again):
        print('BEFORE', m['text'])
        print('AFTER', [(o.get('text'), o.get('reason'), o.get('flowEditable')) for o in inspection['objects'] if o['type'] == 'text'])
    assert any(c['text'] == changed_text for c in again), [c['text'] for c in again]
    assert pixels(current, 1) == pixels(raw, 1)
    with pdfium.PdfDocument(raw) as a, pdfium.PdfDocument(current) as b:
        assert a[1].render(scale=1.5).to_pil().tobytes() == b[1].render(scale=1.5).to_pil().tobytes()
    checks.append(f'cycle {cycle + 1}: exact edited text, one instance per MCID, same ParentTree and adjacent pixels in two engines')

for options in ({'split_owner': True}, {'nested': True}, {'link': True}, {'actual_text': True}, {'partial': True}):
    source = fixture(**options)
    _, candidates = models(source)
    m = edit(max(candidates, key=lambda m: len(m['text'])), 'Changed complete paragraph with separate tags')
    if options.get('partial'):
        m['sources'] = m['sources'][:1]
    m['frame']['width'] = 330
    m['frame']['height'] = 120
    try:
        save(source, m)
        raise AssertionError(f'unsafe tags accepted: {options}')
    except ValueError as error:
        assert 'MCID' in str(error) or '标签' in str(error) or '语义' in str(error), str(error)
checks.append('cross-block, nested MCID, link, ActualText and partial MCID scopes remain protected')
(out / 'tagged-edit-report.json').write_text(json.dumps({'checks': checks, 'errors': []}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'checks': checks, 'errors': []}, ensure_ascii=False))

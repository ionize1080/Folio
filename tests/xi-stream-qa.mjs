import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [candidateRoot, legacyRoot, outputRoot] = process.argv.slice(2);
if (!candidateRoot || !legacyRoot || !outputRoot) {
  throw Error('Usage: node xi-fixture-qa.mjs <candidate checkout> <legacy checkout> <output>');
}
const out = path.resolve(outputRoot);
await fs.mkdir(out, {recursive: true});
const markers = ['Folio XI compatibility page ONE', 'Folio XI compatibility page TWO'];
const hash = data => createHash('sha256').update(data).digest('hex');

async function checkout(root) {
  const part = name => import(pathToFileURL(path.resolve(root, 'src', name)).href);
  const [{PdfEngine}, {makeNode}, {PDFDocument}] = await Promise.all([
    part('pdf-core.mjs'), part('model.mjs'), part('vendor/pdf-lib.js'),
  ]);
  return {PdfEngine, makeNode, PDFDocument};
}

function classicOriginal() {
  const textStream = label => {
    const contents = 'BT /F1 24 Tf 48 720 Td (' + label + ') Tj ET\n';
    return '<< /Length ' + contents.length + ' >>\nstream\n' + contents + 'endstream';
  };
  const page = content => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Resources << /Font << /F1 7 0 R >> >> /Contents ' + content + ' 0 R >>';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>',
    page(5), page(6), textStream(markers[0]), textStream(markers[1]),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const [i, value] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += (i + 1) + ' 0 obj\n' + value + '\nendobj\n';
  }
  const start = pdf.length;
  pdf += 'xref\n0 8\n0000000000 65535 f \n';
  for (const offset of offsets) pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  return Buffer.from(pdf + 'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n', 'ascii');
}


const seed = path.join(out, 'seed.tmp');
const originalFile = path.join(out, 'stream-original.pdf');
await fs.writeFile(seed, classicOriginal());
const py = process.env.FOLIO_QA_PYTHON || 'python';
function python(program, ...args) {
  const run = spawnSync(py, ['-c', program, ...args], {encoding:'utf8',windowsHide:true});
  assert.equal(run.status, 0, run.error?.message || run.stderr);
  return run.stdout.trim();
}
python([
  'import pikepdf, sys',
  'with pikepdf.open(sys.argv[1]) as doc:',
  '    doc.docinfo.Subject = "Original stream subject"',
  '    doc.save(sys.argv[2], object_stream_mode=pikepdf.ObjectStreamMode.generate, min_version="1.5")',
].join('\n'), seed, originalFile);
await fs.unlink(seed);
const original = await fs.readFile(originalFile);
assert.match(original.toString('latin1'), /\/Type\s*\/ObjStm\b/);

function section(bytes) {
  const end = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(bytes.subarray(-512).toString('latin1'));
  assert.ok(end);
  const offset = Number(end[1]);
  const text = bytes.subarray(offset).toString('latin1');
  const table = /^xref\s/.test(text);
  const dictionary = table ? text.slice(text.indexOf('trailer'), text.indexOf('startxref')) : text.slice(0, text.indexOf('stream'));
  if (!table) assert.match(dictionary, /^\d+\s+\d+\s+obj\b[\s\S]*\/Type\s*\/XRef\b/);
  const prev = /\/Prev\s+(\d+)\b/.exec(dictionary);
  return {offset, prev:prev ? Number(prev[1]) : null, kind:table ? 'table' : 'stream'};
}

const get = async (root) => {
  const impl = await checkout(root);
  return {impl, root};
};
const fixed = await get(candidateRoot), old = await get(legacyRoot);
const cases = [];
async function inspect(id, bytes, parent, expected, engineRoot, bookmark, subject, legacyControl=false) {
  const file = id + '.pdf';
  await fs.writeFile(path.join(out, file), bytes);
  const refs = section(bytes);
  assert.equal(refs.kind, expected.kind);
  assert.equal(refs.prev, expected.prev);
  if (parent) {
    assert.ok(bytes.length > parent.length && bytes.subarray(0,parent.length).equals(parent));
    assert.ok(refs.offset >= parent.length);
  }
  const independent = JSON.parse(python([
    'import pikepdf, sys, json',
    'with pikepdf.open(sys.argv[1], attempt_recovery=False) as doc:',
    '    assert len(doc.pages) == 2',
    '    titles = [entry.title for entry in doc.open_outline().root]',
    '    print(json.dumps({"ids":[bytes(i).hex() for i in doc.trailer.ID], "bookmarks":titles,',
    '      "subject":str(doc.docinfo.Subject), "syntax":doc.check_pdf_syntax()}))',
  ].join('\n'), path.join(out,file)));
  assert.deepEqual(independent.bookmarks, bookmark ? [bookmark] : []);
  assert.equal(independent.subject, subject);
  assert.deepEqual(independent.syntax, []);
  if (cases.length) assert.equal(independent.ids[0], cases[0].ids[0]);
  if (parent && !legacyControl) {
    const previous=cases.find(c=>c.sha256===hash(parent));
    assert.ok(previous);
    assert.notEqual(independent.ids[1], previous.ids[1]);
  }
  const commit = spawnSync('git',['-C',engineRoot,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true});
  cases.push({file, legacyControl, sha256:hash(bytes), bytes:bytes.length, sourcePrefixBytes:parent?.length??0,
    precedingSha256:parent ? hash(parent) : null, expectedMarkers:markers, ...refs, ...independent,
    writer:parent ? (commit.status===0 ? commit.stdout.trim() : path.basename(engineRoot)) : 'pikepdf'});
}

async function append(writer, before, id, expected, previousTitle, subject, metadata=false, legacyControl=false) {
  const engine = new writer.impl.PdfEngine();
  const state = await engine.open(new Uint8Array(before));
  assert.deepEqual(state.nodes.map(n=>n.title),previousTitle?[previousTitle]:[]);
  const title = 'QA bookmark ' + id;
  const save = await engine.save({nodes:[writer.impl.makeNode(title,1)],incrementalResult:true,
    ...(metadata ? {metadata:{subject}} : {})});
  assert.equal(save.mode,'incremental');
  const next = Buffer.from(engine.pendingSave.bytes);
  await engine.commitSave({sha256:hash(next)});
  await inspect(id,next,before,expected,writer.root,title,subject,legacyControl);
  return {bytes:next,title,xref:section(next).offset};
}
const start = section(original).offset;
const normal = 'Original stream subject', previous = 'Unique subject from the second legacy update';
await inspect('stream-original',original,null,{kind:'stream',prev:null},fixed.root,null,normal);
const one = await append(fixed,original,'stream-fixed-first',{kind:'stream',prev:start},null,normal);
await append(fixed,one.bytes,'stream-fixed-second',{kind:'stream',prev:one.xref},one.title,normal);
const legacy1 = await append(old,original,'stream-legacy-first',{kind:'table',prev:start},null,'First legacy update',true,true);
const legacy2 = await append(old,legacy1.bytes,'stream-legacy-second',{kind:'table',prev:legacy1.xref},legacy1.title,previous,true,true);
const bridge = await append(fixed,legacy2.bytes,'stream-migrated-first',{kind:'stream',prev:start},legacy2.title,previous);
await append(fixed,bridge.bytes,'stream-migrated-second',{kind:'stream',prev:bridge.xref},bridge.title,previous);
await fs.writeFile(path.join(out,'stream-manifest.json'),JSON.stringify({schema:1,cases},null,2)+'\n');
console.log(JSON.stringify(cases.map(({file,kind,offset,prev,bytes,subject,ids})=>({file,kind,offset,prev,bytes,subject,ids})),null,2));

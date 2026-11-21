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

function linearize(input, output) {
  const program = [
    'import pikepdf, sys',
    'with pikepdf.Pdf.open(sys.argv[1]) as pdf:',
    '    pdf.save(sys.argv[2], linearize=True, object_stream_mode=pikepdf.ObjectStreamMode.disable)',
  ].join('\n');
  const py = spawnSync(process.env.FOLIO_QA_PYTHON || 'python', ['-c', program, input, output],
    {encoding:'utf8', windowsHide:true});
  if (py.status === 0) return 'pikepdf';
  const qp = spawnSync('qpdf', ['--linearize', '--object-streams=disable', input, output],
    {encoding:'utf8', windowsHide:true});
  if (qp.status !== 0) throw Error('Linearization failed with pikepdf and qpdf. ' +
    [py.error?.message, py.stderr, qp.error?.message, qp.stderr].filter(Boolean).join('\n'));
  return 'qpdf';
}

function currentXref(bytes) {
  const last = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(bytes.subarray(-512).toString('latin1'));
  assert.ok(last, 'Missing terminal startxref');
  const at = Number(last[1]);
  assert.ok(Number.isSafeInteger(at) && at >= 0 && at < bytes.length);
  assert.match(bytes.subarray(at, at + 8).toString('latin1'), /^xref\b/, 'Expected a classic xref table');
  const tail = bytes.subarray(at).toString('latin1');
  const trailer = /^xref\s[\s\S]*?\btrailer\s*<<([\s\S]*?)>>/.exec(tail);
  assert.ok(trailer, 'Missing current trailer');
  const prev = /\/Prev\s+(\d+)\b/.exec(trailer[1]);
  return {startxref:at, previousXref:prev ? Number(prev[1]) : null};
}

async function infoStatus(PDFDocument, bytes) {
  const doc = await PDFDocument.load(new Uint8Array(bytes), {updateMetadata:false, throwOnInvalidObject:true});
  assert.equal(doc.getPageCount(), 2);
  const ref = doc.context.trailerInfo.Info;
  return {pages:2, infoObject:ref?.objectNumber ?? null, infoResolved:!!(ref && doc.context.lookup(ref))};
}

async function makeRevision(impl, engine, before, title, prevHash) {
  const result = await engine.save({nodes:[impl.makeNode(title, 1)], incrementalResult:true, baseHash:prevHash});
  assert.equal(result.mode, 'incremental', 'Must use the normal incremental PdfEngine save');
  const bytes = Buffer.from(engine.pendingSave.bytes);
  assert.ok(bytes.length > before.length);
  assert.ok(bytes.subarray(0, before.length).equals(before), 'Previous revision bytes changed');
  const xref = currentXref(bytes);
  assert.ok(xref.startxref >= before.length);
  assert.equal(xref.previousXref, currentXref(before).startxref, 'Wrong /Prev link');
  await engine.commitSave({sha256:hash(bytes)});
  return bytes;
}

const candidate = await checkout(candidateRoot), legacy = await checkout(legacyRoot);
const classic = classicOriginal();
const classicFile = path.join(out, 'classic-original.pdf');
const linFile = path.join(out, 'linearized-original.pdf');
await fs.writeFile(classicFile, classic);
const linearizer = linearize(classicFile, linFile);
const linearized = await fs.readFile(linFile);
assert.match(linearized.subarray(0, 512).toString('latin1'), /\/Linearized\s+1\b/);

const cases = [];
for (const [kind, original] of [['classic', classic], ['linearized', linearized]]) {
  const originalInfo = await infoStatus(candidate.PDFDocument, original);
  assert.equal(originalInfo.infoObject, null, 'Fixture must start without /Info');
  const legacyEngine = new legacy.PdfEngine(), newEngine = new candidate.PdfEngine();
  await legacyEngine.open(new Uint8Array(original));
  await newEngine.open(new Uint8Array(original));
  const title1 = 'Folio XI revision ONE', title2 = 'Folio XI revision TWO';
  const old = await makeRevision(legacy, legacyEngine, original, title1, null);
  const first = await makeRevision(candidate, newEngine, original, title1, null);
  const second = await makeRevision(candidate, newEngine, first, title2, hash(first));

  const variants = [
    ['original',original,null,null], ['old-incremental',old,title1,original],
    ['new-incremental-1',first,title1,original], ['new-incremental-2',second,title2,first],
  ];
  for (const [variant, bytes, bookmark, base] of variants) {
    const id = kind + '-' + variant, file = id + '.pdf';
    await fs.writeFile(path.join(out, file), bytes);
    const info = await infoStatus(candidate.PDFDocument, bytes);
    const xref = currentXref(bytes);
    if (base) {
      assert.ok(info.infoObject !== null, id + ' must have /Info in its trailer');
      assert.equal(info.infoResolved, variant !== 'old-incremental', id + ' unexpected /Info resolution');
      if (variant === 'new-incremental-1') {
        const body = new RegExp('(?:^|[\\r\\n])' + info.infoObject + '\\s+0\\s+obj\\b');
        assert.match(bytes.subarray(original.length).toString('latin1'), body, 'Info must be written in first delta');
      }
      const reopened = new candidate.PdfEngine();
      const parsed = await reopened.open(new Uint8Array(bytes));
      assert.equal(parsed.nodes[0]?.title, bookmark);
    }
    cases.push({id,kind,variant,file,expectedMarkers:markers,expectedBookmark:bookmark,
      ...info,...xref,sourcePrefixBytes:base?.length ?? null,sha256:hash(bytes),bytes:bytes.length});
  }
  assert.equal(currentXref(second).previousXref, currentXref(first).startxref);
  assert.equal(currentXref(first).previousXref, currentXref(original).startxref);
}
const manifest = {schema:1, linearizer, cases};
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest,null,2) + '\n');
console.log(JSON.stringify({files:cases.length,output:out,linearizer}));

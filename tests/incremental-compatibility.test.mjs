import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from '../src/vendor/pdf-lib.js';
import {PdfEngine} from '../src/pdf-core.mjs';
import {makeNode} from '../src/model.mjs';
import {previousXref, reserveOriginalRefs} from '../src/incremental-pdf.mjs';

const binary = bytes => Buffer.from(bytes).toString('latin1');
function lastOffset(bytes) {
  const match = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(binary(bytes.subarray(-256)));
  assert.ok(match);
  return Number(match[1]);
}

// This classic PDF has a real two-node free list and a binary literal ID.
// /Size also appears in private trailer data before the actual numeric key.
function classicFixture() {
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const body of [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources <<>> >>',
  ]) {
    const number = offsets.length;
    offsets.push(text.length);
    text += `${number} 0 obj\n${body}\nendobj\n`;
  }
  const xref = text.length;
  text += 'xref\r\n0 5\r\n0000000004 65535 f\r\n';
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10,'0')} 00000 n\r\n`;
  text += '0000000000 00001 f\r\ntrailer\n';
  text += '<< /PrivateInfo (text /Size 99) /Size 5 /Root 1 0 R /ID [(\x80\xffA)(R)] >>\n';
  return Buffer.from(text + `startxref\n${xref}\n%%EOF\n`, 'latin1');
}

test('classic revisions preserve binary permanent ID, private trailer fields and the inherited free list', async () => {
  const original = classicFixture();
  const engine = new PdfEngine();
  await engine.open(original);
  assert.ok(engine.doc.context.largestObjectNumber < 99);
  let bytes = original;
  let previousID = Buffer.from('R');
  for (let i = 0; i < 2; i++) {
    const hash = i ? 'first' : null;
    const result = await engine.save({nodes:[makeNode('Change ' + i, 1)], baseHash:hash, incrementalResult:true});
    assert.equal(result.mode, 'incremental');
    const next = engine.pendingSave.bytes;
    assert.deepEqual(Buffer.from(next.subarray(0, bytes.length)), Buffer.from(bytes));
    const section = binary(next.subarray(lastOffset(next)));
    assert.match(section, /^xref\r?\n/);
    assert.doesNotMatch(section, /^0 1$/m);
    assert.match(section, /\/PrivateInfo \(text \/Size 99\)/);
    assert.match(section, new RegExp('/Prev ' + lastOffset(bytes) + '\\b'));
    const parsed = await PDFDocument.load(next, {updateMetadata:false});
    assert.ok(parsed.context.lookup(parsed.context.trailerInfo.Info), 'an Info dictionary created on open must also be written');
    const ids = parsed.context.trailerInfo.ID;
    assert.deepEqual(Buffer.from(ids.get(0).asBytes()), Buffer.from([0x80,0xff,0x41]));
    const revisionID = Buffer.from(ids.get(1).asBytes());
    assert.notDeepEqual(revisionID, previousID);
    previousID = revisionID;
    bytes = next;
    engine.commitSave({sha256:i ? 'second' : 'first'});
  }
});

test('xref stream updates retain the stream chain and reserve their own numbers across reopen and native snapshots', async () => {
  const source = await PDFDocument.create();
  source.addPage([400,500]);
  let bytes = await source.save({useObjectStreams:true});
  const original = bytes;
  const engine = new PdfEngine();
  await engine.open(bytes);
  const streamNumbers = [];
  for (let i = 0; i < 3; i++) {
    const changed = i === 1 ? await PDFDocument.load(original, {updateMetadata:false}) : null;
    if (changed) changed.getPage(0).setWidth(401);
    const snapshot = changed ? await changed.save({useObjectStreams:false}) : null;
    const nodes = [makeNode('Revision ' + i, 1)];
    const result = await engine.save({nodes, contentBytes:snapshot, contentRevision:changed?'native':null, incrementalResult:true});
    assert.equal(result.mode, 'incremental');
    const next = engine.pendingSave.bytes;
    assert.deepEqual(Buffer.from(next.subarray(0, bytes.length)), Buffer.from(bytes));
    const at = lastOffset(next);
    const text = binary(next.subarray(at, at + 1024));
    const header = /^(\d+) 0 obj\s*<</.exec(text);
    assert.ok(header, 'latest startxref should identify a stream object');
    const ref = Number(header[1]);
    assert.ok(!streamNumbers.includes(ref), 'the xref stream must get a new object number');
    streamNumbers.push(ref);
    assert.match(text, /\/Type \/XRef\b/);
    assert.match(text, new RegExp('/Prev ' + lastOffset(bytes) + '\\b'));
    assert.match(text, new RegExp('/Size ' + (ref+1) + '\\b'));
    const reopened = new PdfEngine();
    const info = await reopened.open(next);
    assert.equal(info.nodes[0].title, nodes[0].title);
    assert.equal(reopened.pages[0].getWidth(), changed ? 401 : 400);
    bytes = next;
    engine.commitSave({sha256:'revision-' + i});
  }
});

test('startxref to an ordinary dictionary does not establish a safe append base', async () => {
  const original = classicFixture();
  const text = binary(original);
  const wrong = Buffer.from(text.replace(/startxref\s+\d+/, 'startxref\n' + text.indexOf('1 0 obj')), 'latin1');
  const parsed = await PDFDocument.load(original);
  assert.equal(previousXref(wrong), null);
  assert.equal(reserveOriginalRefs(parsed, wrong), false);
});

test('saving an older Folio mixed-chain file bridges its latest object versions to the original stream', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([400,500]);
  const original = Buffer.from(await source.save());
  const pageRef = page.ref.objectNumber;
  let bytes = original;
  let lastPageOffset;
  for (const width of [401, 402]) {
    page.setWidth(width);
    const obj = Buffer.from(`\n${pageRef} 0 obj\n${page.node}\nendobj\n`, 'latin1');
    lastPageOffset = bytes.length + 1;
    const prev = lastOffset(bytes);
    const xref = bytes.length + obj.length;
    const originalSection = binary(original.subarray(lastOffset(original)));
    const size = Number(/\/Size (\d+)/.exec(originalSection)[1]);
    const trailer = `trailer\n<< /Size ${size} /Prev ${prev} /Root ${source.context.trailerInfo.Root} >>\n`;
    const table = 'xref\n0 1\n0000000000 65535 f \n' +
      `${pageRef} 1\n${String(lastPageOffset).padStart(10,'0')} 00000 n \n`;
    bytes = Buffer.concat([bytes,obj,Buffer.from(table + trailer + `startxref\n${xref}\n%%EOF\n`)]);
  }
  const engine = new PdfEngine();
  await engine.open(bytes);
  const saved = await engine.save({nodes:[makeNode('Recovered',1)],incrementalResult:true});
  assert.equal(saved.mode,'incremental');
  const next = engine.pendingSave.bytes;
  assert.deepEqual(Buffer.from(next.subarray(0,bytes.length)),bytes);
  const section = binary(next.subarray(lastOffset(next)));
  assert.match(section, /\/Type \/XRef\b/);
  assert.match(section, new RegExp('/Prev ' + lastOffset(original) + '\\b'));
  const fieldWidths = /\/W \[ (\d+) (\d+) (\d+) \]/.exec(section).slice(1).map(Number);
  const index = /\/Index \[ ([\d ]+) \]/.exec(section)[1].trim().split(/\s+/).map(Number);
  const dataStart = lastOffset(next) + section.indexOf('stream\n') + 7;
  const view = Buffer.from(next.buffer, next.byteOffset, next.length);
  let offset = dataStart;
  let entry;
  for (let i = 0; i < index.length; i += 2) {
    for (let j = 0; j < index[i+1]; j++) {
      if (index[i] + j === pageRef) entry = view.readUIntBE(offset + fieldWidths[0], fieldWidths[1]);
      offset += fieldWidths.reduce((sum, value) => sum + value,0);
    }
  }
  assert.equal(entry,lastPageOffset);
});

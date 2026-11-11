import fs from 'node:fs/promises';import assert from 'node:assert/strict';import path from 'node:path';
import {appendSnapshot} from '../src/incremental-pdf.mjs';import {PdfEngine} from '../src/pdf-core.mjs';
const matrix=JSON.parse(await fs.readFile('tests/output/incremental-corpus-270/matrix.json','utf8'));
for(const row of matrix){
  const original=new Uint8Array(await fs.readFile(row.source));let previous=original;
  for(const item of row.cases){
    const snapshot=new Uint8Array(await fs.readFile(item.snapshot)),saved=await appendSnapshot(previous,snapshot);
    assert.deepEqual(saved.subarray(0,previous.length),previous,'Previous revisions must remain byte-identical');
    const file=path.join(path.dirname(item.snapshot),item.name+'-incremental.pdf');await fs.writeFile(file,saved);previous=saved;
  }
  // The real save worker, not only the graph importer: changed native content,
  // unchanged content with a later bookmark edit, then undo to original content.
  const engine=new PdfEngine(),info=await engine.open(original),snapshot=new Uint8Array(await fs.readFile(row.cases[0].snapshot));
  let saved=await engine.save({nodes:info.nodes,contentBytes:snapshot,contentRevision:'edited',incrementalResult:true});engine.commitSave({sha256:'one'});
  let next=await engine.save({nodes:info.nodes,contentBytes:snapshot,contentRevision:'edited',incrementalResult:true,baseHash:'one'});assert(next.append);assert(next.bytes.length<2000);engine.commitSave({sha256:'two'});
  const undone=await engine.save({nodes:info.nodes,incrementalResult:true,baseHash:'two'});assert(undone.append);
  const read=new PdfEngine();await read.open(engine.pendingSave.bytes);assert.equal(read.pages.length,info.pageCount);
  console.log('PASS append and worker content revisions',row.id,row.cases.length);
}

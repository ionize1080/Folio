import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {PDFDocument} from '../src/vendor/pdf-lib.js';import {PdfEngine} from '../src/pdf-core.mjs';import {makeNode} from '../src/model.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),d=await PDFDocument.create();d.addPage();
let bytes=await d.save({useObjectStreams:false}),hash=sha(bytes);const e=new PdfEngine();await e.open(bytes);
const nodes=Array.from({length:10000},(_,i)=>makeNode('Chapter '+i,1)),results=[];
for(const action of ['create-10000','rename-one','undo-rename']){
 nodes[500].title=action==='rename-one'?'Changed chapter':'Chapter 500';const progress=[],start=performance.now();
 const saved=await e.save({nodes,incrementalResult:true,baseHash:hash},p=>progress.push(p));const serializeMs=performance.now()-start;
 assert(saved.append);bytes=Buffer.concat([bytes,saved.bytes]);hash=sha(bytes);e.commitSave({sha256:hash});
 const read=await new PdfEngine().open(bytes);assert.deepEqual(read.nodes.map(n=>n.title),nodes.map(n=>n.title));
 if(action!=='create-10000'){assert.equal(saved.objects,1);assert(saved.bytes.length<2048);}
 assert.equal(progress.at(-1).completed,progress.at(-1).total);
 results.push({action,serializeMs,writeBytes:saved.bytes.length,totalBytes:bytes.length,changedObjects:saved.objects,progressUpdates:progress.length});
}
await fs.writeFile('tests/output/save-performance-281.json',JSON.stringify({status:'passed',bookmarks:nodes.length,checks:['10,000 bookmarks reopen intact','One rename and undo each append one object','Progress finishes after the time-budgeted serialization'],results},null,2));console.log('PASS',results);

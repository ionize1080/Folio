import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {createRequire} from 'node:module';
import {PDFDocument,PDFName,PDFString} from '../src/vendor/pdf-lib.js';import {PdfEngine} from '../src/pdf-core.mjs';import {makeNode} from '../src/model.mjs';
import {auditBookmarks,repairBookmarks,deleteBookmarks,sortBookmarks,everyNBookmarks} from '../src/bookmark-qc.mjs';import {renderMarkdown} from '../src/safe-markdown.mjs';
const require=createRequire(import.meta.url),{FileStore}=require('../file-store.cjs'),{downloadAsset}=require('../update-download.cjs');
test('incremental saves preserve prefix and undo state, reject conflicts, reopen independently',async()=>{
  const d=await PDFDocument.create();d.addPage([400,500]);d.addPage([400,500]);
  // A large untouched stream must remain byte-for-byte, not be recompressed.
  const ref=d.context.register(d.context.stream(new Uint8Array(8*1024**2).fill(42)));d.catalog.set(PDFName.of('FolioTestPayload'),ref);
  const bytes=await d.save({useObjectStreams:true}),e=new PdfEngine();await e.open(bytes);
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'folio-save-')),file=path.join(tmp,'result.pdf'),store=new FileStore(async()=>file);
  try{
    const nodes=[makeNode('Chapter 1',1)],annotations=[{type:'marker',page:1,rect:[10,10,100,90],color:'#F2C94C',width:12,opacity:.4,paths:[[20,30,40,55,80,40]]}];
    const input={nodes,annotations,rotations:{1:90},incrementalResult:true};const first=await e.save(input);
    assert.equal(first.mode,'incremental');assert(first.deltaBytes<10000);assert.deepEqual(first.bytes.subarray(0,bytes.length),bytes);
    let result=await store.save({name:'result.pdf',kind:'pdf',...first});e.commitSave(result);
    nodes[0].title='Renamed';const ticket=await store.prepare({name:'result.pdf',kind:'pdf',working:true,handle:result.handle});
    const second=await e.save({...input,annotations:[],rotations:{},baseHash:ticket.baseHash});assert(second.append);assert(second.bytes.length<10000);
    const original=await fs.readFile(file);result=await store.save({name:'result.pdf',kind:'pdf',ticket,...second});e.commitSave(result);
    const output=await fs.readFile(file);assert.deepEqual(output.subarray(0,original.length),original);
    const reopened=new PdfEngine(),info=await reopened.open(output);assert.equal(info.nodes[0].title,'Renamed');assert.equal(info.pages[0].rotation,0);assert.equal(reopened.pages[0].node.lookup(PDFName.of('Annots')).size(),0);
    assert.equal(e.pages[0].getRotation().angle,0,'source graph stays immutable');
    const conflict=await store.prepare({name:'result.pdf',kind:'pdf',working:true,handle:result.handle});await fs.appendFile(file,'external');
    await assert.rejects(store.save({name:'result.pdf',kind:'pdf',ticket:conflict,...second}),/其他程序|版本/);
    await fs.mkdir('tests/output',{recursive:true});await fs.writeFile('tests/output/incremental-270.pdf',output);await fs.writeFile('tests/output/annotations-270.pdf',first.bytes);
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test('QC, deterministic repair, child-preserving deletion, natural sibling sort and interval templates',()=>{
  const a=makeNode(' Chapter 10 ',2),b=makeNode('Chapter 2',1),child=makeNode('Child',2,a.id),duplicate=makeNode('Chapter 2',9),orphan=makeNode('',1,'missing');
  const nodes=[a,child,b,duplicate,orphan],audit=auditBookmarks(nodes,2);
  for(const code of ['duplicate','page','orphan','empty','space'])assert(audit.issues.some(x=>x.code===code));
  const repaired=repairBookmarks(nodes,new Set([a.id,orphan.id]),2);assert.equal(repaired[0].title,'Chapter 10');assert.equal(repaired.at(-1).parent,null);
  assert.equal(deleteBookmarks(nodes,new Set([a.id]))[0].parent,null);assert(!deleteBookmarks(nodes,new Set([a.id]),true).some(n=>n.id===child.id));
  const sorted=sortBookmarks([a,child,b],{by:'title'});assert.deepEqual(sorted.map(n=>n.id),[b.id,a.id,child.id]);
  const generated=everyNBookmarks({pageCount:20,range:'2-12',interval:2,parity:'even',template:'{index}: {page}',pad:3});assert.deepEqual(generated.map(n=>n.title),['001: 2','002: 6','003: 10']);
});
test('all annotation appearances survive incremental reopen and compact-save undo restores indirect actions',async()=>{
  const d=await PDFDocument.create();d.addPage([400,500]);const initial=await d.save(),engine=new PdfEngine();await engine.open(initial);
  const types=['highlight','underline','squiggly','strikeout','rectangle','ink','marker','note'];
  const annotations=types.map((type,i)=>({type,page:1,rect:[20,20+i*45,160,50+i*45],color:'#7DB8DA',opacity:.5,width:2,...(['ink','marker'].includes(type)?{paths:[[25,25+i*45,60,40+i*45,130,30+i*45]]}:{})}));
  const result=await engine.save({nodes:[],annotations,incrementalResult:true});await fs.writeFile('tests/output/all-annotations-270.pdf',result.bytes);
  const parsed=await PDFDocument.load(result.bytes);assert.equal(parsed.getPage(0).node.lookup(PDFName.of('Annots')).size(),types.length);
  const ctx=d.context,action=ctx.register(ctx.obj({S:'URI',URI:PDFString.of('https://example.com')})),node=ctx.obj({Title:PDFString.of('External'),A:action});
  const root=ctx.register(ctx.obj({Type:'Outlines'})),ref=ctx.register(node);node.set(PDFName.of('Parent'),root);ctx.lookup(root).set(PDFName.of('First'),ref);ctx.lookup(root).set(PDFName.of('Last'),ref);d.catalog.set(PDFName.of('Outlines'),root);
  const other=new PdfEngine(),info=await other.open(await d.save());const compact=await other.save({nodes:[],compact:true,incrementalResult:true});other.commitSave({sha256:'compact'});
  const restored=await other.save({nodes:info.nodes,incrementalResult:true,baseHash:'compact'});assert(restored.append);
  const reread=new PdfEngine(),restoredInfo=await reread.open(other.pendingSave.bytes);assert.equal(restoredInfo.nodes[0].title,'External');assert.equal(restoredInfo.nodes[0].target.actionType,'URI');
  assert((await new PdfEngine().open(compact.bytes)).nodes.length===0);
});
test('Markdown notes never create active raw HTML or unsafe links',()=>{
  const html=renderMarkdown('# Release\n- **Fast**\n<script>alert(1)</script>\n[evil](javascript:alert(1))\n[Docs](https://example.com)');
  assert(html.includes('<h2>Release</h2>'));assert(html.includes('<strong>Fast</strong>'));assert(!html.includes('<script>'));assert(!html.includes('href="javascript:'));assert(html.includes('rel="noopener noreferrer"'));
});
test('parallel ranges resume partial segments and reject mismatched content ranges and hashes',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'folio-range-')),file=path.join(tmp,'a.zip'),body=Buffer.from('0123456789abcdef'.repeat(1024)),hash=crypto.createHash('sha256').update(body).digest('hex');let calls=[],fail=true,active=0,peak=0;
  const fetch=async(_,o)=>{const m=/bytes=(\d+)-(\d+)/.exec(o.headers.Range),a=+m[1],b=+m[2];calls.push([a,b]);peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,2));active--;
    if(fail&&a===4096){fail=false;throw Error('disconnected');}
    return new Response(body.subarray(a,b+1),{status:206,headers:{'content-range':`bytes ${a}-${b}/${body.length}`}});
  };
  const opts={url:'https://example.com/a.zip',file,size:body.length,hash,fetch,blockSize:4096};
  try{await assert.rejects(downloadAsset(opts),/disconnected/);calls=[];await downloadAsset(opts);assert(peak>1);assert.deepEqual(await fs.readFile(file),body);assert(!calls.some(([a,b])=>a===0&&b===4095),'completed block is reused');
    await assert.rejects(downloadAsset({...opts,hash:'0'.repeat(64)}),/SHA-256/);
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

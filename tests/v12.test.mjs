import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {encodeProject,decodeProject,digest,encodeBase64} from '../src/project.mjs';
import {unzipStored,zipBlob} from '../src/zip-store.mjs';
import {History} from '../src/model.mjs';
import {DocumentSession,readSettings} from '../src/session-state.mjs';
const require=createRequire(import.meta.url),{SourceStore}=require('../source-store.cjs'),{FileStore}=require('../file-store.cjs');
const bytes=new TextEncoder().encode('%PDF-test-source');
const state=()=>({nodes:[],nativeEdits:[],ocr:[],annotations:[],rotation:{},metadata:{}});

test('same outline count cannot silently rebind a changed action',async()=>{
 const {PDFDocument,PDFName,PDFHexString}=await import('../src/vendor/pdf-lib.js');
 const {PdfEngine}=await import('../src/pdf-core.mjs');
 const doc=await PDFDocument.create();doc.addPage();const c=doc.context,N=PDFName.of;
 const outline=c.obj({Type:'Outlines'}),ref=c.register(outline),item=c.obj({Title:PDFHexString.fromText('same title'),Parent:ref,A:c.obj({S:'URI',URI:PDFHexString.fromText('https://example.com/a')})});
 const ir=c.register(item);outline.set(N('First'),ir);outline.set(N('Last'),ir);doc.catalog.set(N('Outlines'),ref);
 const e=new PdfEngine(),info=await e.open(await doc.save());
 item.lookup(N('A')).set(N('URI'),PDFHexString.fromText('https://example.com/b'));
 await assert.rejects(e.save({nodes:info.nodes,contentBytes:await doc.save()}),/来源发生变化/);
 item.lookup(N('A')).set(N('URI'),PDFHexString.fromText('https://example.com/a'));
 assert((await e.save({nodes:info.nodes,contentBytes:await doc.save()})).length>100);
});

test('native cancellation rejects current and already queued requests, then restarts',async()=>{
 const {NativeBridge}=require('../native-bridge.cjs'),bridge=new NativeBridge('/unused');
 let kills=0;bridge.start=()=>{bridge.process={stdin:{write(_text,callback){callback();}},kill(){kills++;}};};
 const a=bridge.request({command:'inspect',page:2});const ea=assert.rejects(a,/取消/);
 await new Promise(r=>setImmediate(r));
 const b=bridge.request({command:'layout',page:2});const eb=assert.rejects(b,/取消/);
 bridge.cancel();await Promise.all([ea,eb]);assert.equal(kills,1);
 const fresh=bridge.request({command:'inspect',page:3});await new Promise(r=>setImmediate(r));bridge.pending.resolve({page:3});bridge.pending=null;assert.deepEqual(await fresh,{page:3});bridge.cancel();
});

test('ZIP project roundtrips independent source, fragment and geometry; v1 remains readable',async()=>{
 const s=state();s.nativeEdits=[{id:'edit',fragment:encodeBase64(bytes),ink:[{x:1,text:'中'}],model:{text:'中'}}];
 const encoded=await encodeProject(bytes,'测试.pdf',s),files=unzipStored(encoded);
 assert.equal(files.size,5);assert(!new TextDecoder().decode(files.get('state.json')).includes('fragment"'));
 const decoded=await decodeProject(encoded);assert.deepEqual(decoded.bytes,bytes);assert.deepEqual(decoded.state.nativeEdits,s.nativeEdits);
 const old={format:'folio-project/1',source:{name:'old.pdf',base64:encodeBase64(bytes),sha256:await digest(bytes)},state:s};
 assert.deepEqual((await decodeProject(new TextEncoder().encode(JSON.stringify(old)))).state.nativeEdits,s.nativeEdits);
});
test('ZIP rejects changed payload, forged hash, missing resource and unexpected paths',async()=>{
 const encoded=await encodeProject(bytes,'test.pdf',state()),bad=encoded.slice();bad[45]^=1;
 await assert.rejects(decodeProject(bad),/校验|一致|无效/);
 const entries=unzipStored(encoded);entries.set('source.pdf',new Uint8Array(bytes.length));
 await assert.rejects(decodeProject(await zipBlob(entries).arrayBuffer().then(b=>new Uint8Array(b))),/校验/);
 entries.set('../escape',bytes);await assert.rejects(decodeProject(new Uint8Array(await zipBlob(entries).arrayBuffer())),/路径/);
});
test('history shares large immutable fragments and invalidates redo on branch',()=>{
 const h=new History(40,1024,1024*1024),edits=[{id:'a',fragment:'x'.repeat(20000),ink:[]}],a={...state(),nativeEdits:edits};
 for(let i=0;i<10;i++)h.push({...a,value:i});
 assert.equal(h.assets.values.size,1);assert(h.past.every(e=>e.json.length<200));assert(Object.isFrozen(edits[0]));
 const old=h.undo({...a,value:10});assert.equal(old.value,9);assert.equal(old.nativeEdits,edits);
 h.push({...a,value:11});assert.equal(h.redo(a),null);h.clear();assert.equal(h.assets.values.size,0);
});
test('session tokens reject late work and settings validate each known field',()=>{
 const d=new DocumentSession(),a=d.capture();d.change();assert(!d.current(a));const b=d.capture();d.replace();assert.throws(()=>d.assert(b),/变化/);
 const base={undo:40,theme:'light',layout:'continuous',protect:true,shortcuts:{}};
 assert.deepEqual(readSettings(base,'[]'),base);assert.deepEqual(readSettings(base,'{'),base);
 const s=readSettings(base,JSON.stringify({undo:'40',theme:'evil',layout:'single',protect:'false',shortcuts:{save:'Ctrl+S'}}));
 assert.equal(s.undo,40);assert.equal(s.protect,true);assert.equal(s.layout,'single');assert.equal(s.shortcuts.save,'Ctrl+S');
});
test('registered source survives a lease and is removed after release',async()=>{
 const store=new SourceStore();try{const ref=await store.register(bytes),lease=store.acquire(ref.handle);
 await store.release(ref.handle);assert.deepEqual(new Uint8Array(await readFile(lease.file)),bytes);assert.throws(()=>store.acquire(ref.handle),/失效/);
 await lease.release();await assert.rejects(readFile(lease.file));assert.equal(store.entries.size,0);
 }finally{await store.close();}
});
test('stream writer keeps original until complete and aborts failed replacement',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'folio-save-test-')),file=path.join(dir,'a.folio');
 try{await writeFile(file,'old');const store=new FileStore(async()=>file),ticket=await store.prepare({name:'a.folio',kind:'folio'});
 const id=await store.beginStream({ticket,kind:'folio',total:6});await store.appendStream({id,offset:0,bytes:new Uint8Array([1,2,3])});
 await assert.rejects(store.finishStream(id),/完整/);assert.equal(await readFile(file,'utf8'),'old');
 await assert.rejects(store.appendStream({id,offset:0,bytes:new Uint8Array([4])}),/序列/);
 await store.appendStream({id,offset:3,bytes:new Uint8Array([4,5,6])});await store.finishStream(id);assert.deepEqual([...await readFile(file)],[1,2,3,4,5,6]);
 const fail=new FileStore(async()=>file,async()=>{throw Error('locked');}),t=await fail.prepare({name:'a.folio',kind:'folio'}),i=await fail.beginStream({ticket:t,kind:'folio',total:1});
 await fail.appendStream({id:i,offset:0,bytes:new Uint8Array([9])});await assert.rejects(fail.finishStream(i),/locked/);assert.deepEqual([...await readFile(file)],[1,2,3,4,5,6]);assert.deepEqual(await readdir(dir),['a.folio']);
 }finally{await rm(dir,{recursive:true,force:true});}
});

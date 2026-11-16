import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {PdfEngine} from '../src/pdf-core.mjs';import {makeNode} from '../src/model.mjs';
const {FileStore}=createRequire(import.meta.url)('../file-store.cjs');
const python=process.env.FOLIO_PYTHON||path.resolve('native/runtime/python.exe');
const native=(...args)=>{const r=spawnSync(python,['tests/save-281-native.py',...args],{encoding:'utf8',windowsHide:true,timeout:180000});assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout;};
const sha=b=>createHash('sha256').update(b).digest('hex');
const summary=nodes=>nodes.map(n=>({title:n.title,parent:n.parent?nodes.findIndex(p=>p.id===n.parent):null,bold:n.bold,italic:n.italic,color:n.color.toLowerCase(),page:n.target.page??null,mode:n.target.mode??null,args:n.target.args??null,uri:n.target.uri??null}));
const matrix=JSON.parse(await fs.readFile('tests/output/save-281/matrix.json','utf8')),checks=[];
for(const row of matrix){
  const original=new Uint8Array(await fs.readFile(row.original)),file=path.join(path.dirname(row.original),'working.pdf');await fs.writeFile(file,original);
  let engine=new PdfEngine(),info=await engine.open(original),nodes=structuredClone(info.nodes),contentBytes=null,contentRevision=null,expected=row.original;
  const store=new FileStore(()=>{throw Error('Unexpected Save As dialog');});let handle=store.grant(file,original),working=false;
  const parent=makeNode('Save 281 parent',1),child=makeNode('Save 281 child',Math.min(2,info.pageCount),parent.id);nodes.push(parent,child);
  const save=async(name,compact=false)=>{
    const before=await fs.readFile(file),ticket=await store.prepare({name:path.basename(file),kind:'pdf',handle,protect:false,working});const start=performance.now();
    const saved=await engine.save({nodes,contentBytes,contentRevision,incrementalResult:true,baseHash:ticket.baseHash,compact});
    assert.equal(saved.append,!compact&&engine.incrementalSafe!==false,name+' append mode');
    const result=await store.save({kind:'pdf',ticket,...saved});engine.commitSave(result);handle=result.handle;working=true;
    const after=await fs.readFile(file);if(saved.append)assert(after.subarray(0,before.length).equals(before),'Original revisions must stay byte-identical');
    const read=await new PdfEngine().open(after);assert.deepEqual(summary(read.nodes),summary(nodes),name+' bookmarks');
    const validation=JSON.parse(native('verify',expected,file,...(name==='reopen-native'?['all']:[])));
    checks.push({document:row.id,edit:name,append:saved.append,writeBytes:saved.bytes.length,totalBytes:after.length,ms:Math.round(performance.now()-start),...validation});
    console.log('PASS',row.id,name,saved.mode,validation.pagesChecked);
  };
  await save('bookmark-create');
  parent.title='Renamed parent 中文';parent.bold=true;parent.italic=true;parent.color='#336699';child.target={kind:'dest',page:info.pageCount,mode:'FitH',args:[140]};
  await save('bookmark-style-target');
  for(let phase=1;phase<=4;phase++){
    expected=path.join(path.dirname(file),`native-${phase}.pdf`);native('edit',row.original,expected,String(phase));contentBytes=new Uint8Array(await fs.readFile(expected));contentRevision=`phase-${phase}`;
    await save(['','text','image','vector','ocr-layer'][phase]);
  }
  const edited=structuredClone(nodes);nodes=nodes.filter(n=>n.id!==parent.id&&n.id!==child.id);await save('bookmark-delete');
  nodes=structuredClone(info.nodes);contentBytes=null;contentRevision=null;expected=row.original;await save('undo-all');
  nodes=edited;expected=path.join(path.dirname(file),'native-4.pdf');contentBytes=new Uint8Array(await fs.readFile(expected));contentRevision='redo';await save('redo-all');
  await save('compact',true);
  const reopened=await fs.readFile(file);engine=new PdfEngine();info=await engine.open(new Uint8Array(reopened));nodes=info.nodes;
  expected=path.join(path.dirname(file),'reopen-native.pdf');native('edit',file,expected,'3');contentBytes=new Uint8Array(await fs.readFile(expected));contentRevision='reopened';await save('reopen-native');
  assert.equal(sha(await fs.readFile(row.source)),row.sha256,'Local original changed');
}
await fs.writeFile('tests/output/save-corpus-281.json',JSON.stringify({status:'passed',documents:matrix.length,originalsUnchanged:true,checks},null,2));

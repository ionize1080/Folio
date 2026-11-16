import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {PDFDocument,PDFName,PDFNumber} from '../src/vendor/pdf-lib.js';import {PdfEngine} from '../src/pdf-core.mjs';import {makeNode} from '../src/model.mjs';
const folder='tests/output/bookmark-source-282-fixture';
export async function createFixture(){
 await fs.mkdir(folder,{recursive:true});const doc=await PDFDocument.create();
 for(let i=0;i<3;i++){const page=doc.addPage([420,595]);page.drawText('2024 report: the first paragraph preserves its text and original font.\nAdditional test characters can be appended at the end of this paragraph.',{x:30,y:520,size:11,lineHeight:18});page.drawText('Unchanged text below the edited paragraph.',{x:30,y:390,size:11});}
 const engine=new PdfEngine();await engine.open(await doc.save());const nodes=Array.from({length:32},(_,i)=>makeNode('Chapter '+(i+1),i%3+1));
 const bookmark=makeNode('新书签',2);bookmark.target={kind:'dest',page:2,mode:'XYZ',args:[0,418.7508745393122,1.6409305325968633]};nodes.push(bookmark);
 const file=path.resolve(folder,'fixture.pdf');await fs.writeFile(file,await engine.save({nodes}));return file;
}
async function run(){
 const generated=await createFixture();if(process.argv[2]==='prepare'){console.log(generated);return;}
 const python=process.env.FOLIO_PYTHON||path.resolve('native/runtime/python.exe'),native=(...args)=>{const p=spawnSync(python,['tests/bookmark-source-282.py',...args],{encoding:'utf8',windowsHide:true,timeout:120000});assert.equal(p.status,0,p.stderr||p.stdout);return p.stdout;};
 const contracts=JSON.parse(native('contracts'));
 const source=process.env.FOLIO_BOOKMARK_PDF||generated,original=await fs.readFile(source),sourceHash=createHash('sha256').update(original).digest('hex');
 const engine=new PdfEngine(),info=await engine.open(original),legacy=path.resolve(folder,'legacy.pdf');native('legacy',path.resolve(source),legacy);
 await assert.rejects(engine.save({nodes:info.nodes,contentBytes:await fs.readFile(legacy)}),/来源发生变化/,'The real pre-fix rounding failure must be reproduced');
 const results=[];let current=path.resolve(source);
 for(const phase of ['empty','text','text']){
  const output=path.resolve(folder,`native-${results.length}.pdf`);native('apply',current,output,phase,String(process.env.FOLIO_BOOKMARK_PAGE||1));
  const next=new PdfEngine(),before=await next.open(await fs.readFile(current)),contentBytes=await fs.readFile(output),preview=new PdfEngine();await preview.open(contentBytes);
  assert.deepEqual(preview.sourceSignatures,next.sourceSignatures,'Untouched bookmarks must remain exactly identical');
  const saved=await next.save({nodes:before.nodes,contentBytes}),read=new PdfEngine(),after=await read.open(saved);
  assert.deepEqual(after.nodes.map(n=>[n.title,n.target.page,n.target.mode,n.target.args]),before.nodes.map(n=>[n.title,n.target.page,n.target.mode,n.target.args]));
  const tampered=await PDFDocument.load(contentBytes),last= tampered.catalog.lookup(PDFName.of('Outlines')).lookup(PDFName.of('Last'));
  const dest=last.lookup(PDFName.of('Dest'));dest.set(3,PDFNumber.of(dest.lookup(3).asNumber()+1e-9));
  await assert.rejects(next.save({nodes:before.nodes,contentBytes:await tampered.save()}),/来源发生变化/,'A real tiny coordinate change must still be rejected');
  current=path.resolve(folder,`saved-${results.length}.pdf`);await fs.writeFile(current,saved);results.push({phase,bookmarks:after.nodes.length,lastDestination:after.nodes.at(-1).target.args});
 }
 assert.equal(createHash('sha256').update(await fs.readFile(source)).digest('hex'),sourceHash);
 const checks=[...contracts.checks,'Legacy native rounding reproduces the reported save failure','Empty and edited native snapshots save and reopen with exact bookmark identity','Genuine destination changes remain blocked'];
 await fs.writeFile('tests/output/bookmark-source-282.json',JSON.stringify({status:'passed',checks,results,originalUnchanged:true},null,2));console.log('PASS',checks);
}
if(path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url))await run();

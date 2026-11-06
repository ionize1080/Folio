import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {FileStore}=createRequire(import.meta.url)('../file-store.cjs');
test('new document, image archive, validation report and font exports save through file capabilities', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'folio-exports-'));
 try {
  const store=new FileStore(async name=>path.join(dir,name));
  for(const kind of ['docx','xlsx','zip','xml','ttf','otf']){
   const bytes=Buffer.from(`export ${kind}`),name=`result.${kind}`;
   const saved=await store.save({name,kind,bytes,forceAs:true});
   assert.equal(saved.name,name);assert.deepEqual(await fs.readFile(path.join(dir,name)),bytes);
  }
  await assert.rejects(store.prepare({name:'bad.exe',kind:'exe'}),/Invalid save request/);
  const ticket=await store.prepare({name:'mismatch.docx',kind:'docx'});
  await assert.rejects(store.save({ticket,kind:'pdf',bytes:Buffer.from('wrong')}));
  assert(!(await fs.readdir(dir)).includes('mismatch.docx'));
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

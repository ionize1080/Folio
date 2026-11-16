import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {PDFDocument} from '../src/vendor/pdf-lib.js';
import {PdfEngine} from '../src/pdf-core.mjs';
import {makeNode} from '../src/model.mjs';
const {FileStore}=createRequire(import.meta.url)('../file-store.cjs');

test('first unprotected save appends; interleaved documents retain independent bookmarks, undo and conflict checks',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'folio-save281-'));
  try{
    const store=new FileStore(()=>{throw Error('Unprotected saves must not ask for another path');});
    const tabs=[];
    for(let i=0;i<3;i++){
      const doc=await PDFDocument.create();doc.addPage([400+i*10,500]);doc.addPage([400,500]);
      const bytes=await doc.save(),file=path.join(dir,`tab-${i}.pdf`);await fs.writeFile(file,bytes);
      const engine=new PdfEngine();await engine.open(bytes);
      tabs.push({engine,file,bytes,handle:store.grant(file,bytes),nodes:[makeNode(`Document ${i}`,1)]});
    }
    for(let cycle=0;cycle<3;cycle++)for(const [i,tab] of tabs.entries()){
      tab.nodes[0].title=`Document ${i} cycle ${cycle}`;
      const ticket=await store.prepare({kind:'pdf',name:path.basename(tab.file),handle:tab.handle,protect:false,working:cycle>0});
      const saved=await tab.engine.save({nodes:tab.nodes,rotations:cycle===1?{1:90}:{},incrementalResult:true,baseHash:ticket.baseHash});
      assert(saved.append,'Including the first save, only the revision is sent to disk');
      const before=await fs.readFile(tab.file);
      const result=await store.save({kind:'pdf',ticket,...saved});tab.engine.commitSave(result);
      const after=await fs.readFile(tab.file);assert(after.subarray(0,before.length).equals(before));
      const info=await new PdfEngine().open(after);
      assert.equal(info.nodes[0].title,tab.nodes[0].title);assert.equal(info.pages[0].rotation,cycle===1?90:0);
    }
    const tab=tabs[0],ticket=await store.prepare({kind:'pdf',name:'tab-0.pdf',handle:tab.handle,protect:false});
    const saved=await tab.engine.save({nodes:tab.nodes,incrementalResult:true,baseHash:ticket.baseHash});
    await fs.appendFile(tab.file,'\nexternal edit');const external=await fs.readFile(tab.file);
    await assert.rejects(store.save({kind:'pdf',ticket,...saved}),/其他程序|版本/);
    assert.deepEqual(await fs.readFile(tab.file),external);
    const mismatch=await new PdfEngine();await mismatch.open(tabs[1].bytes);
    const wrong=await mismatch.save({nodes:[],incrementalResult:true,baseHash:'0'.repeat(64)});
    assert.equal(wrong.append,false,'An unrelated Save As target cannot receive a delta');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

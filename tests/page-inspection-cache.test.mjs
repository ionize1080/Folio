import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageInspectionCache} from '../src/page-inspection-cache.mjs';
test('page edit inspection shares pending work without sharing mutable evidence',async()=>{
  let calls=0;const source=new Uint8Array([1]);
  const read=createPageInspectionCache(async()=>{calls++;return {objects:[{text:'source'}]};});
  const [a,b]=await Promise.all([read(source,1),read(source,1)]);
  a.objects[0].text='edited';assert.equal(b.objects[0].text,'source');assert.equal((await read(source,1)).objects[0].text,'source');assert.equal(calls,1);
  await read(new Uint8Array([2]),1);assert.equal(calls,2);
});
test('failed page inspections retry and bounded cache evicts old pages',async()=>{
  let fail=true,calls=0;const source={};const read=createPageInspectionCache(async(_,p)=>{calls++;if(fail)throw Error('retry');return p;},2);
  await assert.rejects(read(source,1));fail=false;assert.equal(await read(source,1),1);
  await read(source,2);await read(source,3);await read(source,1);assert.equal(calls,5);
});

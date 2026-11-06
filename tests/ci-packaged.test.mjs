import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {runLanes}=createRequire(import.meta.url)('../scripts/ci-packaged.cjs');
test('bounded application lanes overlap, preserve lane order and collect independent failures',async()=>{
  let active=0,peak=0;const order=[];
  const report=await runLanes([['a','b'],['c','d']],async task=>{
    peak=Math.max(peak,++active);order.push(task);
    await new Promise(r=>setTimeout(r,15));active--;
    if(task==='a')throw Error('isolated failure');
  });
  assert.equal(peak,2);assert.equal(report.status,'failed');
  assert.equal(report.checks.length,4);assert.equal(report.checks.filter(r=>r.status==='passed').length,3);
  assert(order.indexOf('a')<order.indexOf('b'));assert(order.indexOf('c')<order.indexOf('d'));
  await assert.rejects(runLanes([[],[],[]],async()=>{}),/At most two/);
});

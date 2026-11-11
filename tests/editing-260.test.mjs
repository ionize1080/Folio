import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { connectedParagraphs } from '../src/flow-regions.mjs';
import { pageCandidates } from '../src/flow-page-model.mjs';
import { PageSpatialIndex } from '../src/page-spatial.mjs';
const {FontWarmup}=createRequire(import.meta.url)('../font-warmup.cjs');
const object=(index,text,y)=>({index,type:'text',text,size:10,flowEditable:true,editable:true,signature:String(index),fontKey:'test',fontName:'Regular',matrix:[1,0,0,1,50,800-y],bounds:[50,800-y-2,350,800-y+8]});

test('inline underlines retain a paragraph while a separated rule divides it',()=>{
  const objects=[object(0,'A sufficiently long line containing a hyperlink',100),object(1,'continues with ordinary text on another line.',116)];
  const line=y=>({index:2,type:'path',bounds:[80,800-y-.3,200,800-y]});
  assert.equal(connectedParagraphs([...objects,line(101)],800).length,1);
  assert.equal(connectedParagraphs([...objects,line(108)],800).length,2);
});

test('verified paragraph tags retain physical line breaks across large leading',()=>{
  const a=object(0,'First tagged line is a complete sentence.',100),b=object(1,'Second tagged line remains the same paragraph.',132);
  a.structureParagraph=b.structureParagraph=7;
  const models=pageCandidates([a,b],600,800).map(c=>c.model);
  assert.equal(models.length,1);assert.match(models[0].text,/sentence\.\nSecond/);
  assert.equal(models[0].sources.length,2);assert.equal(models[0].softBreaks.length,1);
});

test('spatial table lookup matches exhaustive ownership including boundaries and huge objects',()=>{
  let seed=260;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  const items=Array.from({length:2000},(_,i)=>{const x=random()*2000-500,y=random()*2000-500;return {i,b:[x,y,x+random()*80,y+random()*80]};});
  items.push({i:2000,b:[-10000,-10000,10000,10000]});
  const index=new PageSpatialIndex(items,i=>i.b);
  for(let k=0;k<250;k++){
    const x=random()*2000-500,y=random()*2000-500,b=[x,y,x+(k%3?40:0),y+(k%3?30:0)],t=k%2;
    assert.deepEqual(index.search(b,t),items.filter(({b:a})=>a[2]>b[0]+t&&a[0]<b[2]-t&&a[3]>b[1]+t&&a[1]<b[3]-t));
  }
  assert.deepEqual(index.search([-20000,-20000,20000,20000]),items);
});

function setup(request){
  const calls=[],leases={active:0,released:0};
  const bridge={cancels:0,request:async q=>{calls.push(q);return request(q);},cancel(){this.cancels++;this.reject?.(Error('cancelled'));}};
  const sources={acquire:()=>{leases.active++;return {file:'fixture.pdf',release:async()=>{leases.active--;leases.released++;}};}};
  return {warm:new FontWarmup('',null,sources,{bridge,idleMs:100000}),bridge,calls,leases};
}

test('font warmup scans one page, deduplicates faces and releases every lease',async()=>{
  const {warm,bridge,calls,leases}=setup(q=>q.command==='font-scan'?{pages:2,fonts:[{fontKey:'face'},{fontKey:'face'}]}:{memoryBytes:12});
  try{
    warm.add('doc',2);warm.add('doc',2);
    for(let i=0;i<4;i++)await warm.step();
    assert.deepEqual(calls.map(c=>c.command),['font-scan','font-warm','font-warm','font-scan']);
    assert.deepEqual(calls.filter(c=>c.command==='font-scan').map(c=>c.page),[2,1]);
    assert.equal(warm.jobs.size,0);assert.equal(leases.active,0);assert.equal(leases.released,4);
    assert.equal(bridge.environment.OMP_NUM_THREADS,'1');assert(bridge.priority>0);
  }finally{warm.close();}
});

test('foreground work preempts idle matching without losing its retry slot',async()=>{
  let reject;const {warm,bridge,leases}=setup(()=>new Promise((_,r)=>{reject=r;}));
  try{
    bridge.cancel=function(){this.cancels++;reject?.(Error('cancelled'));};
    warm.add('doc');const pending=warm.step();
    await warm.foregroundTask(async()=>assert.equal(bridge.cancels,1));await pending;
    assert.equal(warm.jobs.get('doc').retries,0);assert.equal(leases.active,0);
    warm.forget('doc');assert.equal(warm.jobs.size,0);
  }finally{warm.close();}
});

test('warmup errors and memory recycling are bounded and never surface in editing',async()=>{
  let failed=true;const {warm,bridge,leases}=setup(()=>{if(failed)throw Error('bad font');return {pages:1,fonts:[],memoryBytes:300*1024**2};});
  try{
    warm.add('bad');for(let i=0;i<3;i++)await warm.step();assert.equal(warm.jobs.size,0);
    failed=false;warm.add('large');await warm.step();assert.equal(warm.jobs.size,0);assert.equal(bridge.cancels,1);assert.equal(leases.active,0);
  }finally{warm.close();}
});

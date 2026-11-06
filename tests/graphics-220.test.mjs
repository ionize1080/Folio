import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {placement,pathFrame,pathPlacement} from '../src/graphic-geometry.mjs';
const require=createRequire(import.meta.url),{generate,body}=require('../image-provider.cjs');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {ImageConfig,validate}=require('../image-config.cjs');
test('image service configuration persists custom model/endpoint and encrypted keys without exposing secrets',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'folio-image-config-'));
  try{
    const safe={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('sealed:'+Buffer.from(s).toString('hex')),decryptString:b=>Buffer.from(b.toString().slice(7),'hex').toString()};
    const store=new ImageConfig(dir,safe);
    const config=store.save({protocol:'openai',endpoint:'https://images.example/v1',model:'custom-image-model',apiKey:'test-image-secret',keyFile:'',referenceMode:'multipart',extra:{quality:'high'}});
    assert.equal(config.model,'custom-image-model');assert.equal(config.endpoint,'https://images.example/v1/images/generations');assert(config.hasKey);assert(!JSON.stringify(config).includes('secret'));assert(!fs.readFileSync(store.file,'utf8').includes('test-image-secret'));
    assert.equal(new ImageConfig(dir,safe).key(),'test-image-secret');
    store.save({...config,model:'second-model'});assert.equal(store.key(),'test-image-secret');
    store.save({clearKey:true});assert.equal(store.key(),'');
    assert.throws(()=>validate({...config,endpoint:'https://user:password@example.com'}));
    assert.throws(()=>validate({...config,extra:{model:'override'}}));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('custom OpenAI-compatible service handles embedded pixels and standard reference-image uploads',async()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10]);let request;
  const fetcher=async(url,init)=>{request={url,init};return new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));};
  const config={protocol:'openai',endpoint:'https://provider.example/v1/images/generations',model:'custom-model',referenceMode:'multipart',extra:{quality:'high'}};
  await generate({prompt:'cup',size:'1536x1024'},fetcher,()=> 'test',config);
  assert.equal(JSON.parse(request.init.body).model,'custom-model');assert.equal(JSON.parse(request.init.body).quality,'high');
  await generate({prompt:'edit',reference:'data:image/png;base64,'+png.toString('base64')},fetcher,()=> 'test',config);
  assert.equal(request.url,'https://provider.example/v1/images/edits');assert(request.init.body instanceof FormData);assert.equal(request.init.body.get('image').type,'image/png');assert.equal(request.init.headers['Content-Type'],undefined);
});
test('geometry preserves skew unless explicit size/rotation is changed; rejects degenerate matrices',()=>{
  assert.deepEqual(placement({x:70},[200,30,15,100,1,2]).matrix,[200,30,15,100,70,2]);
  const m=placement({width:100,height:50,rotation:90,x:10,y:20}).matrix;
  assert(Math.abs(m[0])<1e-10);assert.equal(m[1],100);assert.equal(m[2],-50);assert.equal(m[4],10);
  for(const v of [{matrix:[0,0,0,0,0,0]},{width:0},{rotation:Infinity},{x:NaN}])assert.throws(()=>placement(v));
});
test('Qwen validates parameters before accessing credentials or network',async()=>{
  for(const o of [{prompt:''},{prompt:'x',size:'9999x9999'},{prompt:'x',seed:-1},{prompt:'x',watermark:'false'}])assert.throws(()=>body(o));
  let touched=false;
  await assert.rejects(generate({prompt:''},()=>{touched=true},()=>{touched=true}));assert.equal(touched,false);
});
test('Token Plan uses native schema; downloads pixels without forwarding credentials',async()=>{
  const calls=[],png=Buffer.from([137,80,78,71,13,10,26,10]);
  const fetcher=async(url,init)=>{calls.push({url:String(url),init});return calls.length===1?new Response(JSON.stringify({output:{choices:[{message:{content:[{image:'https://test.oss-cn-beijing.aliyuncs.com/result.png'}]}}]}})):new Response(png);};
  assert.equal(await generate({prompt:'cup',size:'512x512'},fetcher,()=> 'sk-sp-test-only'),png.toString('base64'));
  assert(calls[0].url.includes('token-plan.maas.'));
  const request=JSON.parse(calls[0].init.body);assert.equal(request.parameters.size,'512*512');assert.equal(request.input.messages[0].content[0].text,'cup');assert.equal(calls[1].init.headers,undefined);
});
test('concurrent generation is bounded and rejects unsafe output URLs and HTTP failures',async()=>{
  await assert.rejects(generate({prompt:'test'},async()=>new Response('{}',{status:401}),()=> 'test'),/401/);
  await assert.rejects(generate({prompt:'test'},async()=>new Response(JSON.stringify({data:[{url:'http://127.0.0.1/a'}]})),()=> 'test'),/不受信任/);
  let unblock;const gate=new Promise(r=>unblock=r),started=[];
  const fetcher=async()=>{started.push(1);await gate;return new Response('{}',{status:429});};
  const jobs=Array.from({length:4},()=>generate({prompt:'test'},fetcher,()=> 'test'));
  assert.equal(started.length,4);await assert.rejects(generate({prompt:'test'},fetcher,()=> 'test'),/4/);unblock();
  const results=await Promise.allSettled(jobs);assert(results.every(r=>r.status==='rejected'));
});

import vm from 'node:vm';
test('Chatbox never silently marks capped, truncated or disconnected streams complete',()=>{
 const ctx={window:{}};vm.runInNewContext(fs.readFileSync('integrations/chatbox/completion.js','utf8'),ctx);
 const issue=ctx.window.folioCompletionIssue;
 for(const reason of [undefined,'unknown','error','length','tool-calls'])assert.match(issue(reason,false),/未完成/);
 assert.equal(issue('stop',false),null);assert.equal(issue(undefined,true),null);
});
test('ephemeral source handles survive failures and do not exhaust the 16 source limit',async()=>{
 let active=0,released=0;
 globalThis.window={desktop:{registerSource:async()=>{assert(++active<=16);return {handle:'snapshot'};},releaseSource:async()=>{active--;released++;},native:async a=>{if(a.fail)throw Error('worker failure');return {};}}};
 const {nativeRequest,releaseSource}=await import('../src/native-source.mjs');
 for(let i=0;i<40;i++){const bytes=new Uint8Array([37,80,68,70,0]);try{await nativeRequest({command:'ocr',bytes,fail:i%2===0});}catch(e){assert.match(e.message,/worker failure/);}finally{await releaseSource(bytes);}}
 assert.equal(active,0);assert.equal(released,40);delete globalThis.window;
});

test('path dimensions operate on actual segment extent, including rotation and position',()=>{
 const path={matrix:[1,0,0,1,0,0],segments:[{x:10,y:20},{x:210,y:120}]};
 assert.deepEqual(pathFrame(path).matrix,[200,0,0,100,10,20]);
 const result=pathPlacement({x:40,y:50,width:100,height:50,rotation:90},path);
 const frame=pathFrame({...path,...result}).matrix;
 for(const [i,v] of [0,100,-50,0,40,50].entries())assert(Math.abs(frame[i]-v)<1e-8);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const { ImageConfig, defaults }=require('../image-config.cjs');
const { generate }=require('../image-provider.cjs');
const png=Buffer.from([137,80,78,71,13,10,26,10]);

test('image settings do not auto-read developer paths and use environment keys after settings are saved',()=>{
  assert.equal(defaults.keyFile,'');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'folio-image-settings-'));
  const previous=process.env.FOLIO_IMAGE_API_KEY;
  process.env.FOLIO_IMAGE_API_KEY='test-environment-secret';
  try {
    const config=new ImageConfig(dir,{});
    config.save({model:' qwen-image-3.0-pro '});
    assert.equal(config.public().model,'qwen-image-3.0-pro');
    assert.equal(config.key(),'test-environment-secret');
    assert(config.public().hasKey);
    assert(!JSON.stringify(config.public()).includes('secret'));
    assert(!fs.readFileSync(config.file,'utf8').includes('secret'));
  } finally {
    if(previous===undefined)delete process.env.FOLIO_IMAGE_API_KEY;else process.env.FOLIO_IMAGE_API_KEY=previous;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('Qwen-compatible reference images use JSON on generations without switching to OpenAI edits',async()=>{
  let seen;
  await generate({prompt:'Recolor the circle',reference:'data:image/png;base64,'+png.toString('base64')},async(url,options)=>{
    seen={url,options};return new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));
  },()=> 'test',{protocol:'openai',endpoint:'https://qwen.example/compatible-mode/v1/images/generations',referenceMode:'json',model:'qwen-image-3.0-pro'});
  assert.match(seen.url,/\/images\/generations$/);
  assert.equal(seen.options.headers['Content-Type'],'application/json');
  assert.equal(JSON.parse(seen.options.body).image[0],'data:image/png;base64,'+png.toString('base64'));
});

test('provider errors identify parameter and permission problems while redacting the credential',async()=>{
  const secret='test-sensitive-key';
  await assert.rejects(generate({prompt:'circle'},async()=>new Response(JSON.stringify({error:{code:'InvalidParameter',message:'Unsupported reference mode; received '+secret}}),{status:400}),()=>secret),error=>{
    assert.match(error.message,/HTTP 400.*InvalidParameter.*Unsupported reference/);
    assert(!error.message.includes(secret));return true;
  });
  await assert.rejects(generate({prompt:'circle'},async()=>new Response('<html>not an image API</html>'),()=>secret),/无效响应/);
  await assert.rejects(generate({prompt:'circle'},async()=>new Response(JSON.stringify({output:{task_id:'not-a-result'}})),()=>secret),/异步任务/);
  await assert.rejects(generate({prompt:'circle'},async()=>new Response('{}'),()=>secret),/未返回图片/);
});

test('a transient image download failure retries the download without generating or billing another image',async()=>{
  let posts=0,downloads=0;
  const image=await generate({prompt:'circle'},async(url,options)=>{
    if(options.method==='POST'){posts++;return new Response(JSON.stringify({data:[{url:'https://images.qianwenaiapi.com/result.png'}]}));}
    downloads++;if(downloads===1)throw Object.assign(Error('socket closed'),{cause:{code:'ECONNRESET'}});
    return new Response(png);
  },()=> 'test');
  assert.equal(image,png.toString('base64'));assert.equal(posts,1);assert.equal(downloads,2);
  await assert.rejects(generate({prompt:'circle'},async()=>{throw Object.assign(Error('failed'),{cause:{code:'ENOTFOUND'}})},()=> 'test'),/无法连接图片服务.*ENOTFOUND/);
});

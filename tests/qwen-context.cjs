const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=readFileSync(process.argv[2]||'integrations/chatbox/live-context.js','utf8');
const scope={window:{}};
vm.runInNewContext(source,scope);
const refresh=scope.window.folioRefreshContext;
const clone=x=>JSON.parse(JSON.stringify(x));
const plain=x=>clone(x);
const checkRoles=messages=>{messages.forEach((m,i)=>assert(!(i>0&&m.role==='system'),'System message must be at the beginning.'));};
const base=[{role:'system',content:'original instructions'},{role:'user',content:'read this page'}];
let count=0;
async function run(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
 await run('fresh chat, no trailing system, original request preserved',async()=>{
  scope.window.folioLiveContext=async()=>({currentPage:1});
  const original=clone(base),r=await refresh(base);checkRoles(r);
  assert.deepEqual(plain(r.map(m=>m.role)),['system','user']);
  assert.equal(r[0],base[0]);assert.equal(r[1].content[0].text,base[1].content);
  assert.match(r[1].content[1].text,/"currentPage":1/);assert.deepEqual(base,original);
 });
 await run('multimodal user content and metadata preserved',async()=>{
  const image={type:'image',image:'data:image/png;base64,TEST',mimeType:'image/png'};
  const input=[base[0],{role:'user',content:[{type:'text',text:'what is shown?'},image],providerOptions:{keep:true}}];
  const before=clone(input),r=await refresh(input);checkRoles(r);
  assert.equal(r[1].content[1],image);assert.equal(r[1].content.length,3);
  assert.deepEqual(r[1].providerOptions,{keep:true});assert.deepEqual(input,before);
 });
 await run('multi-turn context attaches to latest user only',async()=>{
  const input=[...base,{role:'assistant',content:'page one'},{role:'user',content:'now this page'}];
  const r=await refresh(input);checkRoles(r);assert.equal(r[1],input[1]);assert.equal(r[2],input[2]);assert.equal(r[3].content[0].text,'now this page');
 });
 await run('tool-call IDs, results and order preserved',async()=>{
  const input=[...base,{role:'assistant',content:[{type:'tool-call',toolCallId:'t1',toolName:'folio_render',input:{}}]},{role:'tool',content:[{type:'tool-result',toolCallId:'t1',toolName:'folio_render',output:{type:'text',value:'ok'}}]}];
  const r=await refresh(input);checkRoles(r);assert.equal(r[2],input[2]);assert.equal(r[3],input[3]);assert.equal(r.length,input.length);
 });
 await run('automatic continuation transcript remains valid',async()=>{
  const first=await refresh(base);
  const continuation=[...first,{role:'assistant',content:'working'},{role:'tool',content:[]},{role:'user',content:'continue'}];
  checkRoles(continuation);assert.equal(continuation[0],base[0]);
 });
 await run('each request reads latest page/document/selection, no stored accumulation',async()=>{
  let page=1;scope.window.folioLiveContext=async()=>({currentPage:page,documentId:'doc'+page,textSelection:{text:'selection'+page}});
  const a=await refresh(base);page=2;const b=await refresh(base);
  assert.match(a[1].content[1].text,/"documentId":"doc1"/);assert.match(b[1].content[1].text,/"documentId":"doc2"/);
  assert.match(b[1].content[1].text,/selection2/);assert.equal(b[1].content.length,2);assert.equal(typeof base[1].content,'string');
 });
 for(const [name,get] of [['missing context',async()=>null],['tool error',async()=>({isError:true})],['exception',async()=>{throw Error('offline');}]]){
  await run(name+' leaves request intact',async()=>{scope.window.folioLiveContext=get;assert.equal(await refresh(base),base);});
 }
 await run('missing user or unsupported content leaves request intact',async()=>{
  scope.window.folioLiveContext=async()=>({currentPage:2});
  for(const input of [[],[base[0]],[{role:'user',content:null}]])assert.equal(await refresh(input),input);
 });
 await run('frozen input is never mutated',async()=>{
  const input=Object.freeze([Object.freeze({role:'user',content:Object.freeze([Object.freeze({type:'text',text:'hello'})])})]);
  const r=await refresh(input);assert.equal(r[0].content.length,2);assert.equal(input[0].content.length,1);
 });
 console.log('TOTAL '+count+' passed');
})().catch(e=>{console.error(e);process.exitCode=1;});

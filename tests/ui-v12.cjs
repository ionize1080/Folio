const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const {SourceStore}=require('../source-store.cjs');const sourceStore=new SourceStore();
const {NativeBridge}=require('../native-bridge.cjs'),{FlowLayout}=require('../flow-layout.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/output');
const bridge=new NativeBridge(path.join(root,'native'),process.env.FOLIO_PYTHON||'python',sourceStore),flow=new FlowLayout(path.join(root,'native'),process.env.FOLIO_PYTHON||'python');
let browser,page;const errors=[],checks=[];
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.FOLIO_CHROMIUM,args:['--no-sandbox','--disable-gpu','--disable-background-networking']});
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.hostname!=='localhost')return route.abort();try{
 let body,type='application/json';if(req.method()==='POST'){const data=JSON.parse(req.postData());const r=u.pathname==='/__register'?await sourceStore.register(new Uint8Array(data)):u.pathname==='/__release'?await sourceStore.release(data):u.pathname==='/__flow'?await flow.render(data):await bridge.run(data);if(r?.bytes)r.bytes=Array.from(r.bytes);body=JSON.stringify(r??true);}
 else{const file=path.resolve(root,'src','.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));body=fs.readFileSync(file);if(path.basename(file)==='app.mjs')body=Buffer.concat([body,Buffer.from('\nwindow.__qa={S,actions,loadPDF,closeModal,rebuild,commit,confirmDiscard,savePDF,snapshot};')]);type=({'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'application/octet-stream';}await route.fulfill({status:200,contentType:type,body});
 }catch(e){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:e.message})});}});
 await page.addInitScript(()=>{const call=async(url,d)=>{const r=await fetch(url,{method:'POST',body:JSON.stringify(d)}),v=await r.json();if(v.error)throw Error(v.error);if(v.bytes)v.bytes=new Uint8Array(v.bytes);return v;};window.__saved=[];window.__calls=[];window.desktop={registerSource:b=>call('/__register',Array.from(b)),releaseSource:h=>call('/__release',h),native:d=>{window.__calls.push(d.command);if(window.__nativeFailure && ['apply','flow-background'].includes(d.command)){window.__injectedFailures=(window.__injectedFailures||0)+1;return Promise.reject(Error('injected engine failure'));}return call('/__native',{...d,...(d.bytes?{bytes:Array.from(d.bytes)}:{})});},prepareSave:async()=>window.__cancelSave?null:{ticket:'test'},qpdf:d=>call('/__native',{...d,...(d.bytes?{bytes:Array.from(d.bytes)}:{})}),cancelQpdf(){},flowLayout:d=>call('/__flow',d),setDirty(){},onClose(){},onNativeProgress(){},graphics:async()=>false,copyText:async()=>{},save:async d=>{window.__saved.push({name:d.name,length:d.bytes.length,kind:d.kind});return {name:d.name}},ocrJob:async()=>[]};});
 await page.goto('http://localhost');await page.waitForFunction(()=>window.__qa);
 await page.evaluate(async bytes=>window.__qa.loadPDF(new Uint8Array(bytes),'QA.pdf'),Array.from(fs.readFileSync(path.join(out,'v11-fixture.pdf'))));

 const action=n=>page.evaluate(n=>window.__qa.actions[n](),n);
 await action('flow-edit');await page.locator('.page-edit-hit').first().click();
 await page.waitForFunction(()=>/原始字位完成/.test(document.querySelector('#pe-status')?.textContent));
 await page.evaluate(async()=>{
  const q=window.__qa,old=q.S.bytes,editor=q.S.flowEdit;
  try{await q.loadPDF(new TextEncoder().encode('{broken'),'bad.folio');throw Error('accepted broken project');}catch(e){if(e.message==='accepted broken project')throw e;}
  if(q.S.bytes!==old || q.S.flowEdit!==editor)throw Error('active document/editor destroyed');
 });checks.push('Broken project leaves active document and edit session intact');
 const before=await page.locator('.page-edit-input').inputValue();
 await page.locator('.page-edit-input').fill(before.slice(0,1)+'A'+before.slice(2));
 await page.waitForFunction(()=>/完成/.test(document.querySelector('#pe-status')?.textContent) && window.__qa.S.flowDraftDirty);
 await page.locator('#pe-done').click();await page.waitForFunction(()=>!window.__qa.S.flowEdit && window.__qa.S.nativeEdits.length===1);
 checks.push('Edited paragraph commits with registered source handle');
 await page.evaluate(async()=>{
  const q=window.__qa,{encodeProject}=await import('/project.mjs');
  const blob=await encodeProject(q.S.bytes,q.S.name,q.snapshot(),{blob:true});
  if(!(blob instanceof Blob) || blob.size<100)throw Error('ZIP blob export failed');
  const data=new Uint8Array(await blob.arrayBuffer());
  window.__project=Array.from(data);window.__calls=[];await q.loadPDF(data,'roundtrip.folio');
  if(window.__calls.filter(x=>x==='apply').length!==1)throw Error('project applied more than once');
  if(q.S.nativeEdits.length!==1)throw Error('missing edit');
 });checks.push('Worker ZIP export/import preserves edits and composes exactly once');
 await page.evaluate(()=>{window.__cancelSave=true;window.__discard=window.__qa.confirmDiscard().then(r=>window.__discardResult=r);});
 await page.getByRole('button',{name:'保存并继续',exact:true}).click();
 await page.waitForFunction(()=>window.__discardResult===false);
 assert.equal(await page.evaluate(()=>document.querySelector('#modal').open),false);
 checks.push('Cancelling Save As resolves discard decision and preserves dirty state');
 await page.evaluate(()=>{window.__cancelSave=false;const q=window.__qa;q.commit(q.S.nodes,{nativeEdits:[]});window.__historyCount=q.S.history.past.length;window.__undoPDF=q.S.pdf;window.__undoEdits=q.S.nativeEdits;window.__undoAssets=[...q.S.history.assets.values];window.__injectedFailures=0;window.__nativeFailure=true;});
 await page.evaluate(async()=>{try{await window.__qa.actions.undo();}catch{};window.__nativeFailure=false;const q=window.__qa;if(window.__injectedFailures!==1)throw Error('undo failure was not injected');if(q.S.history.past.length!==window.__historyCount)throw Error('failed undo consumed history');if(q.S.pdf!==window.__undoPDF||q.S.nativeEdits!==window.__undoEdits)throw Error('failed preview changed document');if(window.__undoAssets.some(([key,value])=>q.S.history.assets.values.get(key)!==value))throw Error('failed undo lost assets');});
 checks.push('Failed page-preview undo preserves document, history and assets');
 await page.evaluate(async()=>{await window.__qa.actions.undo();if(window.__qa.S.nativeEdits.length!==1)throw Error('undo retry failed');});
 checks.push('Undo retries successfully after native failure');
 await page.evaluate(()=>{const q=window.__qa;q.commit([{id:'x',parent:null,title:'<img id="injected" src=x onerror="window.injected=1">',color:'#000000',target:{kind:'dest',page:1,mode:'Fit',args:[]}}]);});
 assert.equal(await page.locator('#injected').count(),0);checks.push('Bookmark text remains literal markup');
 for(const width of [900,1440]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(out,`v12-ui-${width}.png`)});}
 // Main toolbar must expose the core bookmark command without opening a menu.
 for(const width of [900,1440]){
  await page.setViewportSize({width,height:900});
  const button=page.locator('.toolbar > .toolgroup [data-action="generate"]');
  assert.equal(await button.count(),1);assert(await button.isVisible());
  const box=await button.boundingBox();assert(box.x>=0 && box.x+box.width<=width);
 }
 checks.push('Automatic bookmarks visible in the main toolbar at 900 and 1440px');
 await page.evaluate(()=>{window.__qa.S.dirty=false;window.__qa.S.flowDraftDirty=false;});
 await page.evaluate(async bytes=>window.__qa.loadPDF(new Uint8Array(bytes),'Punctuation.pdf'),Array.from(fs.readFileSync(path.join(out,'v12-punctuation.pdf'))));
 await action('flow-edit');await page.locator('.page-edit-hit').first().click();
 await page.waitForFunction(()=>/原始字位完成/.test(document.querySelector('#pe-status')?.textContent));
 const heights=await page.evaluate(()=>{
  const input=document.querySelector('.page-edit-input'),caret=document.querySelector('.page-edit-caret');
  return [0,input.value.length-1,input.value.length].map(n=>{input.setSelectionRange(n,n);input.dispatchEvent(new Event('select'));return caret.getBoundingClientRect().height;});
 });
 assert(heights.every(h=>h>10 && Math.abs(h-heights[0])<=1));
 checks.push('Real PDF punctuation caret matches body text before and after final period');
 await page.screenshot({path:path.join(out,'v12-p1-punctuation.png')});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'v12-ui-report.json'),JSON.stringify({checks,errors,browser:await browser.version()},null,2));console.log(JSON.stringify({checks,errors}));
})().catch(async e=>{console.error(e);if(page){console.error('page errors',errors);console.error('EDIT_STATUS',await page.locator('#pe-status').textContent().catch(()=>''));console.error('EDIT_MODEL',JSON.stringify(await page.evaluate(()=>window.__qa.S.flowEdit?.draft()).catch(()=>null)));await page.screenshot({path:path.join(out,'v12-ui-failure.png')});}process.exitCode=1}).finally(async()=>{await browser?.close();bridge.cancel();flow.close();await sourceStore.close()});


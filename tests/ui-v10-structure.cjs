// Full UI with real native services. No external document uploads.
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const {NativeBridge}=require('../native-bridge.cjs');const {FlowLayout}=require('../flow-layout.cjs');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/output');
const bridge=new NativeBridge(path.join(root,'native'),process.env.FOLIO_PYTHON||'python');
const layout=new FlowLayout(path.join(root,'native'),process.env.FOLIO_PYTHON||'python');
let browser,server,activePage;const errors=[],checks=[];
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.FOLIO_CHROMIUM,args:['--no-sandbox','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-domain-reliability','--no-first-run']});
 const page=activePage=await browser.newPage({viewport:{width:1536,height:1100}});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const request=route.request(),u=new URL(request.url());
  if(u.hostname!=='localhost')return route.abort();
  try {
   let body,type='application/json';
   if(request.method()==='POST') {
    const data=JSON.parse(request.postData());
    const result=u.pathname==='/__flow'?await layout.render(data):await bridge.run(data);
    if(result.bytes)result.bytes=Array.from(result.bytes);body=JSON.stringify(result);
   }else{
    const p=path.resolve(root,'src','.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
    if(!p.startsWith(path.join(root,'src')+path.sep))throw Error('path');
    body=fs.readFileSync(p);
    if(path.basename(p)==='app.mjs')body=Buffer.concat([body,Buffer.from('\nwindow.__qa={S,surface,loadPDF,savePDF,undo:actions.undo,redo:actions.redo,actions,closeModal};')]);
    type=({'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm'})[path.extname(p)]||'application/octet-stream';
   }
   await route.fulfill({status:200,contentType:type,body});
  }catch(e){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:e.message})});}
 });
 await page.addInitScript(()=>{
  const call=async(url,data)=>{const r=await fetch(url,{method:'POST',body:JSON.stringify(data)});const v=await r.json();if(v.error)throw Error(v.error);if(v.bytes)v.bytes=new Uint8Array(v.bytes);return v;};
  window.desktop={native:d=>call('/__native',{...d,...(d.bytes?{bytes:Array.from(d.bytes)}:{})}),flowLayout:d=>call('/__flow',d),setDirty(){},onClose(){},onNativeProgress(){},graphics:async()=>false,copyText:async()=>{},ocrJob:async()=>({})};
 });
 await page.goto('http://localhost');console.log('app loaded');await page.waitForFunction(()=>window.__qa);

 const bytes=Array.from(fs.readFileSync(path.join(out,'v9-fixture.pdf')));await page.evaluate(async bytes=>window.__qa.loadPDF(new Uint8Array(bytes),'Structure.pdf'),bytes);
 await page.locator('[data-action="flow-edit"]').click();await page.waitForSelector('.page-edit-hit');
 await page.locator('.page-edit-hit').evaluateAll(es=>es.find(e=>e.getAttribute('aria-label').startsWith('Left column paragraph.')).click());await page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成/.test(document.querySelector('#pe-status').textContent));
 await page.locator('#pe-more').click();await page.locator('.pe-structure summary').click();await page.locator('#pe-region-kind').selectOption('text');await page.locator('#pe-region-order').fill('2');await page.locator('#pe-structure-save').click();assert.equal(await page.evaluate(()=>window.__qa.S.structures.length),1);await page.locator('#pe-link').click();await page.locator('#pe-close-properties').click();await page.locator('.page-edit-hit').evaluateAll(es=>es.find(e=>e.getAttribute('aria-label').startsWith('Right column paragraph')).click());
 await page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成|草稿已保留/.test(document.querySelector('#pe-status').textContent));await page.locator('#pe-more').click();await page.waitForSelector('#pe-chain-list li');assert.equal(await page.locator('#pe-chain-list li').count(),2);await page.screenshot({path:path.join(out,'v10-structure-chain.png')});await page.locator('#pe-close-properties').click();await page.locator('#pe-done').click();
 // A bounded chain now keeps its draft when the joined text exceeds its frames.
 await page.waitForFunction(()=>!window.__qa.S.flowEdit || document.querySelector('#pe-status')?.textContent.includes('草稿已保留'));
 if(await page.evaluate(()=>!!window.__qa.S.flowEdit)) {
  await page.locator('#pe-overflow').click();
  await page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成/.test(document.querySelector('#pe-status')?.textContent));
  await page.locator('#pe-done').click();
 }
 await page.waitForFunction(()=>!window.__qa.S.flowEdit);assert.equal(await page.evaluate(()=>window.__qa.S.nativeEdits.find(e=>e.model?.frames)?.model.frames.length),2);
 const saved=await page.evaluate(async()=>{const {encodeProject,decodeProject}=await import('./project.mjs');const S=window.__qa.S;return (await decodeProject(await encodeProject(S.bytes,S.name,{nodes:S.nodes,nativeEdits:S.nativeEdits,ocr:S.ocr,annotations:S.annotations,structures:S.structures,rotation:S.rotation}))).state;});assert.equal(saved.structures.length,1);assert.equal(saved.nativeEdits[0].model.frames.length,2);checks.push('Manual structure and explicit same-page frame chain persist through project encode/decode');
 await page.evaluate(()=>window.__qa.undo());assert.equal(await page.evaluate(()=>window.__qa.S.nativeEdits.length),0);checks.push('Whole chain change reverses atomically');assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'v10-structure-ui-report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
})().catch(async e=>{console.error(e);if(activePage){console.error('ERRORS',errors);console.error('STATUS',await activePage.locator('#pe-status').textContent().catch(()=>''));await activePage.screenshot({path:path.join(out,'v10-structure-failure.png')});}process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();bridge.cancel();layout.close();});

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
    if(p.endsWith('/app.mjs'))body=Buffer.concat([body,Buffer.from('\nwindow.__qa={S,surface,loadPDF,savePDF,undo:actions.undo,redo:actions.redo,actions,closeModal};')]);
    type=({'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm'})[path.extname(p)]||'application/octet-stream';
   }
   await route.fulfill({status:200,contentType:type,body});
  }catch(e){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:e.message})});}
 });
 await page.addInitScript(()=>{
  const call=async(url,data)=>{const r=await fetch(url,{method:'POST',body:JSON.stringify(data)});const v=await r.json();if(v.error)throw Error(v.error);if(v.bytes)v.bytes=new Uint8Array(v.bytes);return v;};
  window.desktop={native:d=>call('/__native',{...d,bytes:Array.from(d.bytes)}),flowLayout:d=>call('/__flow',d),setDirty(){},onClose(){},onNativeProgress(){},graphics:async()=>false,copyText:async()=>{},ocrJob:async()=>({})};
 });
 await page.goto('http://localhost');console.log('app loaded');await page.waitForFunction(()=>window.__qa);
 const filename=process.env.FOLIO_YEARBOOK;
 const bytes=Array.from(fs.readFileSync(filename));
 await page.evaluate(async(bytes)=>{await window.__qa.loadPDF(new Uint8Array(bytes),'巍山年鉴 · 编辑验证.pdf');await window.__qa.surface.go(1);},bytes);


 await page.evaluate(async()=>{await window.__qa.surface.go(14);await window.__qa.surface.zoom('1');});
 await page.locator('[data-action="flow-edit"]').click();
 await page.waitForSelector('.page-edit-hit');
 await page.waitForFunction(()=>/已识别版面/.test(document.querySelector('#pe-status')?.textContent||''));
 console.log('NORMAL',await page.evaluate(()=>({page:__qa.S.page,session:__qa.S.flowEdit?.page,hits:document.querySelectorAll('.page-edit-hit').length,frameHidden:document.querySelector('.page-edit-frame')?.hidden,status:document.querySelector('#pe-status')?.textContent})));
 await page.locator('.page-edit-hit[aria-label^="以下为结构评论"]').click();
 await page.waitForFunction(()=>/自动重排完成/.test(document.querySelector('#pe-status')?.textContent||''));
 console.log('CLICK',await page.evaluate(()=>({page:__qa.S.page,frameHidden:document.querySelector('.page-edit-frame')?.hidden,status:document.querySelector('#pe-status')?.textContent,fallback:document.querySelector('#pe-fallback')?.textContent})));
 await page.locator('#pe-done').click();
 await page.waitForFunction(()=>!window.__qa.S.flowEdit);
 await page.evaluate(()=>{const original=window.desktop.native;window.__inspectStarted=false;window.desktop.native=async d=>{if(d.command==='inspect'){window.__inspectStarted=true;await new Promise(r=>setTimeout(r,800));}return original(d);};});
 await page.locator('[data-action="flow-edit"]').click();
 await page.waitForFunction(()=>window.__inspectStarted);
 await page.evaluate(async()=>{await window.__qa.surface.go(2);});
 await page.waitForFunction(()=>window.__qa.S.flowEdit);
 console.log('RACE',await page.evaluate(()=>({page:__qa.S.page,session:__qa.S.flowEdit?.page,hits:document.querySelectorAll('.page-edit-hit').length,status:document.querySelector('#pe-status')?.textContent})));
 console.log('ERRORS',errors);

})().catch(async e=>{console.error(e);if(activePage){console.error('STATUS',await activePage.locator('#pe-status').textContent().catch(()=>''));console.error(errors);await activePage.screenshot({path:path.join(out,'v9-yearbook-failure.png')});}process.exitCode=1;}).finally(async()=>{await browser?.close();bridge.cancel();layout.close();});

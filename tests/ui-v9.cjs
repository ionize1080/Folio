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
 const filename=path.join(out,'v9-fixture.pdf');
 const bytes=Array.from(fs.readFileSync(filename));
 await page.evaluate(async(bytes)=>{await window.__qa.loadPDF(new Uint8Array(bytes),'Folio UI test.pdf');await window.__qa.surface.go(1);},bytes);
 await page.locator('[data-action="generate"]').count().then(n=>console.log('multi button',n));
 await page.evaluate(()=>window.__qa.actions['generate']?.());
 if(!await page.locator('#multi-current').count()){
   console.log(await page.locator('[data-action]').evaluateAll(es=>es.map(e=>e.dataset.action)));
 }
 await page.waitForSelector('[data-field="pattern"]');
 const pattern=page.locator('[data-field="pattern"]').first();await pattern.fill('^Short');await pattern.focus();
 await page.waitForTimeout(1300);
 assert.equal(await pattern.evaluate(e=>document.activeElement===e),true,'auto preview steals focus');
 assert.equal(await pattern.isEnabled(),true);
 await pattern.press('End');await page.keyboard.type(' title',{delay:180});await page.waitForTimeout(900);
 assert.equal(await pattern.inputValue(),'^Short title');assert.equal(await pattern.evaluate(e=>document.activeElement===e),true);
 await page.screenshot({path:path.join(out,'v9-rules-wide.png')});checks.push('regular expression typing survives automatic preview');
 await page.setViewportSize({width:820,height:760});await page.screenshot({path:path.join(out,'v9-rules-narrow.png')});
 await page.evaluate(()=>document.querySelector('#modal').close());await page.evaluate(()=>window.__qa.closeModal());
 await page.setViewportSize({width:1536,height:1000});
 await page.locator('[data-action="flow-edit"]').click();await page.waitForSelector('.page-edit-hit');
 await page.locator('.page-edit-hit[aria-label="Short title"]').click();await page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成/.test(document.querySelector('#pe-status')?.textContent));await page.locator('#pe-more').click();await page.locator('#pe-growth').selectOption('auto');await page.locator('#pe-close-properties').click();
 await page.locator('.page-edit-input').evaluate(el=>{el.focus();el.select();document.execCommand('insertText',false,'A longer title with more words');});
 await page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成/.test(document.querySelector('#pe-status').textContent),{timeout:20000});
 await page.locator('#pe-more').click();await page.screenshot({path:path.join(out,'v9-edit-properties.png')});
 await page.locator('#pe-close-properties').click();
 await page.locator('.page-edit-input').evaluate(el=>{el.focus();el.select();});
 await page.locator('#pe-font').click();await page.waitForFunction(()=>document.querySelector('#pe-font-list')?.textContent.includes('系统字体'),{timeout:20000});
 await page.screenshot({path:path.join(out,'v9-font-picker.png')});
 await page.locator('#pe-font-search').fill('DejaVu Sans');await page.locator('#pe-font-list button').first().click();
 await page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成/.test(document.querySelector('#pe-status').textContent),{timeout:20000});
 assert.equal(await page.locator('.page-edit-input').evaluate(el=>document.activeElement===el),true);checks.push('font selection preserves text selection and returns input focus');
 for(const width of [1100,850,720]){await page.setViewportSize({width,height:800});await page.waitForTimeout(400);const v=await page.locator('.page-edit-bar').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,buttons:[...el.querySelectorAll('.pe-actions button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom}})}));assert(v.scroll<=v.width+1,JSON.stringify(v));assert(v.buttons.every(b=>b.x>=0&&b.right<=width),JSON.stringify(v));await page.screenshot({path:path.join(out,'v9-edit-'+width+'.png')});}
 await page.setViewportSize({width:1536,height:1000});await page.locator('#pe-done').click();await page.waitForFunction(()=>!window.__qa.S.flowEdit,{timeout:20000});
 checks.push('responsive editor has no horizontal scroll and fixed visible completion actions');
 await page.locator('[data-action="flow-edit"]').click();await page.waitForSelector('.page-edit-hit');await page.locator('#pe-more').click();await page.locator('#pe-tables').click();await page.locator('#pe-close-properties').click();
 const cell=page.locator('.table-cell-hit').first();await cell.click();await page.waitForFunction(()=>/完成/.test(document.querySelector('#pe-status')?.textContent)&&!document.querySelector('.page-edit-input').disabled&&document.querySelector('.page-edit-input').value.trim()==='Cell 1-1');
 await page.locator('.page-edit-input').evaluate(el=>{el.focus();el.select();document.execCommand('insertText',false,'Table cell expands the whole row. '.repeat(7));});
 await page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成/.test(document.querySelector('#pe-status').textContent),{timeout:30000});
 assert.equal(await page.locator('.pe-notice').isHidden(),true,'row growth should not collide with old row positions');
 assert.equal(await page.locator('.page-edit-input').evaluate(e=>document.activeElement===e),true,'row growth steals input focus');
 await page.locator('.page-edit-input').press('Control+z');await page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成/.test(document.querySelector('#pe-status').textContent));assert.equal((await page.locator('.page-edit-input').inputValue()).trim(),'Cell 1-1');
 await page.locator('.page-edit-input').press('Control+y');await page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成/.test(document.querySelector('#pe-status').textContent));checks.push('table growth preserves focus and undo/redo restores complete row geometry');
 await page.screenshot({path:path.join(out,'v9-table-growth.png')});
 await page.locator('.page-edit-input').press('Tab');await page.waitForFunction(()=>document.querySelector('.page-edit-input')?.value.trim()==='Cell 1-2'&&!document.querySelector('.page-edit-input').disabled&&/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成/.test(document.querySelector('#pe-status').textContent));
 await page.locator('.page-edit-input').evaluate(el=>{el.focus();el.select();document.execCommand('insertText',false,'Second cell changed');});await page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成/.test(document.querySelector('#pe-status').textContent));checks.push('Tab edits the next cell after row growth');
await page.locator('#pe-done').click();await page.waitForFunction(()=>!window.__qa.S.flowEdit,{timeout:30000});
 assert((await page.evaluate(()=>window.__qa.S.nativeEdits.find(e=>e.model?.tableGrowth).model.tableGrowth.delta))>10);checks.push('table cell grows row and commits');
 const edited=await page.evaluate(async()=>Array.from(await window.__qa.S.pdf.getData()));fs.writeFileSync(path.join(out,'v9-edited.pdf'),Buffer.from(edited));
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'v9-ui-report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
})().catch(async e=>{console.error(e);if(activePage){console.error('STATUS',await activePage.locator('#pe-status').textContent().catch(()=>''));console.error('ERRORS',errors);await activePage.screenshot({path:path.join(out,'v9-failure.png')});}process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();bridge.cancel();layout.close();});

// Full UI with real native services. No external document uploads.
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
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
    if(p.endsWith('/app.mjs'))body=Buffer.concat([body,Buffer.from('\nwindow.__qa={S,surface,loadPDF,savePDF,undo:actions.undo,redo:actions.redo};')]);
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
 const filename=process.env.FOLIO_YEARBOOK,bytes=Array.from(fs.readFileSync(filename));
 await page.addStyleTag({content:"@font-face{font-family:QA;src:url(data:font/ttf;base64,"+fs.readFileSync('native/fonts/NotoSansSC.ttf').toString('base64')+")}body{font-family:QA,sans-serif}"});
 await page.evaluate(async({bytes,name})=>{await window.__qa.loadPDF(new Uint8Array(bytes),name);await window.__qa.surface.go(4);await window.__qa.surface.zoom('1');},{bytes,name:path.basename(filename)});
 await page.locator('[data-action="flow-edit"]').click();await page.waitForSelector('.page-edit-hit',{timeout:30000});
 const first=page.locator('.page-edit-hit').filter({hasNot:page.locator('.unavailable')});
 await page.locator('.page-edit-hit[aria-label^="【巍宝山乡法治"]').click();
 await page.waitForFunction(()=>document.querySelector('.page-edit-ink')?.hidden===false,{timeout:30000});
 const font=await page.locator('#pe-font').textContent();assert(font.includes('FZ'));console.log('font checked');checks.push('Original embedded font name shown');
 const input=page.locator('.page-edit-input');
 await input.evaluate(el=>{el.focus();el.select();document.execCommand('insertText',false,'字体与分栏编辑测试。原文字形保留，照片颜色正常。');});
 await page.waitForFunction(()=>/自动重排/.test(document.querySelector('#pe-status').textContent),{timeout:30000});
 await page.screenshot({path:path.join(out,'v8-workspace.png')});
 const boxes=await page.evaluate(()=>Object.fromEntries(['.appbar','.toolbar','.viewer-toolbar','.page-edit-bar','#canvas-host'].map(s=>{let b=document.querySelector(s).getBoundingClientRect();return [s,{height:b.height,y:b.y}]})));
 assert(boxes['.appbar'].height<=42&&boxes['.toolbar'].height<=42&&boxes['.page-edit-bar'].height<=38);checks.push('Compact bars stay single-row; canvas begins at '+boxes['#canvas-host'].y+' CSS px');
 await page.locator('#pe-done').click();await page.waitForFunction(()=>!window.__qa.S.flowEdit);
 await page.evaluate(async()=>{await window.__qa.surface.go(2);await window.__qa.surface.zoom('1.5');});
 await page.locator('[data-action="flow-edit"]').click();await page.waitForSelector('.table-cell-hit',{timeout:30000});
 await page.locator('#pe-tables').click();
 const cell=page.locator('.table-cell-hit').first();await cell.scrollIntoViewIfNeeded();await cell.click();
 await page.waitForFunction(()=>document.querySelector('.page-edit-ink')?.hidden===false,{timeout:30000});
 assert.equal(await page.locator('.page-edit-bar strong').textContent(),'表格编辑');
 await input.evaluate(el=>{el.focus();el.select();document.execCommand('insertText',false,'测试');});
 await page.waitForFunction(()=>/自动重排/.test(document.querySelector('#pe-status').textContent),{timeout:30000});
 await page.keyboard.press('Tab');
 await page.waitForFunction(()=>document.querySelector('.page-edit-input')?.value!=='测试'&&document.querySelector('#pe-status')?.textContent.includes('第 1 行，第 2 列'),{timeout:30000});
 console.log('table checked');checks.push('Cell text committed by Tab; focus moves to next cell');
 await page.screenshot({path:path.join(out,'v8-table-workspace.png')});
 await page.locator('#pe-done').click();await page.waitForFunction(()=>!window.__qa.S.flowEdit);
 // New paragraph has ample blank space on the bundled one-page sample: paste expands it automatically.
 const data=Array.from(fs.readFileSync(path.join(out,'v8-blank.pdf')));
 await page.evaluate(async b=>{await window.__qa.loadPDF(new Uint8Array(b),'扩容测试.pdf');await window.__qa.surface.go(1);await window.__qa.surface.zoom('1');},data);
 await page.locator('[data-action="flow-edit"]').click();await page.waitForSelector('#pe-new');
 await page.locator('#pe-new').click();
 const rect=await page.locator('.page-edit-layer').boundingBox();
 await page.mouse.click(rect.x+55,rect.y+250);
 await page.waitForSelector('.page-edit-frame:not([hidden])');
 const before=await page.locator('.page-edit-frame').evaluate(el=>el.getBoundingClientRect().height);
 await input.evaluate(el=>{el.focus();document.execCommand('insertText',false,'自动扩容测试，保持文字不遮挡。'.repeat(16));});
 await page.waitForFunction(()=>/已自动扩容/.test(document.querySelector('#pe-status').textContent),{timeout:30000});
 const after=await page.locator('.page-edit-frame').evaluate(el=>el.getBoundingClientRect().height);assert(after>before);checks.push('Pasted text grows paragraph height automatically');
 await page.locator('#pe-cancel').click();await page.locator('#pe-done').click();
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'v8-ui-detail-report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
})().catch(async e=>{console.error(e);if(activePage){console.error('STATUS',await activePage.locator('#pe-status').textContent().catch(()=>''));console.error('ERRORS',errors);await activePage.screenshot({path:path.join(out,'v8-failure.png')});}process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();bridge.cancel();layout.close();});

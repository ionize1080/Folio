// Full UI with real native services. No external document uploads.
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
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
  window.desktop={native:d=>call('/__native',{...d,...(d.bytes?{bytes:Array.from(d.bytes)}:{})}),flowLayout:d=>call('/__flow',d),setDirty(){},onClose(){},onNativeProgress(){},graphics:async()=>false,copyText:async()=>{},ocrJob:async()=>({})};
 });
 await page.goto('http://localhost');console.log('app loaded');await page.waitForFunction(()=>window.__qa);
 const files=JSON.parse(process.env.FOLIO_TEST_FILES||'[]');
 for(const filename of files){
  const bytes=Array.from(fs.readFileSync(filename));
  await page.evaluate(async({bytes,name})=>{await window.__qa.loadPDF(new Uint8Array(bytes),name);await window.__qa.surface.go(4);},{bytes,name:path.basename(filename)});
  await page.locator('[data-action="flow-edit"]').click();await page.waitForSelector('.page-edit-hit',{timeout:30000});
  assert.equal(await page.locator('#modal').evaluate(e=>e.open),false);checks.push(path.basename(filename)+': on-page mode, no dialog');console.log('edit mode');
  const firstIndex=await page.locator('.page-edit-hit').evaluateAll(es=>es.findIndex(e=>!e.classList.contains('unavailable')&&e.getAttribute('aria-label').length>65));
  const first=page.locator('.page-edit-hit').nth(firstIndex);
  await first.click();console.log('activated');await page.waitForFunction(()=>!document.querySelector('.page-edit-ink').hidden,{timeout:30000});
  const original=await page.locator('.page-edit-input').inputValue();
  // Shorten to ensure no overflow; native clipboard-style insertion is plain text.
  const text='页面内重排测试：00123.45，3.50%。中文段落直接编辑。';
  await page.locator('.page-edit-input').evaluate((el,text)=>{el.focus();el.select();document.execCommand('insertText',false,text);},text);
  await page.waitForFunction(()=>/自动重排/.test(document.querySelector('#pe-status').textContent),{timeout:15000});
  await page.keyboard.press('Control+z');assert.equal(await page.locator('.page-edit-input').inputValue(),original);
  await page.keyboard.press('Control+y');assert.equal(await page.locator('.page-edit-input').inputValue(),text);
  await page.waitForFunction(()=>/自动重排/.test(document.querySelector('#pe-status').textContent),{timeout:15000});
  // Zoom recreates page shells; input and selection must survive the move.
  await page.evaluate(async()=>{await window.__qa.surface.zoom('1.75');});
  await page.waitForFunction(()=>document.activeElement===document.querySelector('.page-edit-input'));
  assert.equal(await page.locator('.page-edit-input').inputValue(),text);
  checks.push(path.basename(filename)+': zoom preserves the active input');
  // IME event lifecycle plus real input value change. Actual Windows IME still needs manual QA.
  await page.locator('.page-edit-input').evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{data:'',bubbles:true}));el.dispatchEvent(new CompositionEvent('compositionupdate',{data:'测试',bubbles:true}));});
  assert.equal(await page.locator('.page-edit-composition').textContent(),'测试');
  await page.locator('.page-edit-input').evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{data:'',bubbles:true})));
  await page.waitForFunction(()=>/自动重排/.test(document.querySelector('#pe-status').textContent),{timeout:15000});
  await page.screenshot({path:path.join(out,'v8-'+(filename.includes('中国')?'monetary':filename.includes('绿色')?'green':'qdii')+'-editing.png')});
  await page.locator('#pe-done').click();await page.waitForFunction(()=>!window.__qa.S.flowEdit,{timeout:30000});
  const edited=await page.evaluate(async()=>Array.from(await window.__qa.S.pdf.getData()));fs.writeFileSync(path.join(out,'v8-'+(filename.includes('中国')?'monetary':filename.includes('绿色')?'green':'qdii')+'-edited.pdf'),Buffer.from(edited));
  assert.equal(await page.evaluate(()=>window.__qa.S.nativeEdits.at(-1).model.text),text);
  checks.push(path.basename(filename)+': native edit, undo/redo, IME lifecycle, exact fragment commit');
  await page.evaluate(()=>window.__qa.undo());await page.waitForFunction(()=>window.__qa.S.nativeEdits.length===0);
  await page.evaluate(()=>window.__qa.redo());await page.waitForFunction(()=>window.__qa.S.nativeEdits.length===1);
  await page.locator('[data-action="flow-edit"]').click();await page.waitForSelector('.page-edit-hit');
  const existing=page.locator('.page-edit-hit[aria-label^="页面内重排测试"]');await existing.click();
  await page.waitForFunction(()=>!document.querySelector('.page-edit-ink').hidden);
  assert.equal(await page.locator('.page-edit-input').inputValue(),text);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.page-edit-ink').isVisible(),false);
  await page.locator('#pe-done').click();checks.push(path.basename(filename)+': document undo/redo and continued editing');
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'v8-ui-report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
})().catch(async e=>{console.error(e);if(activePage){console.error('STATUS',await activePage.locator('#pe-status').textContent().catch(()=>''));console.error('ERRORS',errors);await activePage.screenshot({path:path.join(out,'v8-failure.png')});}process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();bridge.cancel();layout.close();});

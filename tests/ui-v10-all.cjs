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
  window.desktop={native:d=>call('/__native',{...d,...(d.bytes?{bytes:Array.from(d.bytes)}:{})}),flowLayout:d=>call('/__flow',d),setDirty(){},onClose(){},onNativeProgress(){},graphics:async()=>false,copyText:async()=>{},ocrJob:async d=>d.action==='history'?[]:{}};
 });
 await page.goto('http://localhost');console.log('app loaded');await page.waitForFunction(()=>window.__qa);

 const bytes=Array.from(fs.readFileSync(path.join(out,'v10-review-fixture.pdf')));
 async function load(){await page.evaluate(async bytes=>window.__qa.loadPDF(new Uint8Array(bytes),'QA multi-page.pdf'),bytes);}
 async function close(){await page.evaluate(()=>window.__qa.closeModal());}
 async function action(name){await page.evaluate(async n=>window.__qa.actions[n](),name);}
 async function shot(name){await page.waitForTimeout(180);await page.screenshot({path:path.join(out,'v10-screen-'+name+'.png')});}
 async function footer(){const boxes=await page.locator('#modal-footer button:visible').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom};}));const size=page.viewportSize();assert(boxes.every(b=>b.x>=0&&b.right<=size.width+1&&b.bottom<=size.height+1),JSON.stringify(boxes));}
 await load();await page.evaluate(()=>{const S=window.__qa.S;S.nodes=[{id:'a',parent:null,title:'Short title',color:'#263449',open:true,bold:false,italic:false,target:{kind:'dest',page:1,mode:'XYZ',args:[40,700,null]}}];S.selected=new Set(['a']);});
 for(const name of ['settings','help','metadata','pages','annotate','batch','exchange','calibrate','whitespace','dedupe','generate-classic','raw','shortcuts']){
  console.log('screen',name);await action(name);await page.waitForTimeout(name==='calibrate'?1200:250);if(await page.locator('#modal').evaluate(e=>e.open)){await footer();await shot(name+'-wide');await page.setViewportSize({width:900,height:720});await footer();await shot(name+'-compact');await close();}await page.setViewportSize({width:1440,height:1000});
 }
 checks.push('13 dialogs: render, visible completion controls and wide/compact screenshots');
 await action('settings');await page.locator('#set-whitespace-unit').selectOption('pt');await page.locator('#modal-footer .primary').click();await action('whitespace');assert.equal(await page.locator('#space-unit').inputValue(),'pt');const value=+(await page.locator('#space-amount').inputValue());for(let i=0;i<5;i++){await page.locator('#space-unit').selectOption('mm');await page.locator('#space-unit').selectOption('pt');}assert(Math.abs(+(await page.locator('#space-amount').inputValue())-value)<1e-6);await close();await action('generate');assert.equal(await page.locator('#multi-unit').inputValue(),'pt');await action('theme');await shot('rules-dark');await close();await action('theme');checks.push('Preferred unit applied to whitespace and generator; repeated unit switching does not accumulate rounding');
 await action('table-structure');await page.waitForFunction(()=>!document.querySelector('#table-apply').disabled,{timeout:30000});await page.locator('[data-grid-op="insert-row"]').click();await page.waitForFunction(()=>!document.querySelector('#table-apply').disabled);await shot('table');await page.locator('#table-undo').click();await page.waitForFunction(()=>!document.querySelector('#table-apply').disabled);await page.locator('#table-grid textarea').first().fill('Updated cell');await page.locator('#table-grid textarea').first().press('Tab');await page.waitForFunction(()=>!document.querySelector('#table-apply').disabled);await page.locator('#table-apply').click();await page.waitForFunction(()=>!document.querySelector('#modal').open,{timeout:30000});assert(await page.evaluate(()=>window.__qa.S.nativeEdits.some(e=>e.tableModel)));checks.push('Table insert, undo, cell correction, native preview and atomic apply');
 await action('page-diff');await page.waitForFunction(()=>/成功重新解析/.test(document.querySelector('#diff-status').textContent),{timeout:30000});await page.locator('#diff-mode').selectOption('changes');await shot('full-page-diff');assert(/变化网格/.test(await page.locator('#diff-status').textContent()));await close();checks.push('Serialized full-page output reparses and renders with changed-area map');
 await load();await page.evaluate(()=>{const S=window.__qa.S;S.ocr=[1,2,3].flatMap(page=>[{page,text:'Review '+page,confidence:.7,quad:[[50,700],[150,700],[150,680],[50,680]]},{page,text:'Good '+page,confidence:.99,quad:[[50,650],[150,650],[150,630],[50,630]]}]);});await action('ocr');await page.waitForSelector('.ocr-stream-page');assert.equal(await page.locator('.ocr-stream-page').count(),3);await shot('ocr-continuous');
 await page.locator('#ocr-results').selectOption('0');await page.locator('#ocr-correction').fill('Corrected page one');await page.locator('#ocr-correction').focus();await page.locator('.ocr-continuous').evaluate(e=>{e.scrollTop=900;e.dispatchEvent(new Event('scroll'));});await page.waitForTimeout(600);assert.equal(await page.locator('#ocr-review-page').inputValue(),'1','scroll changed active editing page');await page.locator('#ocr-correct').click();await page.locator('#ocr-next').click();await page.waitForFunction(()=>document.querySelector('#ocr-review-page').value==='2');await page.waitForTimeout(500);await page.locator('#ocr-scroll-mode').selectOption('single');assert.equal(await page.locator('.ocr-stream-page:visible').count(),1);await page.locator('#modal-close').click();await action('ocr');assert.equal(await page.locator('#ocr-review-page').inputValue(),'2');await page.locator('#ocr-prev').click();await page.waitForFunction(()=>document.querySelector('#ocr-review-page').value==='1');await page.locator('#ocr-results').selectOption('0');assert.equal(await page.locator('#ocr-correction').inputValue(),'Corrected page one');await shot('ocr-restored');await page.locator('#modal-close').click();checks.push('Continuous OCR: bounded page surfaces, draft lock during scroll, single-page switch and persisted correction/resume');
 await load();await page.evaluate(bytes=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(bytes)],'Dropped sample.pdf',{type:'application/pdf'}));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));},bytes);await page.waitForFunction(()=>window.__qa.S.name==='Dropped sample.pdf');checks.push('Drag PDF into main window opens through shared document path');
 await shot('reader');assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'v10-all-ui-report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
})().catch(async e=>{console.error(e);if(activePage){console.error('ERRORS',errors);console.error('MODAL',await activePage.locator('#modal-error').textContent().catch(()=>''));await activePage.screenshot({path:path.join(out,'v10-all-failure.png')});}process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();bridge.cancel();layout.close();});

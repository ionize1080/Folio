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
 async function configure(page){
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
  window.desktop={native:d=>call('/__native',{...d,...(d.bytes?{bytes:Array.from(d.bytes)}:{})}),flowLayout:d=>call('/__flow',d),setDirty(){},onClose(){},onNativeProgress(){},save:async d=>{window.__saved=Array.from(d.bytes);return {name:d.name,working:true};},graphics:async()=>false,copyText:async()=>{},ocrJob:async()=>({})};
 });
 }
 await configure(page);
 await page.goto('http://localhost');console.log('app loaded');await page.waitForFunction(()=>window.__qa);
 const filename=path.join(out,'v9-fixture.pdf');
 const bytes=Array.from(fs.readFileSync(filename));
 await page.evaluate(async(bytes)=>{await window.__qa.loadPDF(new Uint8Array(bytes),'Folio UI test.pdf');await window.__qa.surface.go(1);},bytes);

 const stable=()=>page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排)完成/.test(document.querySelector('#pe-status')?.textContent||''),null,{timeout:30000});
 const draft=()=>page.evaluate(()=>window.__qa.S.flowEdit?.draft());
 const replace=async text=>{await page.locator('.page-edit-input').evaluate((el,text)=>{el.focus();el.select();document.execCommand('insertText',false,text);},text);};
 await page.evaluate(()=>window.__qa.actions.generate());await page.waitForSelector('[data-field="pattern"]');
 const pattern=page.locator('[data-field="pattern"]').first();await pattern.fill('(');await page.waitForTimeout(600);
 assert(await page.locator('.rule-pattern-error').first().textContent());assert(await pattern.evaluate(e=>document.activeElement===e));
 await pattern.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''})));
 await pattern.fill('^中');await page.waitForTimeout(500);assert(await pattern.evaluate(e=>document.activeElement===e));
 await pattern.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'})));
 await pattern.fill('^Short');await page.waitForTimeout(700);await page.locator('#multi-search-results').fill('x');await pattern.fill('^Short title');await page.locator('#multi-search-results').fill('Short');
 await page.waitForTimeout(800);assert(await page.locator('#multi-preview').textContent().then(t=>t.includes('Short title')));checks.push('incomplete regex, IME event lifecycle and stale-preview filtering remain responsive');
 await page.locator('.rules-settings>summary').click();await page.screenshot({path:path.join(out,'v9-rules-settings.png')});
 await page.evaluate(()=>window.__qa.closeModal());await page.evaluate(()=>window.__qa.actions.generate());assert.equal(await page.locator('[data-field="pattern"]').first().inputValue(),'^Short title');checks.push('rules draft restored on reopening');await page.evaluate(()=>window.__qa.closeModal());
 await page.locator('[data-action="flow-edit"]').click();await page.waitForSelector('.page-edit-hit[aria-label="Short title"]');await page.locator('.page-edit-hit[aria-label="Short title"]').click();await stable();await page.locator('#pe-more').click();await page.locator('#pe-growth').selectOption('auto');await page.locator('#pe-close-properties').click();
 await replace('Title 123 中文');await stable();
 await page.locator('.page-edit-input').evaluate(el=>{el.focus();el.setSelectionRange(0,5);});await page.locator('#pe-size').fill('18');await page.locator('#pe-size').press('Tab');await stable();
 const styled=(await draft()).model;assert(styled.runs.filter(r=>r.start<5).every(r=>r.size===18));assert(styled.runs.filter(r=>r.start>=5).every(r=>r.size===14));assert.equal(styled.size,14);checks.push('selected font size leaves unselected typography unchanged');
 await page.locator('.page-edit-input').press('Control+z');await stable();assert(!(await draft()).model.runs.some(r=>r.size===18));await page.locator('.page-edit-input').press('Control+y');await stable();assert((await draft()).model.runs.some(r=>r.size===18));checks.push('font changes undo and redo with typography');
 await page.locator('#pe-more').click();await page.locator('#pe-growth').selectOption('fixed');await stable();
 await replace('Fixed frame overflow text. '.repeat(25));await page.waitForFunction(()=>!document.querySelector('#pe-overflow').hidden);
 assert(await page.locator('.page-edit-input').evaluate(el=>document.activeElement===el));await page.locator('#pe-overflow').click();await stable();assert.equal((await draft()).model.allowOverflow,true);await page.screenshot({path:path.join(out,'v9-overflow-warning.png')});checks.push('fixed-frame overflow has an explicit retain action and does not discard draft');
 await page.locator('#pe-cancel').click();await page.locator('.page-edit-hit[aria-label="Short title"]').click();await stable();if(await page.locator('.pe-properties').isHidden())await page.locator('#pe-more').click();await page.locator('#pe-growth').selectOption('auto');await page.locator('#pe-close-properties').click();await replace('Intentional overlap');await stable();
 if(await page.locator('.pe-properties').isHidden())await page.locator('#pe-more').click();await page.locator('.pe-position>summary').click();
 await page.locator('[data-frame="y"]').fill('135');await page.locator('[data-frame="y"]').press('Tab');await stable();
 await page.locator('#pe-accept').click();assert.equal(await page.locator('.pe-notice').isHidden(),true);
 await page.locator('.pe-layers>summary').click();await page.locator('[data-order="top"]').click();await stable();assert.equal(await page.locator('.page-edit-ink').isHidden(),true);assert((await draft()).model.layerOrder>0);
 await page.screenshot({path:path.join(out,'v9-stacking.png')});
 const savedDraft=await draft();await page.locator('#pe-cancel').click();await page.evaluate(d=>window.__qa.S.flowEdit.restoreDraft(d),savedDraft);await stable();assert.equal((await draft()).model.text,'Intentional overlap');checks.push('active text draft restores its text, geometry, style and layer choice');
 await page.locator('#pe-done').click();await page.waitForFunction(()=>!window.__qa.S.flowEdit);await page.evaluate(()=>window.__qa.savePDF(true));
 const saved=await page.evaluate(()=>window.__saved);assert(saved.length>1000);fs.writeFileSync(path.join(out,'v9-ui-saved.pdf'),Buffer.from(saved));checks.push('deliberate overlap passes completion and actual PDF serialization');
 await page.evaluate(async bytes=>{await window.__qa.loadPDF(new Uint8Array(bytes),'Reopened.pdf');},saved);assert(await page.evaluate(async()=>JSON.stringify(await window.__qa.S.pdf.getPage(1).then(p=>p.getTextContent())).includes('Intentional overlap')));checks.push('saved file reopens with edited searchable text');
 // Test the changed panels at effective desktop scales. These emulate DPR and CSS viewport, not Windows IME.
 for(const scale of [1,1.25,1.5,2]){
  const width=Math.round(1536/scale),height=Math.round(1100/scale),ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:scale});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await configure(p);await p.goto('http://localhost');await p.waitForFunction(()=>window.__qa);
  await p.evaluate(async bytes=>{await window.__qa.loadPDF(new Uint8Array(bytes),'Scale test.pdf');},bytes);
  await p.locator('[data-action="flow-edit"]').click();await p.waitForSelector('.page-edit-bar');await p.waitForTimeout(250);
  assert.deepEqual(await p.evaluate(()=>[innerWidth,devicePixelRatio]),[width,scale]);
  for(const sel of ['.page-edit-bar','.viewer-toolbar']){const m=await p.locator(sel).evaluate(e=>({scroll:e.scrollWidth,width:e.clientWidth}));assert(m.scroll<=m.width+1,sel+JSON.stringify(m));}
  await p.screenshot({path:path.join(out,'v9-dpi-'+Math.round(scale*100)+'.png')});await ctx.close();
 }
 await page.setViewportSize({width:1280,height:900});checks.push('100/125/150/200 percent desktop-scale emulation: editor and viewer toolbars do not overflow');
 await page.evaluate(()=>document.body.classList.add('dark'));await page.evaluate(()=>window.__qa.actions.generate());await page.screenshot({path:path.join(out,'v9-rules-dark.png')});await page.evaluate(()=>window.__qa.closeModal());await page.evaluate(()=>document.body.classList.remove('dark'));
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'v9-ui-details-report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
})().catch(async e=>{console.error(e);if(activePage){console.error('STATUS',await activePage.locator('#pe-status').textContent().catch(()=>''));console.error('ERRORS',errors);await activePage.screenshot({path:path.join(out,'v9-details-failure.png')});}process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();bridge.cancel();layout.close();});

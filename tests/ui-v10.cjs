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

 async function load(name){const file=path.resolve(process.env.FOLIO_FIXTURES||path.join(root,'../upload'),name);const bytes=Array.from(fs.readFileSync(file));await page.evaluate(async({bytes,name})=>{await window.__qa.loadPDF(new Uint8Array(bytes),name);},{bytes,name});}
 async function close(){await page.evaluate(()=>window.__qa.closeModal());}
 await load('20_WD_2025002892_国民经济行业分类-original.pdf');
 const lines=await page.evaluate(async()=>{const {extractLines}=await import('./text-lines.mjs');return extractLines(window.__qa.S.pdf,12,0,{visualRows:true});});
 fs.writeFileSync(path.join(out,'v10-industry-lines.json'),JSON.stringify(lines,null,2));
 assert(lines.some(l=>/^017\s/.test(l.text)&&l.text.includes('中药材种植')),'017 missing name');assert(lines.some(l=>/^019\s/.test(l.text)&&l.text.includes('其他农作物种植业')),'019 missing name');checks.push('Original PDF page 12: 017 and 019 retain full names using generic geometry');
 await page.evaluate(()=>window.__qa.actions.generate());await page.waitForSelector('#multi-range');
 await page.locator('#multi-range').fill('11-13');await page.locator('[data-field="pattern"]').first().fill('^017');await page.waitForTimeout(1000);
 await page.locator('#multi-current').click();await page.waitForTimeout(1000);assert(await page.locator('#multi-apply').isDisabled(),'current-page preview incorrectly authorizes all scope');
 await close();await page.evaluate(()=>window.__qa.actions.generate());assert.equal(await page.locator('#multi-range').inputValue(),'11-13');
 for(const width of [1440,1000,820]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(out,'v10-rules-'+width+'.png')});assert(await page.locator('#multi-range').isVisible());const b=await page.locator('#multi-apply').boundingBox();assert(b.x>=0&&b.x+b.width<=width);}
 checks.push('Scope restored per document; current-page testing cannot apply stale multi-page scope; actions visible at 820/1000/1440px');await close();
 await page.setViewportSize({width:1440,height:1000});
 await load('QDII额度与纳指标普产品比较_20260831(1).pdf');await page.evaluate(()=>window.__qa.surface.go(14));
 await page.locator('[data-action="flow-edit"]').click();await page.waitForSelector('.page-edit-hit',{timeout:30000});
 const candidates=await page.locator('.page-edit-hit').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')));assert(candidates.length>0);fs.writeFileSync(path.join(out,'v10-page14-candidates.json'),JSON.stringify(candidates,null,2));
 const hit=page.locator('.page-edit-hit').filter({hasText:''}).first();await hit.click();await page.waitForFunction(()=>!document.querySelector('.page-edit-input').disabled && !document.querySelector('.page-edit-frame').hidden,{timeout:30000});
 await page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成/.test(document.querySelector('#pe-status').textContent),{timeout:30000});
 const status=await page.locator('#pe-status').textContent();fs.writeFileSync(path.join(out,'v10-page14-status.txt'),status);await page.screenshot({path:path.join(out,'v10-page14-edit.png')});
 checks.push('QDII page 14 opens editor with visible frame, native glyph preview and completed layout');await page.locator('#pe-done').click();
 await page.waitForFunction(()=>!window.__qa.S.flowEdit);await page.evaluate(()=>window.__qa.surface.go(2));await page.locator('[data-action="flow-edit"]').click();await page.waitForSelector('.page-edit-hit');
 const long=await page.locator('.page-edit-hit').evaluateAll(es=>es.map(e=>({t:e.getAttribute('aria-label'),len:e.getAttribute('aria-label').length})).sort((a,b)=>b.len-a.len)[0]);
 await page.locator('.page-edit-hit').filter({}).evaluateAll((es,t)=>es.find(e=>e.getAttribute('aria-label')===t).click(),long.t);
 await page.waitForFunction(()=>/(?:自动重排|段落重排|原始字位|局部行重排|快速排版)完成/.test(document.querySelector('#pe-status').textContent),{timeout:30000});
 assert(await page.locator('#pe-fallback').isHidden(),'original font unexpectedly substituted');await page.locator('#pe-font').click();await page.waitForFunction(()=>document.querySelector('#pe-font-list').children.length>1);await page.screenshot({path:path.join(out,'v10-font-picker.png')});
 checks.push('QDII page 2 original embedded font is reused without whole-paragraph fallback');await page.locator('#pe-close-font').click();await page.locator('#pe-done').click();
 await page.evaluate(()=>{const S=window.__qa.S;S.nodes=[{id:'split-source',parent:null,title:'第一章：绪论；主题：基础',open:true,bold:false,italic:false,color:'#000000',target:{kind:'dest',page:2,mode:'XYZ',args:[20,700,null]}}];S.selected=new Set(['split-source']);window.__qa.actions['split-bookmark']();});
 await page.waitForSelector('#split-mode');await page.locator('#split-mode').selectOption('hierarchy');await page.locator('#split-output').selectOption('template');await page.locator('[data-key="pattern"]').first().fill('^(第一章)');await page.locator('[data-key="template"]').first().fill('$1');await page.locator('#split-add').click();await page.locator('[data-key="pattern"]').nth(1).fill('主题：(.*)$');await page.locator('[data-key="template"]').nth(1).fill('$1');
 await page.waitForFunction(()=>!document.querySelector('#split-apply').disabled);await page.screenshot({path:path.join(out,'v10-bookmark-split.png')});await page.locator('#split-apply').click();assert.deepEqual(await page.evaluate(()=>window.__qa.S.nodes.map(n=>n.title)),['第一章','基础']);await page.evaluate(()=>window.__qa.undo());assert.equal(await page.evaluate(()=>window.__qa.S.nodes[0].title),'第一章：绪论；主题：基础');checks.push('Independent regex hierarchy preview, apply and complete undo');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'v10-ui-report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
})().catch(async e=>{console.error(e);if(activePage){console.error('ERRORS',errors);console.error('STATUS',await activePage.locator('#pe-status').textContent().catch(()=>''));await activePage.screenshot({path:path.join(out,'v10-failure.png')});}process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();bridge.cancel();layout.close();});

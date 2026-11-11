const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeBridge}=require('../native-bridge.cjs'),{FlowLayout}=require('../flow-layout.cjs'),{SourceStore}=require('../source-store.cjs'),{FontWarmup}=require('../font-warmup.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/output'),python=process.env.FOLIO_PYTHON||path.join(root,'native/runtime/python.exe');
const sources=new SourceStore(),native=new NativeBridge(path.join(root,'native'),python,sources),fonts=new NativeBridge(path.join(root,'native'),python,sources),background=new NativeBridge(path.join(root,'native'),python,sources),flow=new FlowLayout(path.join(root,'native'),python),warm=new FontWarmup(path.join(root,'native'),python,sources);
const builtinFonts=new NativeBridge(path.join(root,'native'),python),matches=new NativeBridge(path.join(root,'native'),python);
const report={checks:[],requests:[],errors:[]},sample=process.env.FOLIO_EDIT_SAMPLE||path.join(out,'editing-260-tagged.pdf'),pageNumber=Number(process.env.FOLIO_EDIT_PAGE||1);
let browser,page,saved;
(async()=>{
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
  page=await browser.newPage({viewport:{width:1600,height:1100},locale:process.env.FOLIO_TEST_LOCALE||'en-US'});page.setDefaultTimeout(60000);
  const ready=()=>page.waitForFunction(()=>{
    const status=document.querySelector('#pe-status'),input=document.querySelector('.page-edit-input');
    return input && !input.disabled && !status?.classList.contains('error') && /完成|complete|ready/i.test(status?.textContent||'');
  });
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());if(u.hostname!=='localhost')return route.abort();
    try{
      let body,type='application/json';
      if(req.method()==='POST'){
        const d=JSON.parse(req.postData()),start=Date.now();let value;
        if(u.pathname==='/__register')value=await sources.register(new Uint8Array(d));
        else if(u.pathname==='/__release'){warm.forget(d);value=await sources.release(d);}
        else if(u.pathname==='/__save'){saved=Buffer.from(d.bytes);value={name:d.name,working:true};}
        else if(u.pathname==='/__flow')value=await warm.foregroundTask(()=>flow.render(d));
        else if(d.command==='font-warm-document')value=warm.add(d.sourceHandle,d.page);
        else if(d.command==='font-fast' && ['builtin-latin','builtin-cjk'].includes(d.fontKey))value=await builtinFonts.run(d);
        else value=await warm.foregroundTask(()=>(d.command==='font-recommend'?matches:d.command.startsWith('font-')?fonts:d.command==='flow-background'?background:native).run(d));
        if(value?.bytes)value.bytes=Array.from(value.bytes);body=JSON.stringify(value??true);report.requests.push({command:d.command||u.pathname,ms:Date.now()-start});
      }else{
        const file=path.resolve(root,'src','.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
        assert(file.startsWith(path.join(root,'src')+path.sep));body=fs.readFileSync(file);
        if(path.basename(file)==='app.mjs')body=Buffer.concat([body,Buffer.from('\nwindow.__qa={S,actions,loadPDF,savePDF,goPage};')]);
        type=({'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream';
      }
      await route.fulfill({status:200,contentType:type,body});
    }catch(e){report.errors.push(e.message);await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:e.message})});}
  });
  await page.addInitScript(()=>{
    const call=async(url,d)=>{const r=await fetch(url,{method:'POST',body:JSON.stringify(d)}),v=await r.json();if(v.error)throw Error(v.error);if(v.bytes)v.bytes=new Uint8Array(v.bytes);return v;};
    window.desktop={registerSource:b=>call('/__register',Array.from(b)),releaseSource:h=>call('/__release',h),native:d=>call('/__native',{...d,...(d.bytes?{bytes:Array.from(d.bytes)}:{})}),flowLayout:d=>call('/__flow',d),prepareSave:async()=>({ticket:'test'}),save:d=>call('/__save',{...d,bytes:Array.from(d.bytes)}),setDirty(){},onClose(){},onNativeProgress(){},graphics:async()=>false,copyText:async()=>{},ocrJob:async()=>[]};
  });
  await page.goto('http://localhost');await page.waitForFunction(()=>window.__qa);
  await page.evaluate(bytes=>window.__qa.loadPDF(new Uint8Array(bytes),'Editing regression.pdf'),Array.from(fs.readFileSync(sample)));
  await page.evaluate(n=>window.__qa.goPage(n),pageNumber);await page.evaluate(()=>window.__qa.actions['flow-edit']());
  await page.locator('.page-edit-hit[aria-label^="Adrian Day"]').first().click();
  const input=page.locator('.page-edit-input');
  await ready();
  const original=await input.inputValue();assert(original.startsWith('Adrian Day'));
  const changed=original.includes('下跌。')?original.replace('下跌。','下跌测试测试。'):original.replace('paragraph','paragraph edited');assert.notEqual(changed,original);
  await input.fill(changed);await ready();
  await page.screenshot({path:path.join(out,'editing-260-preview.png')});
  await page.locator('#pe-done').click();await page.waitForFunction(()=>!window.__qa.S.flowEdit);
  await page.evaluate(()=>window.__qa.savePDF());assert(saved?.length>0);fs.writeFileSync(path.join(out,'editing-260-ui-saved.pdf'),saved);
  report.checks.push('open, real paragraph selection, original A, input, finish editing and save');
  await page.evaluate(bytes=>window.__qa.loadPDF(new Uint8Array(bytes),'Reopened regression.pdf'),Array.from(saved));
  await page.evaluate(n=>window.__qa.goPage(n),pageNumber);await page.evaluate(()=>window.__qa.actions['flow-edit']());
  await page.locator('.page-edit-hit[aria-label^="Adrian Day"]').first().click();
  await ready();
  assert.equal((await input.inputValue()).replace(/\s/g,''),changed.replace(/\s/g,''));
  await page.screenshot({path:path.join(out,'editing-260-reopened.png')});
  report.checks.push('saved paragraph reopens as one editable unit with exact amended text');
  assert(report.requests.some(r=>r.command==='font-warm-document'));assert.equal(report.errors.length,0,JSON.stringify(report.errors));
  report.status='passed';report.browser=browser.version();report.locale=await page.evaluate(()=>document.documentElement.lang);report.sample=path.basename(sample);report.page=pageNumber;
})().catch(async e=>{
  report.status='failed';report.errors.push(e.stack);process.exitCode=1;
  report.uiState=await page?.evaluate(()=>({locale:document.documentElement.lang,status:document.querySelector('#pe-status')?.textContent,inputDisabled:document.querySelector('.page-edit-input')?.disabled})).catch(()=>null);
}).finally(async()=>{
  warm.close();native.cancel();fonts.cancel();builtinFonts.cancel();matches.cancel();background.cancel();flow.close();await browser?.close();await sources.close();
  fs.writeFileSync(path.join(out,'editing-260-ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});

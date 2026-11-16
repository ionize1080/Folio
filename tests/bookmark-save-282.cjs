const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
(async()=>{
 const {createFixture}=await import('./bookmark-source-282.mjs'),{PdfEngine}=await import('../src/pdf-core.mjs');
 const source=process.env.FOLIO_BOOKMARK_PDF||await createFixture(),number=Number(process.env.FOLIO_BOOKMARK_PAGE||1),original=fs.readFileSync(source),originalHash=sha(original);
 const folder=path.resolve('tests/output/bookmark-save-282');fs.mkdirSync(folder,{recursive:true});let file=path.join(folder,'working.pdf');fs.writeFileSync(file,original);
 const summary=nodes=>nodes.map(n=>({title:n.title,parent:n.parent?nodes.findIndex(p=>p.id===n.parent):null,open:n.open,bold:n.bold,italic:n.italic,color:n.color,target:{page:n.target.page,mode:n.target.mode,args:n.target.args,uri:n.target.uri,actionType:n.target.actionType}}));
 const expectedBookmarks=summary((await new PdfEngine().open(original)).nodes),checks=[],saves=[],errors=[];
 let {app,page}=await require('./creative-harness.cjs')();
 const watch=p=>{p.setDefaultTimeout(90000);p.on('pageerror',e=>errors.push(e.message));};watch(page);
 try{
  await app.evaluate(({BrowserWindow,dialog},file)=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1440,960);win.show();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showSaveDialog=async()=>{throw Error('Unexpected Save As');};},file);
  await page.evaluate(async()=>{(await import('./i18n.mjs')).setLanguage('zh-Hans');const value=JSON.stringify({...JSON.parse(localStorage.getItem('folio-settings')||'{}'),protect:false,saveMode:'auto',saveSummary:false});localStorage.setItem('folio-settings',value);dispatchEvent(new StorageEvent('storage',{key:'folio-settings',newValue:value}));});
  await page.evaluate(()=>window.desktop.openDocuments());
  async function ready(){
   await page.evaluate(async number=>{const {S,surface}=await import('./app.mjs');window.save282={S,surface};await surface.go(number);await surface.update();await Promise.all([...surface.entries.values()].map(e=>e.promise));},number);
   await page.waitForFunction(number=>{const layer=document.querySelector(`.pdf-page[data-page="${number}"] .textLayer`),now=performance.now();if(!layer||window.save282.surface.updatePromise||layer!==window.save282.layer){window.save282.layer=layer;window.save282.stable=now;return false;}return now-window.save282.stable>350;},number);
  }
  async function edit(suffix){
   await ready();await page.locator('[data-action=flow-edit]').first().click();await page.locator('.page-edit-hit:not(.unavailable)').first().waitFor();
   const candidates=await page.locator('.page-edit-hit:not(.unavailable)').evaluateAll(es=>es.map((e,i)=>({i,text:e.title})));
   const paragraph=candidates.find(c=>/^2024\s*(年|report)/.test(c.text.trim()));assert(paragraph,JSON.stringify(candidates));
   await page.locator('.page-edit-hit:not(.unavailable)').nth(paragraph.i).click();await page.waitForFunction(()=>{const e=document.querySelector('.page-edit-input');return e&&!e.disabled&&e.value.trim();});
   const input=page.locator('.page-edit-input'),before=await input.inputValue(),text=before.trimEnd()+suffix;
   await input.fill(text);await page.locator('#pe-done').click();await page.locator('.page-edit-bar').waitFor({state:'detached',timeout:120000});
   assert(await page.evaluate(text=>window.save282.S.nativeEdits.some(e=>e.model?.text===text),text));return text;
  }
  async function save(label,marker){
   const before=fs.readFileSync(file);
   const snapshot=await page.evaluate(async()=>Array.from(await window.save282.S.pdf.getData()));
   const preview=path.join(folder,label+'-preview.pdf');fs.writeFileSync(preview,Buffer.from(snapshot));
   await page.evaluate(()=>{window.save282.S.lastSaveMetrics=null;document.querySelector('[data-action=save]').click();});
   await page.waitForFunction(()=>!window.save282.S.busy&&(window.save282.S.lastSaveMetrics||document.querySelector('#toast')?.textContent.includes('来源发生变化')));
   const result=await page.evaluate(()=>({metrics:window.save282.S.lastSaveMetrics,dirty:window.save282.S.dirty}));assert(result.metrics&&!result.dirty,JSON.stringify(result));
   const saved=fs.readFileSync(file);assert(saved.subarray(0,before.length).equals(before),'Unprotected save appends to the opened file');
   assert.deepEqual(summary((await new PdfEngine().open(saved)).nodes),expectedBookmarks,'Every bookmark retains its full destination precision');
   const python=process.env.FOLIO_PYTHON||path.resolve('native/runtime/python.exe'),verified=spawnSync(python,['tests/bookmark-source-282.py','verify',path.resolve(source),file,preview,String(number),marker],{encoding:'utf8',windowsHide:true,timeout:180000});assert.equal(verified.status,0,verified.stderr||verified.stdout);
   saves.push({label,...result.metrics,...JSON.parse(verified.stdout)});console.log('PASS',label,result.metrics);
  }
  const firstText=await edit('合计付款。');await save('first-save','合计付款');
  const verified=path.join(folder,'verified-result.pdf');fs.copyFileSync(file,verified);
  await require('./native-capture.cjs')(app,page,path.join(folder,'first-save.png'));
  checks.push('The first paragraph accepts 合计付款 and saves with source protection disabled');
  await edit('二次校验。');await save('second-save','二次校验');
  await page.locator('[data-action=undo]').first().click();await page.waitForFunction(text=>window.save282.S.nativeEdits.some(e=>e.model?.text===text),firstText);await save('undo-save','合计付款');
  await page.locator('[data-action=redo]').first().click();await page.waitForFunction(()=>window.save282.S.nativeEdits.some(e=>e.model?.text?.includes('二次校验')));await save('redo-save','二次校验');
  checks.push('A second edit, undo and redo save without changing any bookmark destination');
  file=path.join(folder,'reopened.pdf');fs.copyFileSync(verified,file);
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),file);
  const created=app.context().waitForEvent('page'),opening=page.evaluate(()=>window.desktop.openDocuments());page=await created;await opening;watch(page);await ready();
  const text=await page.evaluate(async number=>(await (await window.save282.S.pdf.getPage(number)).getTextContent()).items.map(i=>i.str).join(''),number);assert(text.replace(/\s/g,'').includes(firstText.replace(/\s/g,'')));
  await edit('重开校验。');await save('reopen-save','重开校验');
  checks.push('A fresh document process reopens the text and can edit and save again');
  assert.equal(sha(fs.readFileSync(source)),originalHash);assert.deepEqual(errors,[]);
  fs.writeFileSync('tests/output/bookmark-save-282.json',JSON.stringify({status:'passed',checks,page:number,bookmarks:expectedBookmarks.length,saves,originalUnchanged:true,errors},null,2));console.log('PASS',checks);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

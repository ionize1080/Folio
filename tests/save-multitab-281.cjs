const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const matrix=JSON.parse(fs.readFileSync('tests/output/save-281/matrix.json','utf8'));
 const inputs=matrix.slice(0,3),files=inputs.map((r,i)=>{const file=path.resolve('tests/output/save-281',`tab-${i}.pdf`);fs.copyFileSync(r.original,file);return file;});
 const {app,page:home}=await require('./creative-harness.cjs')();const checks=[],metrics=[],errors=[];let sequence=-281000;
 const {PdfEngine}=await import('../src/pdf-core.mjs');
 const watch=p=>{p.setDefaultTimeout(90000);p.on('dialog',d=>d.accept());p.on('pageerror',e=>errors.push(e.message));};
 try{
  await home.evaluate(()=>{const value=JSON.stringify({...JSON.parse(localStorage.getItem('folio-settings')||'{}'),protect:false,saveSummary:false,saveMode:'auto'});localStorage.setItem('folio-settings',value);dispatchEvent(new StorageEvent('storage',{key:'folio-settings',newValue:value}));});
  app.context().on('page',watch);
  await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});dialog.showSaveDialog=async()=>{throw Error('Unprotected save unexpectedly asks for a new path');};},files);
  await home.evaluate(()=>window.desktop.openDocuments());
  const pages=[];
  for(const p of app.context().pages())if(p.url().includes('index.html')&&!p.url().includes('/renderer/')){
   const state=await p.evaluate(async()=>{const {S}=await import('./app.mjs');return {name:S.name,tab:await window.desktop.tabsState()};});
   const index=files.findIndex(f=>path.basename(f)===state.name);if(index>=0){await p.evaluate(()=>window.desktop.aiApproval(true));pages[index]={page:p,id:state.tab.self};}
  }
  assert.equal(pages.filter(Boolean).length,3,'Three PDFs must remain live at once');
  for(const tab of pages)tab.wc=await app.evaluate(async({webContents},id)=>{for(const wc of webContents.getAllWebContents()){if(!wc.getURL().includes('index.html')||wc.getURL().includes('/renderer/'))continue;const state=await wc.executeJavaScript('window.desktop?.tabsState?.()').catch(()=>null);if(state?.self===id)return wc.id;}},tab.id);
  async function tool(tab,name,args){const id=--sequence;await app.evaluate(({webContents},{wc,id,name,args})=>webContents.fromId(wc).send('ai-request',{id,deadline:Date.now()+180000,params:{name,arguments:args}}),{wc:tab.wc,id,name,args});let r;const until=Date.now()+175000;while(Date.now()<until){r=await app.evaluate((_,id)=>globalThis.studioReplies[id],id);if(r)break;await new Promise(r=>setTimeout(r,60));}assert(r,'Tool timeout');assert(!r.error,r.error);return r.result;}
  const rev=tab=>tool(tab,'folio_document',{action:'describe'}).then(r=>r.revision);
  async function save(tab,index,label){
   const before=fs.readFileSync(files[index]);await tab.page.evaluate(async()=>{const {S}=await import('./app.mjs');window.save281State=S;S.lastSaveMetrics=null;document.querySelector('[data-action=save]').click();});
   await tab.page.waitForFunction(()=>{const S=window.save281State;return !!S.lastSaveMetrics&&!S.busy&&!S.dirty;});
   const after=fs.readFileSync(files[index]);assert(after.length>before.length,label+' wrote a new revision');assert(after.subarray(0,before.length).equals(before),label+' preserves previous bytes');
   const data=await tab.page.evaluate(async()=>{const {S}=await import('./app.mjs');return {nodes:S.nodes.map(n=>n.title),metrics:S.lastSaveMetrics};});
   const actual=await new PdfEngine().open(new Uint8Array(after));assert.deepEqual(actual.nodes.map(n=>n.title),data.nodes);assert(data.metrics.bytes<after.length,'Only a delta crosses the desktop bridge');
   metrics.push({document:index,label,...data.metrics});tab.titles=data.nodes;
  }
  for(let i=0;i<3;i++){
   const tab=pages[i];await home.evaluate(id=>window.desktop.tabSelect(id),tab.id);
   await tool(tab,'folio_bookmarks',{action:'create',revision:await rev(tab),title:`Tab ${i} private bookmark`,page:1});
  }
  // The same app shares one file store; two saves may overlap but must never
  // share the target capability, worker revision, or dirty state.
  await Promise.all(pages.map((tab,i)=>save(tab,i,'first-save')));
  checks.push('Three live PDFs save concurrently to their own original paths with protection disabled, including first-save deltas');
  const a=pages[0],b=pages[1],c=pages[2];
  await home.evaluate(id=>window.desktop.tabSelect(id),a.id);
  let v=await tool(a,'folio_vector',{action:'list',page:1});
  v=await tool(a,'folio_vector',{action:'create',page:1,revision:v.revision,box:[30,30,80,40],svg:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#176dc1"/></svg>'});
  await tool(a,'folio_operation',{operation:'page.edit',revision:v.revision,options:{edits:[{type:'text',id:'tab-text',page:1,index:null,text:'Tab A edited text',matrix:[1,0,0,1,30,85],size:10}]}});
  const firstImage=(await tool(a,'folio_image',{action:'inspect',page:1}));assert(firstImage.images.length);
  await tool(a,'folio_image',{action:'update',page:1,index:firstImage.images[0].index,revision:firstImage.revision,adjustments:{saturation:-100}});
  await save(a,0,'text-image-vector');
  await home.evaluate(id=>window.desktop.tabSelect(id),b.id);
  const ocr=await tool(b,'folio_document',{action:'ocr',page:1,revision:await rev(b),apply:true});
  assert(ocr.applied&&ocr.blockCount>0,JSON.stringify(ocr));await save(b,1,'real-ocr');
  checks.push('Actual page text, image recoloring, native vector and local OCR save through the production editor and IPC');
  await home.evaluate(id=>window.desktop.tabSelect(id),c.id);
  const original=await c.page.evaluate(async()=>(await import('./app.mjs')).S.nodes.map(n=>n.title));
  await c.page.locator('.tree-row .title').first().click();await c.page.keyboard.press('F2');await c.page.locator('.inline-name').fill('Tab C renamed 中文');await c.page.keyboard.press('Enter');
  await save(c,2,'bookmark-rename');
  await tool(c,'folio_operation',{operation:'history.undo',revision:await rev(c)});await save(c,2,'bookmark-undo');
  assert.deepEqual(c.titles,original);await tool(c,'folio_operation',{operation:'history.redo',revision:await rev(c)});await save(c,2,'bookmark-redo');
  const switches=[];
  for(let i=0;i<18;i++){const tab=pages[i%3],start=performance.now();await home.evaluate(id=>window.desktop.tabSelect(id),tab.id);switches.push(performance.now()-start);assert.deepEqual(await tab.page.evaluate(async()=>(await import('./app.mjs')).S.nodes.map(n=>n.title)),tab.titles);}
  checks.push('Bookmark rename, undo and redo remain isolated across 18 live document switches');
  const memoryBeforeClose=await app.evaluate(({app})=>app.getAppMetrics().filter(p=>p.type==='Tab').map(p=>({pid:p.pid,workingSetKB:p.memory.workingSetSize,cpuPercent:p.cpu.percentCPUUsage})));
  await home.evaluate(id=>window.desktop.tabClose(id),b.id);assert(b.page.isClosed(),'Closed document renderer is released');
  const memoryAfterClose=await app.evaluate(({app})=>app.getAppMetrics().filter(p=>p.type==='Tab').map(p=>({pid:p.pid,workingSetKB:p.memory.workingSetSize,cpuPercent:p.cpu.percentCPUUsage})));
  const created=app.context().waitForEvent('page');await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),files[1]);
  const opening=home.evaluate(()=>window.desktop.openDocuments());const reopened=await created;await opening;
  const text=await reopened.evaluate(async()=>{const {S}=await import('./app.mjs');return (await (await S.pdf.getPage(1)).getTextContent()).items.map(i=>i.str).join(' ');});assert.match(text,/Folio|OCR|2026/i);
  checks.push('Closing and reopening the OCR tab retains searchable text and the other live documents');
  for(const r of inputs)assert.equal(sha(fs.readFileSync(r.source)),r.sha256);
  assert.deepEqual(errors,[]);
  await require('./native-capture.cjs')(app,reopened,'tests/output/save-multitab-281.png');
  fs.writeFileSync('tests/output/save-multitab-281.json',JSON.stringify({status:'passed',checks,metrics,switches,memoryBeforeClose,memoryAfterClose,errors,originalsUnchanged:true},null,2));console.log('PASS',checks);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

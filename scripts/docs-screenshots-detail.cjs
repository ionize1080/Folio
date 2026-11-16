const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
module.exports=async function(){
 const out=path.resolve('docs/images/2.8.3');
 for(const mode of (process.argv.includes('--edit-only')?['edit']:process.argv.includes('--studio-only')?['studio']:['edit','studio','ocr'])){
  const profile=path.resolve('tests/output/docs-'+mode+'-'+Date.now());
  const app=await _electron.launch({args:[path.resolve('.'),'--force-device-scale-factor=1'],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:profile,FOLIO_CHATBOX_PROFILE:profile+'-chat'},timeout:60000});
  const p=await app.firstWindow();p.setDefaultTimeout(60000);await p.emulateMedia({reducedMotion:'reduce'});
  const shot=async name=>{await p.waitForTimeout(500);await require('../tests/native-capture.cjs')(app,p,path.join(out,name+'.png'));console.log('Captured',name);};
  try{
   await p.locator('#ribbon-tab-home').waitFor();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,960));
   await p.evaluate(async()=>{(await import('./i18n.mjs')).setLanguage('zh-Hans');(await import('./appearance.mjs')).applyAppearance({theme:'light',palette:'cobalt'});});
   const file=path.resolve('docs/examples/'+(mode==='ocr'?'Folio-Demo-Scan.pdf':'Folio-Demo.pdf'));
   await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),file);
   await p.locator('[data-action=open]').first().click();await p.waitForFunction(()=>document.querySelector('#doc-name')?.textContent.includes('Folio-Demo'));await p.locator('#busy').waitFor({state:'hidden'});await p.keyboard.press('Control+0');
   if(mode==='edit'){
    await p.locator('.tree-row').nth(2).click();await p.waitForFunction(async()=>(await import('./app.mjs')).S.page===3);await p.keyboard.press('Control+0');await p.locator('[data-action=flow-edit]').first().click();
    await p.locator('.page-edit-hit:not(.unavailable)').first().waitFor();
    const hits=await p.locator('.page-edit-hit:not(.unavailable)').evaluateAll(es=>es.map((e,i)=>({i,text:e.title||e.getAttribute('aria-label')})));
    const target=hits.find(e=>/Open the demo/.test(e.text))||hits.find(e=>e.text?.length>60)||hits[0];assert(target,'Synthetic paragraph must be editable');await p.locator('.page-edit-hit:not(.unavailable)').nth(target.i).click();
    await p.waitForFunction(()=>{const e=document.querySelector('.page-edit-input');return e&&!e.disabled&&e.value.trim();});await p.locator('.page-edit-input').evaluate(e=>e.scrollIntoView({block:'center'}));await shot('10-text-editing');
   }else if(mode==='studio'){
    // Drive real studio tools through the local test bridge; no provider or network request.
    await p.evaluate(()=>window.desktop.aiApproval(true));
    await app.evaluate(({ipcMain})=>{globalThis.docsReplies={};const original=ipcMain._invokeHandlers.get('ai-reply');ipcMain.removeHandler('ai-reply');ipcMain.handle('ai-reply',(e,v)=>{if(v.id<0)globalThis.docsReplies[v.id]=v;return original(e,v);});});
    let seq=0;
    const call=async args=>{const id=--seq;await app.evaluate(({BrowserWindow},{id,args})=>BrowserWindow.getAllWindows()[0].webContents.send('ai-request',{id,deadline:Date.now()+180000,params:{name:'folio_studio',arguments:args}}),{id,args});const until=Date.now()+175000;let r;while(Date.now()<until){r=await app.evaluate((_,id)=>globalThis.docsReplies[id],id);if(r)break;await new Promise(resolve=>setTimeout(resolve,100));}assert(r,'studio timeout');if(r.error)throw Error(r.error);return r.result;};
    await p.locator('.tree-row').nth(3).click();
    const objects=await call({action:'objects',page:4});const obj=objects.objects.find(o=>o.kind==='image');assert(obj);
    const photo=await call({action:'open',kind:'photo',page:4,index:obj.index,visible:true});
    await call({action:'background',sessionId:photo.sessionId,options:{mode:'checker'}});await call({action:'view',sessionId:photo.sessionId,options:{mode:'fit'}});await p.waitForFunction(()=>document.body.classList.contains('studio-active'));await p.waitForTimeout(1200);await shot('11-image-workspace');
    await p.locator('[data-return]').click();
    const vector=await call({action:'open',kind:'vector',page:4,visible:true,settings:{width:600,height:300}}),sessionId=vector.sessionId;
    const cmd=(command,params)=>call({action:'execute',sessionId,command,params});
    for(let i=0;i<3;i++){await cmd('shape.rectangle',{x:30+i*190,y:90,width:160,height:100});await cmd('paint.setFill',{gradient:{kind:'linear',stops:[{offset:0,color:'#245bd4'},{offset:1,color:'#42b8a0'}]}});await cmd('text.create',{x:55+i*190,y:220,text:['Read','Review','Publish'][i],size:24});}
    await call({action:'background',sessionId,options:{mode:'solid',color:'#eef3f8'}});await call({action:'view',sessionId,options:{mode:'fit'}});await p.waitForTimeout(1000);await shot('12-vector-workspace');
   }else{
    await p.locator('[data-action=ocr]').first().click();await p.locator('#ocr-start').waitFor();await p.locator('#ocr-start').click();
    await p.waitForFunction(()=>document.querySelector('#ocr-job-title')?.textContent==='已完成',null,{timeout:180000});
    await p.locator('#ocr-tab-review').click();assert(await p.locator('#ocr-results option').count()>0,'Real OCR results required');
    const first=await p.locator('#ocr-results option').first().getAttribute('value');await p.locator('#ocr-results').selectOption(first);await shot('13-ocr-review');
    console.log('Real OCR boxes:',await p.locator('#ocr-results option').count());
   }
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
 }
};
if(require.main===module)module.exports().catch(e=>{console.error(e);process.exitCode=1;});

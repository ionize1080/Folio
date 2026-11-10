const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const {app,page}=await require('./creative-harness.cjs')();page.removeAllListeners('dialog');
 page.on('dialog',d=>d.dismiss().catch(()=>{}));
 try{
  await page.evaluate(async()=>(await import('./i18n.mjs')).setLanguage('zh-Hans'));
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),path.resolve('tests/output/workflow-250-source.pdf'));
  await page.locator('[data-action=open]').first().click();await page.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('workflow-250-source'));await page.locator('#busy').waitFor({state:'hidden'});
  await page.evaluate(async()=>{const {S}=await import('./app.mjs');S.dirty=true;S.flowDraftDirty=true;S.flowEdit={finish:async()=>{throw Error('Unapplicable draft');},destroy:()=>{S.flowEdit=null;S.flowDraftDirty=false;}};await window.desktop.setDirty(true);window.addEventListener('beforeunload',e=>{e.preventDefault();e.returnValue='Unapplied nested editor';});});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await page.locator('#modal-title').filter({hasText:'结束当前编辑'}).waitFor();
  await page.locator('#modal-footer button').filter({hasText:'取消'}).click();assert(await page.evaluate(async()=>(await import('./app.mjs')).S.flowDraftDirty));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await page.locator('#modal-title').filter({hasText:'结束当前编辑'}).waitFor();
  await page.locator('#modal-footer button').filter({hasText:'放弃本次调整'}).click();await page.locator('#modal-title').filter({hasText:'当前文档有未保存更改'}).waitFor();
  const closed=app.waitForEvent('close',{timeout:30000});await page.locator('#modal-footer button').filter({hasText:'放弃并继续'}).click();await closed;
  fs.writeFileSync('tests/output/close-251.json',JSON.stringify({status:'passed',checks:['invalid draft cancel preserves changes','explicit draft discard reaches save/discard decision','confirmed exit ignores secondary beforeunload veto and exits process']},null,2));console.log('PASS close lifecycle including secondary unload veto');
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

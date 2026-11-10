const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {app,page,call}=await require('./creative-harness.cjs')();const checks=[];page.removeAllListeners('dialog');page.on('dialog',d=>(d.type()==='beforeunload'?d.dismiss():d.accept()).catch(error=>{if(d.type()!=='beforeunload')throw error;}));
 try{
  await page.evaluate(async()=>(await import('./i18n.mjs')).setLanguage('zh-Hans'));
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),path.resolve('tests/output/workflow-250-source.pdf'));
  await page.locator('[data-action=open]').first().click();await page.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('workflow-250-source'));await page.locator('#busy').waitFor({state:'hidden'});
  await page.locator('#ribbon-tab-export').click();await page.locator('[data-ribbon-command=export-word]').click();
  for(const [w,h] of [[900,600],[1440,900],[1100,700]]){
   await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),[w,h]);
   await page.waitForTimeout(200);
   const geometry=await page.locator('.document-tools').evaluate(d=>{const b=d.getBoundingClientRect(),nav=d.querySelector('nav'),footer=d.querySelector('footer').getBoundingClientRect();nav.scrollTop=nav.scrollHeight;const last=nav.lastElementChild.getBoundingClientRect();return {bottom:b.bottom,screen:innerHeight,last:last.bottom,nav:nav.getBoundingClientRect().bottom,footer:footer.bottom,scroll:nav.scrollTop};});
   assert(geometry.bottom<=geometry.screen&&geometry.footer<=geometry.screen);assert(geometry.last<=geometry.nav+1);assert(geometry.scroll>0);
  }
  for(const action of ['export-word','export-excel']){
   await page.locator(`[data-utility-action=${action}]`).click();assert.equal(await page.locator('[data-key=ocr-policy] option').count(),3);
   await page.locator('[data-key=ocr-policy]').selectOption('skip');assert.equal(await page.locator('[data-key=ocr-policy]').inputValue(),'skip');
  }
  await page.screenshot({path:'tests/output/refinements-251-dialog.png'});checks.push('Short windows keep footer and last navigation item reachable; both export modes expose OCR policies');
  await page.locator('.document-tools [data-close]').click();
  for(const kind of ['photo','vector']){
   const s=await call({action:'open',kind,settings:{width:200,height:100},visible:true});await page.locator('.studio-active').waitFor();
   if(kind==='photo'){await call({action:'execute',sessionId:s.sessionId,command:'layer.new.layer',params:{name:'Test'}});await call({action:'execute',sessionId:s.sessionId,command:'paint.stroke',params:{points:[[20,20],[100,60]],size:30,color:'#28c080'}});}else await call({action:'execute',sessionId:s.sessionId,command:'shape.rectangle',params:{x:10,y:10,width:100,height:50}});
   await page.locator('.studio-placement summary').click();await page.locator('.studio-placement [data-width]').fill('240');
   const height=Number(await page.locator('.studio-placement [data-height]').inputValue());assert(Math.abs(height-120)<.01);
   await page.locator('[data-on-page]').click();await page.locator('.placement-page-layer polygon').waitFor();
   const before=await page.evaluate(async()=>{const {S}=await import('./app.mjs');return S.nativeEdits.at(-1).matrix;});
   const box=await page.locator('.placement-page-layer polygon').boundingBox();assert(box);
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+24,box.y+box.height/2-12,{steps:4});await page.mouse.up();
   await page.waitForFunction(()=>document.querySelector('.placement-page-bar [role=status]').textContent.includes('已应用'));
   const after=await page.evaluate(async()=>{const {S}=await import('./app.mjs');return S.nativeEdits.at(-1).matrix;});assert.deepEqual(after.slice(0,4),before.slice(0,4));assert(after[4]>before[4]);assert(after[5]>before[5]);
   const handle=await page.locator('.placement-page-layer circle').nth(2).boundingBox();
   await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+24,handle.y+handle.height/2-12,{steps:4});await page.mouse.up();
   await page.waitForFunction(()=>document.querySelector('.placement-page-bar [role=status]').textContent.includes('已应用'));
   const resized=await page.evaluate(async()=>{const {S}=await import('./app.mjs');return S.nativeEdits.at(-1).matrix;});
   assert(Math.hypot(...resized.slice(0,2))>Math.hypot(...after.slice(0,2)));
   assert(Math.abs(Math.hypot(...resized.slice(0,2))/Math.hypot(...resized.slice(2,4))-2)<.001);
   const cancelBox=await page.locator('.placement-page-layer polygon').boundingBox();await page.mouse.move(cancelBox.x+cancelBox.width/2,cancelBox.y+cancelBox.height/2);await page.mouse.down();await page.mouse.move(cancelBox.x+cancelBox.width/2+15,cancelBox.y+cancelBox.height/2+15);await page.keyboard.press('Escape');await page.mouse.up();
   assert.deepEqual(await page.evaluate(async()=>{const {S}=await import('./app.mjs');return S.nativeEdits.at(-1).matrix;}),resized);
   await page.screenshot({path:'tests/output/refinements-251-'+kind+'.png'});

   await page.locator('.placement-page-bar button').click();await page.locator('.studio-active').waitFor();await page.locator('[data-return]').click();
   checks.push(kind+' artwork moves and resizes with aspect lock on the PDF; Esc cancels a gesture');
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await page.locator('#modal[open]').waitFor();
  await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();BrowserWindow.getAllWindows()[0].close();});assert.equal(await page.locator('#modal[open]').count(),1);
  await page.locator('#modal-footer button').filter({hasText:'取消'}).click();await page.waitForTimeout(100);assert.equal(await page.locator('#modal[open]').count(),0);
  checks.push('Repeated close requests keep one confirmation and cancel returns to document');
  await page.evaluate(async()=>{const {S}=await import('./app.mjs');S.flowDraftDirty=true;S.flowEdit={finish:async()=>{throw Error('Invalid draft fixture');},destroy:()=>{S.flowDraftDirty=false;S.flowEdit=null;}};});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await page.locator('#modal-title').filter({hasText:'结束当前编辑'}).waitFor();
  await page.locator('#modal-footer button').filter({hasText:'放弃本次调整'}).click();await page.locator('#modal-title').filter({hasText:'当前文档有未保存更改'}).waitFor();
  const savedFile=path.resolve('tests/output/refinements-251-saved.pdf');await app.evaluate(({dialog},file)=>dialog.showSaveDialog=async()=>({canceled:false,filePath:file}),savedFile);
  const closed=app.waitForEvent('close',{timeout:120000});await page.locator('#modal-footer button').filter({hasText:'保存并继续'}).click();await closed;
  assert(fs.statSync(savedFile).size>1000);checks.push('Invalid draft can be discarded; already applied changes save successfully before exit');
  fs.writeFileSync('tests/output/refinements-251.json',JSON.stringify({status:'passed',checks},null,2));console.log('PASS',checks);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

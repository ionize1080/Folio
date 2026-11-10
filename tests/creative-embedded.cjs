const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{const {app,page,call}=await require('./creative-harness.cjs')();const checks=[];try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,728));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.resolve('tests/output/creative-source.pdf'));
  await page.locator('[data-action=open]').first().click();await page.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('creative-source'));await page.locator('#busy').waitFor({state:'hidden'});
  for(const kind of ['photo','vector']){
    console.log('CHECK embedded',kind);
    const opened=await call({action:'open',kind,visible:true,settings:{width:300,height:180}}),sessionId=opened.sessionId;
    const request=a=>call({sessionId,...a});
    await page.waitForFunction(()=>document.body.classList.contains('studio-active'));await page.waitForTimeout(800);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1,'Editors must not create a separate window');
    const limits=kind==='photo'?12800:64000;
    let r=await request({action:'view',options:{mode:'zoom',percent:limits}});assert(Math.abs(r.percent-limits)<1);
    for(const mode of ['fit','width','height','center-x','center-y','actual']){
      if(!await page.locator('.studio-view-popover').evaluate(e=>e.matches(':popover-open')))await page.locator('[data-zoom-toggle]').click();
      await page.locator('.studio-toolbar [data-view]').selectOption(mode);await page.waitForFunction(()=>!document.querySelector('.studio-workspace').classList.contains('studio-busy'));
      r=await request({action:'view'});assert(r.percent>0&&r.percent<=limits);if(mode==='actual')assert(Math.abs(r.percent-100)<.01,JSON.stringify({kind,mode,r}));
    }
    const before=await request({action:'preview'});
    if(kind==='photo'){
      await request({action:'execute',command:'layer.new.layer',params:{name:'Manual brush'}});
      await request({action:'request',method:'ui.set',params:{tool:'brush'}});
      await request({action:'request',method:'ui.pointer',params:{events:[{kind:'down',x:30,y:30},{kind:kind==='photo'?'move':'drag',x:150,y:80},{kind:'up',x:150,y:80}]}});
    }else{
      await request({action:'request',method:'ui.tool.select',params:{tool:'rectangle'}});
      await request({action:'request',method:'ui.pointer',params:{events:[{kind:'down',x:30,y:30},{kind:kind==='photo'?'move':'drag',x:150,y:80},{kind:'up',x:150,y:80}]}});
    }
    const after=await request({action:'preview'});assert.notEqual(after.content[0].data,before.content[0].data,'Tool gestures must change actual artwork');
    // The integrated command menu must open the engine's real parameter dialog.
    if(await page.locator('.studio-view-popover').evaluate(e=>e.matches(':popover-open')))await page.locator('[data-zoom-toggle]').click();
    const menuId=kind==='photo'?'filter.blur.gaussianBlur':'object.rotate';
    await page.locator('[data-all-tools]').click();await page.locator('.studio-command-search input').fill(menuId);
    await page.locator(`.studio-command-list [data-command="${menuId}"]`).first().click();
    let state=await request({action:'request',method:'ui.inspect'});assert(kind==='photo'?state.dialogs?.length:state.ui?.dialog,'Menu must open the native parameter dialog');
    await request({action:'request',method:'ui.dialog.cancel',params:kind==='photo'?{dialog:state.dialogs.at(-1).id}:{}});
    let revision=(await call({action:'objects',page:1})).revision;
    const applied=await request({action:'apply',revision});
    const original=(await call({action:'objects',page:1})).objects.find(o=>o.id===applied.id).matrix;
    await request({action:'background',options:{mode:'solid',color:'#e5edf5'}});
    const pdf=await request({action:'background',options:{mode:'pdf',opacity:.65}});assert(pdf.viewOnly&&pdf.hasPage&&pdf.quad.length===4);
    for(const percent of [50,100,1200,limits]){console.log('CHECK reference zoom',kind,percent);await request({action:'view',options:{mode:'zoom',percent}});}
    assert.equal((await request({action:'preview'})).content[0].data,after.content[0].data,'Reference backgrounds and camera zoom must not enter exported artwork');
    revision=(await call({action:'objects',page:1})).revision;await request({action:'apply',revision});
    assert.deepEqual((await call({action:'objects',page:1})).objects.find(o=>o.id===applied.id).matrix,original,'Applying after zoom must preserve the exact PDF placement matrix');
    // Exercise the human controls as well as the same MCP action.
    await page.locator('[data-zoom-toggle]').click();await page.locator('[data-background-mode]').selectOption('solid');await page.waitForTimeout(300);
    await page.locator('[data-background-mode]').selectOption('pdf');await page.waitForTimeout(400);
    await page.locator('[data-background-strength]').fill('40');await page.locator('[data-background-strength]').dispatchEvent('input');await page.waitForTimeout(400);
    await page.waitForFunction(()=>document.querySelector('.studio-background').getAttribute('aria-busy')!=='true');
    const strength=await request({action:'request',method:'folio.backdrop'});assert(Math.abs(strength.opacity-.4)<.01,JSON.stringify(strength));
    const popover=await page.locator('.studio-view-popover').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));assert(popover.scroll<=popover.width,'View controls must not overflow horizontally');
    await page.locator('.studio-view-popover').evaluate(e=>e.hidePopover());
    await request({action:'view',options:{mode:'page'}});await page.waitForTimeout(500);
    await require('./native-capture.cjs')(app,page,`tests/output/embedded-${kind}.png`);
    await page.locator('.studio-identity [data-return]').click();assert(!await page.evaluate(()=>document.body.classList.contains('studio-active')));
    await request({action:'show'});await page.waitForFunction(()=>document.body.classList.contains('studio-active'));assert.equal((await request({action:'preview'})).content[0].data,after.content[0].data,'Returning to PDF must not discard editor state');
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(780,600);w.setSize(800,850);});
    await page.locator('.folio-ai-open').click();await page.waitForFunction(()=>document.body.classList.contains('ai-sidebar-open'));await page.waitForTimeout(2500);
    await page.waitForFunction(()=>document.querySelector('.studio-frame:not(.studio-parked)')?.dataset.compact==='true');
    state=await request({action:'request',method:'ui.inspect'});assert(kind==='photo'?JSON.stringify(state.docking.layout).includes('"iconic":true'):state.ui.dock_collapsed,'Narrow editor collapses the inspector to preserve canvas space');
    assert(state.canvasRect[2]>250,'AI sidebar must leave a useful canvas');
    const toolbar=await page.locator('.studio-toolbar').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));assert(toolbar.scroll<=toolbar.width);
    await page.locator('[data-zoom-toggle]').click();await page.waitForTimeout(150);
    assert.equal(await app.evaluate(()=>globalThis.__folioChatboxHost.view.getVisible()),false,'AI view must not cover the canvas view popover');
    await page.locator('.studio-view-popover').evaluate(e=>e.hidePopover());await page.waitForTimeout(150);
    assert.equal(await app.evaluate(()=>globalThis.__folioChatboxHost.view.getVisible()),true,'AI view returns after closing the popover');
    await require('./native-capture.cjs')(app,page,`tests/output/embedded-${kind}-narrow.png`);
    await page.locator('.folio-ai-open').click();await page.waitForFunction(()=>!document.body.classList.contains('ai-sidebar-open'));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1400,900));await page.waitForTimeout(2500);
    await page.waitForFunction(()=>document.querySelector('.studio-frame:not(.studio-parked)')?.dataset.compact==='false');
    state=await request({action:'request',method:'ui.inspect'});assert(kind==='photo'?!JSON.stringify(state.docking.layout).includes('"iconic":true'):!state.ui.dock_collapsed,'Wide editor restores the previous inspector');
    await request({action:'close'});checks.push({kind,maxZoom:limits,embedded:true,viewModes:true,manualToolGesture:true,statePreserved:true,nativeMenuDialog:true,pdfReference:true,viewOnlyExports:true,placementUnchanged:true});
  }
  fs.writeFileSync('tests/output/creative-embedded.json',JSON.stringify({status:'passed',checks},null,2));console.log('PASS embedded manual tools, zoom and view state',checks);
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}})().catch(e=>{console.error(e);process.exitCode=1;});

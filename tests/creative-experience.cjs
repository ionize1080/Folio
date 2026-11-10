const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
  const {app,page,call}=await require('./creative-harness.cjs')(),checks=[];
  try{
    await page.evaluate(async()=>{(await import('./i18n.mjs')).setLanguage('zh-Hans')});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.resolve('tests/output/creative-source.pdf'));
    await page.locator('[data-action=open]').first().click();await page.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('creative-source'));await page.locator('#busy').waitFor({state:'hidden'});
    await page.locator('#ribbon-tab-photo').click();await page.locator('[data-ribbon-command=photo-studio]').click();
    assert.equal(await page.locator('.creative-dialog [data-open]').isEnabled(),true,'New artwork must be available before optional object extraction');
    await page.waitForFunction(()=>document.querySelector('.creative-dialog [data-object] option img')?.complete);
    const labels=await page.locator('.creative-dialog [data-object] option').allTextContents();assert(labels.some(t=>t.includes('第 1 页')&&t.includes('×')));
    assert(await page.locator('.creative-dialog [data-object]').evaluate(e=>getComputedStyle(e).appearance==='base-select'));
    await page.locator('.creative-dialog [data-object]').click();await require('./native-capture.cjs')(app,page,'tests/output/studio-experience-picker.png');
    await page.keyboard.press('Escape');await page.keyboard.press('Escape');checks.push('Object thumbnails, readable page/dimensions, styled native picker, immediate create');
    if(process.argv.includes('--picker-only')){console.log('PASS picker-only',checks);return;}
    for(const kind of ['photo','vector']){
      const opened=await call({action:'open',kind,visible:true,settings:{width:300,height:180}}),sessionId=opened.sessionId;
      const request=a=>call({sessionId,...a});
      await page.waitForFunction(()=>document.body.classList.contains('studio-active'));await page.waitForTimeout(500);
      const background=await request({action:'request',method:'folio.backdrop'});assert.equal(background.mode,'pdf');assert(background.hasPage);
      const fonts=await request({action:'request',method:'folio.fonts'});assert.equal(fonts.installed,4);assert(fonts.faces.includes('cjk')&&fonts.faces.includes('regular'));
      const original=await request({action:'preview'});
      for(const language of ['en','zh-Hant','zh-Hans']){
        await page.evaluate(async value=>(await import('./i18n.mjs')).setLanguage(value),language);
        await page.waitForTimeout(500);
        const result=await request({action:'request',method:'folio.fonts'});assert.equal(result.installed,4);
        const menu=await request({action:'request',method:'folio.menu'}),file=menu.find(row=>row.path?.[0]==='File');
        assert.equal(file?.displayPath?.[0],{'en':'File','zh-Hant':'檔案','zh-Hans':'文件'}[language],`${kind}: engine menus follow the host language`);
      }
      const buttons=page.locator('.studio-menus button');
      await buttons.nth(0).click();await page.waitForSelector('.studio-command-popover:popover-open');
      await buttons.nth(1).click();await page.waitForFunction(()=>document.querySelectorAll('.studio-menus button')[1]?.getAttribute('aria-expanded')==='true');assert.equal(await buttons.nth(0).getAttribute('aria-expanded'),'false');assert.equal(await buttons.nth(1).getAttribute('aria-expanded'),'true');
      await page.locator('.studio-document-meta').click();assert.equal(await buttons.nth(1).getAttribute('aria-expanded'),'false');
      await buttons.nth(2).click();await page.waitForSelector('.studio-command-popover:popover-open');
      await page.locator('.studio-frame:not(.studio-parked)').evaluate(e=>e.contentWindow.focus());await page.waitForTimeout(100);
      assert.equal(await buttons.nth(2).getAttribute('aria-expanded'),'false','Iframe focus dismisses menu and its highlighted anchor');
      await page.locator('[data-pan]').click();await page.waitForTimeout(150);
      const state=await request({action:'request',method:'ui.inspect'});assert(JSON.stringify(state).toLowerCase().includes('hand'));
      await page.locator('[data-fit]').click();await page.waitForTimeout(150);
      assert.equal((await request({action:'preview'})).content[0].data,original.content[0].data,'View changes do not modify exported artwork');
      await page.locator('[data-canvas-size]').click();await page.waitForSelector('.studio-size-dialog');
      await page.locator('.studio-size-dialog [data-width]').fill('420');await page.locator('.studio-size-dialog [data-height]').fill('240');await page.locator('.studio-size-dialog button[value=apply]').click();
      await page.waitForFunction(()=>document.querySelector('.studio-document-meta').textContent==='420 × 240');
      const doc=(await request({action:'inspect'})).document;assert.equal(kind==='photo'?doc.width:doc.artboards[0].width,420);assert.equal(kind==='photo'?doc.height:doc.artboards[0].height,240);
      // A transparent artwork must reveal the reference plane, not an opaque
      // shadow rectangle left over from the engine's old checkerboard paint.
      await request({action:'background',options:{mode:'solid',color:'#cfe0f2'}});await page.waitForTimeout(150);
      const center=await page.locator('.studio-frame:not(.studio-parked)').evaluate(e=>{const b=e.getBoundingClientRect();return {x:Math.round(b.x+b.width*.35),y:Math.round(b.y+b.height*.55),width:2,height:2}});
      await app.evaluate(async({BrowserWindow},rect)=>{await BrowserWindow.getAllWindows()[0].webContents.capturePage(rect,{stayHidden:true,stayAwake:true});},center);await page.waitForTimeout(150);
      const pixel=await app.evaluate(async({BrowserWindow},rect)=>[...(await BrowserWindow.getAllWindows()[0].webContents.capturePage(rect,{stayHidden:true,stayAwake:true})).toBitmap().subarray(0,4)],center);
      for(const [i,value] of [242,224,207].entries())assert(Math.abs(pixel[i]-value)<=4,`${kind}: transparent artwork must reveal its reference background (${pixel})`);
      await request({action:'background',options:{mode:'pdf',color:'#eef0f3'}});
      await require('./native-capture.cjs')(app,page,`tests/output/studio-experience-${kind}.png`);
      await request({action:'close'});checks.push(`${kind}: PDF default background, native CJK/Latin/numeric fonts, language changes, menu state, pan/fit, canvas resize`);
    }
    fs.writeFileSync('tests/output/creative-experience.json',JSON.stringify({status:'passed',checks},null,2));console.log('PASS creative experience',checks);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1});

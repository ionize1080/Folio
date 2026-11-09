const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const {app,page}=await require('./creative-harness.cjs')();const checks=[];try{
  await page.evaluate(async()=>(await import('./i18n.mjs')).setLanguage('zh-Hans'));
  const output=path.resolve('tests/output');let savePath=path.join(output,'organizer-ui.pdf');
  async function pick(file){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.resolve(file));}
  async function target(file){savePath=path.join(output,file);await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},savePath);}
  await pick('tests/output/organizer-source.pdf');await page.locator('[data-action=open]').first().click();await page.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('organizer-source'));await page.locator('#busy').waitFor({state:'hidden'});
  await page.locator('#ribbon-tab-organize').click();await page.locator('[data-ribbon-command=page-organizer]').click();
  const dialog=page.locator('.organizer-dialog'),tiles=dialog.locator('.organizer-page');await tiles.first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('.organizer-page[data-rendered]').length===3);
  const unmarked=await tiles.first().locator('canvas').evaluate(c=>c.toDataURL());
  const marks=dialog.locator('.organizer-options:has([data-marks])');await marks.locator('summary').click();
  await dialog.locator('[data-mark-text]').fill('REFERENCE');await dialog.locator('[data-marks]').check();
  await page.waitForFunction(()=>document.querySelectorAll('.organizer-page[data-rendered]').length===3);
  assert.notEqual(await tiles.first().locator('canvas').evaluate(c=>c.toDataURL()),unmarked);
  await marks.locator('summary').click();await tiles.nth(1).click();
  await page.waitForFunction(()=>document.querySelectorAll('.organizer-page[data-rendered]').length===3);
  assert.equal(await tiles.first().locator('canvas').evaluate(c=>c.toDataURL()),unmarked,'Page mark preview follows selection without stale overlays');
  await marks.locator('summary').click();await dialog.locator('[data-marks]').uncheck();await marks.locator('summary').click();checks.push('Page mark preview follows changed thumbnail selection');
  await tiles.nth(0).click();await tiles.nth(2).click({modifiers:['Shift']});assert.equal(await dialog.locator('[aria-selected=true]').count(),3);
  await dialog.locator('[data-org=copy]').click();assert.equal(await tiles.count(),6);await dialog.locator('[data-org=undo]').click();assert.equal(await tiles.count(),3);await dialog.locator('[data-org=redo]').click();assert.equal(await tiles.count(),6);
  await dialog.locator('[data-org=delete]').click();assert.equal(await tiles.count(),3);checks.push('Range selection, copy, delete, undo and redo');
  await tiles.nth(0).click();await dialog.locator('[data-org=blank]').click();assert.equal(await tiles.count(),4);assert.match(await tiles.nth(1).innerText(),/空白/);
  await page.waitForFunction(()=>document.querySelector('.organizer-page[data-position="2"] canvas').height>document.querySelector('.organizer-page[data-position="2"] canvas').width);
  await dialog.locator('[data-org=delete]').click();assert.equal(await tiles.count(),3);
  await tiles.nth(2).click();await tiles.nth(2).dragTo(tiles.nth(0),{targetPosition:{x:5,y:50}});assert.match(await tiles.nth(0).getAttribute('aria-label'),/来源第 3 页/);
  await tiles.nth(0).click();await dialog.locator('[data-org=rotate]').click();await page.waitForFunction(()=>{const c=document.querySelector('.organizer-page canvas');return c.width>c.height;});
  await target('organizer-extracted.pdf');await dialog.locator('[data-org=extract]').click();await page.waitForFunction(()=>document.querySelector('.organizer-dialog [data-status]').textContent.includes('已提取'));
  assert(fs.statSync(savePath).size>100);checks.push('Blank page proportions, drag order, rotation and extract');
  await pick('tests/output/creative-source.pdf');await dialog.locator('[data-org=replace]').click();await page.waitForFunction(()=>!document.querySelector('.organizer-dialog [data-org=replace]').disabled);assert.equal(await tiles.count(),4);
  assert.equal(await dialog.locator('[aria-selected=true]').count(),2);checks.push('Replace selected thumbnails with all pages of the chosen document');
  await target('organizer-ui.pdf');await dialog.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('.organizer-dialog [data-status]').textContent.includes('整理结果已保存'));
  await require('./native-capture.cjs')(app,page,path.join(output,'organizer-ui.png'));await dialog.locator('[data-close]').click();assert.equal(await page.locator('.organizer-dialog').count(),0);
  await page.locator('#ribbon-tab-export').click();
  for(const kind of ['word','excel']){
    await target('office-ui.'+(kind==='word'?'docx':'xlsx'));await page.locator(`[data-ribbon-command=export-${kind}]`).click();
    const form=page.locator('.document-tools');assert.equal(await form.locator('[data-key=ai]').inputValue(),'false');await form.locator('[data-run]').click();
    await page.waitForFunction(()=>!document.querySelector('.document-tools [data-run]').disabled,null,{timeout:120000});
    assert.match(await form.locator('[data-status]').innerText(),/已保存/);
    assert(fs.readFileSync(savePath).subarray(0,2).equals(Buffer.from('PK')));await form.locator('[data-close]').click();
  }
  checks.push('Visible Word and Excel ribbon commands produce local Office files');
  fs.writeFileSync(path.join(output,'organizer-ui.json'),JSON.stringify({status:'passed',checks},null,2));console.log('PASS organizer and Office export UI',checks);
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}})().catch(e=>{console.error(e);process.exitCode=1;});

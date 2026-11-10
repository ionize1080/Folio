const {_electron}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const stamp=Date.now(),app=await _electron.launch({executablePath:process.env.FOLIO_EXE,args:process.env.FOLIO_EXE?[]:[path.resolve('.')],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/image-ui-'+stamp),FOLIO_CHATBOX_PROFILE:path.resolve('tests/output/image-chat-'+stamp)},timeout:60000});
 const checks=[],errors=[];
 try{
  const page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  await page.locator('#ribbon-tab-photo').waitFor();
  await page.evaluate(async()=>{(await import('./i18n.mjs')).setLanguage('zh-Hans');});
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),path.resolve('tests/output/image-studio-geometry/ui-fixture.pdf'));
  await page.locator('[data-action="open"]').first().click();await page.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('ui-fixture'));
  await page.locator('#ribbon-tab-photo').click();await page.locator('[data-ribbon-command="edit-image"]').click();
  const hit=page.locator('.image-page-hit').first();await hit.waitFor();
  await page.locator('.pdf-page[data-ready="true"]').first().waitFor();
  await hit.hover();await page.waitForTimeout(150);
  assert.equal(await hit.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  assert(await page.locator('.pdf-page canvas').first().evaluate(c=>c.width>0&&c.height>0));
  await hit.click({button:'right'});await page.getByRole('menuitem',{name:'快速调整图片',exact:true}).waitFor();
  assert(await page.getByRole('menuitem',{name:'在图像工作室打开',exact:true}).isEnabled());
  await page.keyboard.press('Escape');assert.equal(await page.locator('#context-menu').count(),0);
  await hit.click({button:'right'});await page.getByRole('menuitem',{name:'快速调整图片',exact:true}).click();
  await page.locator('#image-properties .image-adjustments').waitFor();
  await hit.hover();assert.equal(await hit.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  checks.push('Hover and selection stay transparent; right click opens a keyboard-dismissible image menu and quick adjustments');
  await hit.click({button:'right'});await page.getByRole('menuitem',{name:'裁剪 / 替换图片…',exact:true}).click();
  assert(await page.locator('#image-properties details').first().evaluate(e=>e.open));
  await page.locator('#image-done').click();assert.equal(await page.locator('.image-page-layer').count(),0);
  checks.push('Crop action opens the correct inspector group; finishing removes overlay and controls');
  assert.deepEqual(errors,[]);fs.writeFileSync('tests/output/image-studio-ui.json',JSON.stringify({status:'passed',checks},null,2));console.log('PASS image UI',checks);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

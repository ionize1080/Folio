// Right-click menus: text fields, document tabs, thumbnails.
const path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {app,page}=await require('./creative-harness.cjs')(),errors=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.evaluate(async()=>(await import('./i18n.mjs')).setLanguage('zh-Hans'));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},path.resolve('tests/output/organizer-source.pdf'));
  await page.locator('[data-action=open]').first().click();
  await page.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('organizer-source'));await page.locator('#busy').waitFor({state:'hidden'});
  const menu=page.locator('#context-menu');
  // Text field: copy/cut/paste/select all.
  const input=page.locator('.filter-wrap input').first();
  await input.fill('hello world');await input.click({button:'right'});await menu.waitFor();
  assert(await menu.getByRole('menuitem',{name:/粘贴/}).isEnabled());
  assert(await menu.getByRole('menuitem',{name:/剪切/}).isDisabled(),'nothing selected yet');
  await menu.getByRole('menuitem',{name:/全选/}).click();
  assert.equal(await input.evaluate(i=>i.selectionEnd-i.selectionStart),11);
  await input.click({button:'right'});await menu.getByRole('menuitem',{name:/剪切/}).click();
  assert.equal(await input.inputValue(),'');
  checks.push('text-field menu: select all and cut');
  // Document tab menu.
  await page.locator('.document-tab').first().click({button:'right'});await menu.waitFor();
  assert((await menu.locator('button svg').count())>=3);
  assert(await menu.getByRole('menuitem',{name:'关闭其他标签页'}).isDisabled(),'single tab');
  await page.keyboard.press('Escape');assert.equal(await menu.count(),0);
  checks.push('tab menu with icons, disabled close-others for a single tab');
 }catch(e){errors.push(e.stack||e.message)}
 await app.close();
 console.log(JSON.stringify({checks,errors},null,2));
 if(errors.length)process.exit(1);
})();

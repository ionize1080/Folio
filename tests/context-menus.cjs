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
  await page.waitForFunction(() => {const i=document.querySelector('.filter-wrap input');return i.selectionEnd-i.selectionStart===11;});
  await input.click({button:'right'});await menu.getByRole('menuitem',{name:/剪切/}).click();
  await page.waitForFunction(() => document.querySelector('.filter-wrap input').value==='');
  await input.click({button:'right'});await menu.getByRole('menuitem',{name:/粘贴/}).click();
  await page.waitForFunction(() => document.querySelector('.filter-wrap input').value==='hello world');
  await input.fill('');
  checks.push('text-field menu: select all and cut');
  // Document tab menu.
  await page.locator('.document-tab').first().click({button:'right'});await menu.waitFor();
  assert((await menu.locator('button svg').count())>=3);
  assert(await menu.getByRole('menuitem',{name:'关闭其他标签页'}).isDisabled(),'single tab');
  await page.keyboard.press('Escape');assert.equal(await menu.count(),0);
  checks.push('tab menu with icons, disabled close-others for a single tab');
  // Keyboard hints such as Ctrl+[ must not hide the icon.
  const metas=await page.evaluate(async()=>{const {menuMeta}=await import('./context-menu.mjs');return ['逆时针旋转 Ctrl+[','顺时针旋转 Ctrl+]','预览页面 Space','删除所选页面 Del'].map(l=>menuMeta(l))});
  for(const m of metas)assert(m.icon&&m.kbd,JSON.stringify(m));
  checks.push('shortcut hints with brackets keep their icons');
  // Highlight from the reading-area menu: one non-overlapping band per line.
  await page.waitForSelector('.pdf-page .textLayer span');
  await page.evaluate(()=>{const spans=[...document.querySelector('.pdf-page .textLayer').querySelectorAll('span')].filter(el=>el.firstChild?.nodeType===3 && el.getBoundingClientRect().width>0);const r=document.createRange();r.setStartBefore(spans[0]);r.setEndAfter(spans.at(-1));const sel=getSelection();sel.removeAllRanges();sel.addRange(r);});
  const box=await page.locator('.pdf-page .textLayer span').filter({hasText:/\S/}).first().boundingBox();
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2,{button:'right'});await menu.waitFor();
  await menu.getByRole('menuitem',{name:/高亮选中文字/}).click();
  const rects=await page.evaluate(async()=>(await import('./app.mjs')).S.annotations.map(a=>a.rect));
  assert(rects.length>=1,'highlight created');
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const [a,b]=[rects[i],rects[j]];assert(!(Math.min(a[2],b[2])>Math.max(a[0],b[0])+.01&&Math.min(a[3],b[3])>Math.max(a[1],b[1])+.01),'highlight rects overlap');}
  checks.push('context-menu highlight yields non-overlapping line bands ('+rects.length+')');
 }catch(e){errors.push(e.stack||e.message)}
 await app.close();
 console.log(JSON.stringify({checks,errors},null,2));
 if(errors.length)process.exit(1);
})();

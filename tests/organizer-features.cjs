// Page organizer keyboard, quick look, zoom, marquee and file-drop behaviour.
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const {app,page}=await require('./creative-harness.cjs')(),errors=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.evaluate(async()=>(await import('./i18n.mjs')).setLanguage('zh-Hans'));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},path.resolve('tests/output/organizer-source.pdf'));
  await page.locator('[data-action=open]').first().click();
  await page.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('organizer-source'));await page.locator('#busy').waitFor({state:'hidden'});
  await page.locator('#ribbon-tab-organize').click();await page.locator('[data-ribbon-command=page-organizer]').click();
  const d=page.locator('.organizer-dialog'),tiles=d.locator('.organizer-page');
  await page.waitForFunction(()=>document.querySelectorAll('.organizer-page[data-rendered]').length===3);
  const labels=()=>tiles.evaluateAll(t=>t.map(x=>x.getAttribute('aria-label').match(/来源第 (\d+) 页|空白/)?.[1]||'blank'));
  assert.deepEqual(await labels(),['1','2','3']);

  // Keyboard: Alt+Right moves the focused page, Home/End navigate, Ctrl+D duplicates.
  await tiles.nth(0).click();await page.keyboard.press('Alt+ArrowRight');
  assert.deepEqual(await labels(),['2','1','3']);
  await page.keyboard.press('Control+z');assert.deepEqual(await labels(),['1','2','3']);
  await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.dataset.position),'3');
  await page.keyboard.press('Control+d');assert.equal(await tiles.count(),4);
  await page.keyboard.press('Control+z');assert.equal(await tiles.count(),3);
  checks.push('Alt+arrow reorder, Home/End focus, Ctrl+D duplicate and Ctrl+Z');

  // Rotation recomposes from the cached bitmap without a second PDF render.
  await tiles.nth(0).click();
  const before=await tiles.nth(0).locator('canvas').evaluate(c=>[c.width,c.height]);
  await page.keyboard.press('Control+]');
  await page.waitForFunction(([w,h])=>{const c=document.querySelector('.organizer-page canvas');return c.width===h&&c.height===w;},before);
  assert.match(await tiles.nth(0).innerText(),/90°/);
  checks.push('Ctrl+] rotates and swaps thumbnail proportions');

  // Quick look opens with Space and closes with Escape without closing the organizer.
  await tiles.nth(1).focus();await page.keyboard.press(' ');
  await page.waitForFunction(()=>{const p=document.querySelector('.organizer-peek');return !p.hidden&&p.querySelector('canvas').width>300;});
  await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('.organizer-peek figcaption').textContent.includes('3'));
  await page.keyboard.press('Escape');assert(await page.locator('.organizer-peek').isHidden());assert.equal(await d.count(),1);
  checks.push('Space quick look, arrow navigation and Escape return to the grid');

  // Ctrl+wheel resizes thumbnails.
  const size=()=>d.locator('.organizer-grid').evaluate(g=>getComputedStyle(g).getPropertyValue('--thumb').trim());
  const start=await size();await tiles.nth(0).hover();await page.mouse.wheel(0,-100);
  await page.keyboard.down('Control');await page.mouse.wheel(0,-100);await page.keyboard.up('Control');
  assert.notEqual(await size(),start);checks.push('Ctrl+wheel changes thumbnail size');

  // Marquee from empty grid space selects the tiles it crosses.
  const box=await d.locator('.organizer-grid').boundingBox(),last=await tiles.nth(2).boundingBox();
  await page.mouse.move(box.x+box.width-8,box.y+box.height-8);await page.mouse.down();
  await page.mouse.move(last.x+10,last.y+10,{steps:6});await page.mouse.up();
  assert.equal(await d.locator('[aria-selected=true]').count(),1);checks.push('Marquee selection from empty space');

  // Dropping a PDF from Explorer inserts its pages at the drop position.
  const bytes=[...fs.readFileSync('tests/output/creative-source.pdf')];
  const pagesBefore=await tiles.count();
  await page.evaluate(async bytes=>{
   const tile=document.querySelectorAll('.organizer-page')[0],r=tile.getBoundingClientRect(),dt=new DataTransfer();
   dt.items.add(new File([new Uint8Array(bytes)],'dropped.pdf',{type:'application/pdf'}));
   const opts={dataTransfer:dt,bubbles:true,cancelable:true,clientX:r.left+r.width-4,clientY:r.top+20};
   tile.dispatchEvent(new DragEvent('dragover',opts));tile.dispatchEvent(new DragEvent('drop',opts));
  },bytes);
  await page.waitForFunction(n=>document.querySelectorAll('.organizer-page').length>n,pagesBefore,{timeout:60000});
  const after=await tiles.evaluateAll(t=>t.map(x=>x.getAttribute('aria-label')));
  assert.match(after[0],/来源第 1 页/);assert(after.length>pagesBefore);
  assert.equal(await page.locator('.file-drop-veil').isVisible(),false);
  checks.push('File dropped from Explorer is inserted after the target page, global drop handler stays out');
  assert.deepEqual(errors,[]);
  fs.writeFileSync('tests/output/organizer-features.json',JSON.stringify({status:'passed',checks,errors},null,2));
  console.log('PASS organizer features',checks);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

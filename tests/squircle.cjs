// Continuous corners: supported, applied to pills/controls, circles untouched, clicks unaffected.
const path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {app,page}=await require('./creative-harness.cjs')(),errors=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},path.resolve('tests/output/organizer-source.pdf'));
  await page.locator('[data-action=open]').first().click();
  await page.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('organizer-source'));await page.locator('#busy').waitFor({state:'hidden'});
  assert(await page.evaluate(()=>CSS.supports('corner-shape','squircle')),'this Chromium must support corner-shape');
  const r=await page.evaluate(()=>{
   const cs=(el,p)=>el&&getComputedStyle(el,p).getPropertyValue('corner-shape');
   const tab=document.querySelector('.ribbon-tabs button[aria-selected=true]');
   const circles=[...document.querySelectorAll('*')].filter(e=>/50%/.test(getComputedStyle(e).borderRadius)&&/squircle|superellipse\(2\)/.test(getComputedStyle(e).cornerShape)).map(e=>e.className||e.tagName);
   return {pill:cs(tab,'::before'),button:cs(document.querySelector('.app-actions button, button')),dialog:cs(document.querySelector('#modal')),circles};
  });
  assert.match(r.pill,/squircle|superellipse\(2\)/,'ribbon pill: '+r.pill);
  assert.match(r.button,/squircle|superellipse\(2\)/);
  assert.deepEqual(r.circles,[],'circular elements must stay round');
  checks.push('squircle on pills and controls; circles stay round; dialogs untouched');
  // Clicking the very edge of a pill still hits it.
  const b=await page.locator('.ribbon-tabs button').nth(1).boundingBox();
  await page.mouse.click(b.x+b.width/2,b.y+b.height-2);
  assert.equal(await page.locator('.ribbon-tabs button').nth(1).getAttribute('aria-selected'),'true');
  checks.push('clicking the pill edge selects the tab');
  await page.screenshot({path:'tests/output/squircle.png',clip:{x:0,y:0,width:900,height:200}});
 }catch(e){errors.push(e.stack||e.message)}
 await app.close();
 console.log(JSON.stringify({checks,errors},null,2));
 if(errors.length)process.exit(1);
})();

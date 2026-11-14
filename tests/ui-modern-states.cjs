// Captures main-window states: inspector, page edit mode, menus, find bar.
const path=require('node:path'),fs=require('node:fs');
(async()=>{
 const {app,page}=await require('./creative-harness.cjs')();page.setDefaultTimeout(15000);
 await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
 const capture=require('./native-capture.cjs'),dark=!!process.env.TOUR_DARK,sfx=dark?'dark':'light';fs.mkdirSync('tests/output/tour',{recursive:true});
 const shot=async n=>{await page.waitForTimeout(500);await capture(app,page,`tests/output/tour/state-${n}-${sfx}.png`);console.log('ok',n);};
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,900));
  await page.evaluate(async dark=>{(await import('./appearance.mjs')).applyAppearance({theme:dark?'dark':'light',palette:'cobalt'});},dark);
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),path.resolve('tests/output/workflow-250-source.pdf'));
  await page.locator('[data-action=open]').first().click();
  await page.waitForFunction(()=>document.querySelector('#page-total')?.textContent.includes('/ 3'));
  await page.locator('#busy').waitFor({state:'hidden'}).catch(()=>{});
  await page.locator('.tree-row').first().click();await page.evaluate(()=>document.querySelector('[data-action=right-expand]')?.click());await shot('inspector');
  await page.locator('#bookmark-filter-settings summary').click().catch(()=>{});await shot('filter');await page.keyboard.press('Escape');
  await page.locator('.more-tools summary').first().click().catch(()=>{});await shot('more-tools');await page.keyboard.press('Escape');await page.locator('.more-tools[open] summary').click().catch(()=>{});
  await page.locator('.tree-row').first().click({button:'right'});await shot('context');await page.keyboard.press('Escape');
  await page.keyboard.press('Control+f');await page.waitForTimeout(200);await shot('find');await page.keyboard.press('Escape');
  await page.locator('[data-action=flow-edit]').first().click();await page.waitForTimeout(1200);
  const box=await page.locator('.page-edit-hits button, .page-edit-hit').first().boundingBox().catch(()=>null);
  if(box)await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(1500);await shot('page-edit');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1)});

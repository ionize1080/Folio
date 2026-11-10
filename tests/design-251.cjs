const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const {app,page}=await require('./creative-harness.cjs')();const checks=[];page.setDefaultTimeout(15000);
 try{
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),path.resolve('tests/output/workflow-250-source.pdf'));
  await page.locator('[data-action=open]').first().click();await page.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('workflow-250-source'));await page.locator('#busy').waitFor({state:'hidden'});
  async function options(){if(!await page.locator('#bookmark-filter-settings').getAttribute('open').then(v=>v!==null))await page.locator('#bookmark-filter-settings summary').click();}
  for(const lang of ['zh-Hans','zh-Hant','en'])for(const dark of [false,true])for(const size of [[800,520],[1280,850]]){
   console.log('Checking',lang,dark,size);
   await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),size);
   await page.evaluate(async({lang,dark})=>{(await import('./i18n.mjs')).setLanguage(lang);document.body.classList.toggle('dark',dark);},{lang,dark});
   await page.locator('#ribbon-tab-export').click();await page.locator('[data-ribbon-command=export-word]').click();
   for(const action of ['export-word','export-excel','pdfa','metadata']){
    await page.locator(`[data-utility-action=${action}]`).click();
    const g=await page.locator('.document-tools').evaluate(d=>{
     const r=d.getBoundingClientRect(),f=d.querySelector('footer').getBoundingClientRect(),nav=d.querySelector('nav').getBoundingClientRect(),active=d.querySelector('nav [aria-pressed=true]').getBoundingClientRect();
     const icons=[...d.querySelectorAll('nav button svg')].map(e=>e.getBoundingClientRect().left);
     return {bottom:r.bottom,screen:innerHeight,footer:f.bottom,horizontal:d.scrollWidth-d.clientWidth,active:active.bottom<=nav.bottom+1&&active.top>=nav.top-1,icons:Math.max(...icons)-Math.min(...icons)};
    });
    assert(g.bottom<=g.screen+1&&g.footer<=g.screen+1,JSON.stringify({lang,dark,size,g}));assert(g.horizontal<=1);assert(g.active);assert(g.icons<1);
   }
   if(lang==='zh-Hans'&&size[0]===800)await page.screenshot({path:`tests/output/design-251-${dark?'dark':'light'}.png`});
   await page.locator('.document-tools [data-close]').click();
   const metrics=await page.evaluate(()=>{
    const selectors=['#zoom','#layout','.view-options summary','.more-tools summary'];
    return selectors.map(s=>{const e=document.querySelector(s);return {s,gap:getComputedStyle(e).gap,arrow:getComputedStyle(e,e.matches('select')?'::picker-icon':'::before').width};});
   });
   for(const m of metrics)assert.equal(m.gap,'8px',JSON.stringify(m));

   if(lang==='zh-Hans'&&size[0]===800&&!dark){
   console.log('Filtering First');
   await page.locator('#filter').fill('First');
   await page.waitForFunction(()=>!document.querySelector('#filter-select').disabled);
   assert.equal(await page.locator('.tree-row.filter-match').count(),1);
   await page.locator('#filter-select').click();
   assert.equal(await page.locator('.tree-row[aria-selected=true]').count(),1);
   await page.locator('#clear-filter').click();
   console.log('Filtering page');await options();
   await page.locator('#filter-page').fill('2');
   await page.waitForFunction(()=>!document.querySelector('#filter-select').disabled);
   assert.match(await page.locator('.tree-row.filter-match').innerText(),/Second/);
   await page.locator('#clear-filter').click();
   await options();await page.locator('#filter-case').click();
   assert.equal(await page.locator('#filter-case').getAttribute('aria-pressed'),'true');
   console.log('Filtering case');
   await page.locator('#filter').fill('first');
   await page.waitForFunction(()=>!document.querySelector('#filter-select').disabled);
   await page.waitForFunction(()=>document.querySelectorAll('.tree-row.filter-match').length===0);
   assert.equal(await page.locator('.tree-row.filter-match').count(),0);
   await options();await page.locator('#filter-case').click();
   await page.waitForFunction(()=>!document.querySelector('#filter-select').disabled);
   if(lang==='zh-Hans'&&size[0]===800)await page.locator('.filter-wrap').locator('..').screenshot({path:`tests/output/design-251-bookmarks-${dark?'dark':'light'}.png`});
   const filterBounds=await page.locator('.filter-actions').evaluate(e=>({width:e.scrollWidth-e.clientWidth,button:[...e.children].map(b=>b.getBoundingClientRect().height)}));
   assert(filterBounds.width<=1);assert(filterBounds.button.every(h=>h>=30));
   await page.locator('#clear-filter').click();
   await page.locator('.filter-actions').waitFor({state:'hidden'});
   assert.equal(await page.locator('#bookmark-filter-settings').getAttribute('open'),null);
   }
   if(lang==='zh-Hans'&&size[0]===800)await page.locator('.filter-wrap').locator('..').screenshot({path:`tests/output/design-251-bookmarks-idle-${dark?'dark':'light'}.png`});
   checks.push({lang,dark,width:size[0],height:size[1],actions:4,arrowGap:8});
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25));
  await page.locator('[data-action=settings]').click();await page.locator('#modal[open]').waitFor();
  const bounds=await page.locator('#modal').evaluate(e=>({bottom:e.getBoundingClientRect().bottom,screen:innerHeight,overflow:e.scrollWidth-e.clientWidth}));assert(bounds.bottom<=bounds.screen+1&&bounds.overflow<=1);
  await page.screenshot({path:'tests/output/design-251-settings.png'});
  fs.writeFileSync('tests/output/design-251.json',JSON.stringify({status:'passed',checks,settingsAt125Percent:true},null,2));console.log('PASS 48 dialog layouts, three languages, both themes, uniform arrow gaps and enlarged settings');
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

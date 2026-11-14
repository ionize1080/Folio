const {_electron:electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const id=Date.now(), app=await electron.launch({args:[path.resolve('.')],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/chrome-'+id)},timeout:60000});
 const checks=[],errors=[];
 try {
  const p=await app.firstWindow();await p.waitForLoadState('domcontentloaded');p.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},path.resolve('tests/output/ai-202.pdf'));
  await p.locator('[data-action="open"]').first().click();await p.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('ai-202'));await p.locator('#busy').waitFor({state:'hidden'});
  for(const language of ['en','zh-Hans','zh-Hant'])for(const width of [1080,1250,1500])for(const dark of [false,true]){
   console.log('Checking chrome',language,width,dark?'dark':'light');
   await p.locator('[data-action="settings"]').click();
   await p.locator('#settings-language').selectOption(language);
   await p.locator('#set-theme').selectOption(dark?'dark':'light');
   await p.locator('#modal-footer .primary').click();
   await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,850),width);
   assert.equal(await p.locator('.appbar [data-language-select]').count(),0);
   await p.waitForTimeout(100);
   const geometry=await p.evaluate(()=>{
    // Ribbon categories stay mounted; only the active category participates in layout.
    const controls=[...document.querySelectorAll('.appbar > .toolbar button:not(.more-tools-menu button),.appbar > .toolbar summary')].filter(e=>e.checkVisibility());
    const rects=controls.map(e=>{const r=e.getBoundingClientRect();return {label:e.textContent.trim()||e.title,x:r.x,right:r.right,y:r.y,h:r.height}});
    return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,rects};
   });
   assert(!geometry.overflow,JSON.stringify({language,width,dark,geometry}));
   assert(geometry.rects.length>=8,'the active Home commands must remain visible');
   geometry.rects.forEach(r=>assert(r.x>=0&&r.right<=geometry.width&&r.h===32,JSON.stringify({language,width,dark,r})));
   const ribbon=await p.evaluate(()=>{
    const tabs=document.querySelector('.ribbon-tab-row').getBoundingClientRect(),commands=document.querySelector('#ribbon-home').getBoundingClientRect();
    const summary=document.querySelector('.more-tools > summary'),r=summary.getBoundingClientRect();
    return {tabsBottom:tabs.bottom,commandsTop:commands.top,moreClickable:summary.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
   });
   assert(ribbon.commandsTop>=ribbon.tabsBottom&&ribbon.moreClickable,JSON.stringify({language,width,dark,ribbon}));
   await p.locator('.more-tools > summary').click();
   await p.locator('.more-tools-menu').waitFor({state:'visible'});
   await p.keyboard.press('Escape');
   await p.locator('.more-tools > summary').focus();await p.keyboard.press('ArrowDown');
   await p.locator('.more-tools-menu').waitFor({state:'visible'});
   const menu=await p.locator('.more-tools-menu').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom,viewport:innerWidth,height:innerHeight,clipped:e.scrollWidth>e.clientWidth,focus:e.contains(document.activeElement)}});
   assert(menu.x>=0&&menu.right<=menu.viewport&&menu.bottom<=menu.height&&!menu.clipped&&menu.focus,JSON.stringify({language,width,dark,menu}));
   await p.keyboard.press('End');assert.equal(await p.locator('.more-tools-menu button').last().evaluate(e=>e===document.activeElement),true);
   const colors=await p.locator('.more-tools-menu button').first().evaluate(e=>({actual:getComputedStyle(e).color,expected:getComputedStyle(document.body).color}));
   assert.equal(colors.actual,colors.expected,'theme colors update while menu is closed');
   if(width===1250)await require('./native-capture.cjs')(app,p,`tests/output/chrome-${language}-${dark?'dark':'light'}.png`);
   await p.keyboard.press('Escape');assert.equal(await p.locator('.more-tools > summary').evaluate(e=>e===document.activeElement),true);
   checks.push({language,width,theme:dark?'dark':'light',toolbarAligned:true,menuVisible:true,keyboard:true});
  }
  const paths=await p.locator('[data-action="generate"] svg,.folio-ai-open svg,[data-select-mode] svg').evaluateAll(es=>es.map(e=>e.innerHTML));
  assert.equal(new Set(paths).size,paths.length,'distinct icons for distinct tools');
  assert.deepEqual(errors,[]);fs.writeFileSync('tests/output/chrome-202.json',JSON.stringify({status:'passed',checks,errors},null,2));console.log('PASS chrome',checks.length,'language / size / theme combinations');
 }finally{await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

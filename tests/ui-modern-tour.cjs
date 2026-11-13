// Opens most dialogs/surfaces and captures them (light by default; TOUR_DARK=1 for dark).
const path=require('node:path'),fs=require('node:fs');
const items=[
['bookmarks','smart-toc','smart-toc'],['bookmarks','generate','generate'],
 ['bookmarks','batch','batch'],['bookmarks','exchange','exchange'],['bookmarks','calibrate','calibrate'],['bookmarks','whitespace','whitespace'],
 ['bookmarks','bookmark-qc','bookmark-qc'],['bookmarks','bookmark-every','bookmark-every'],['organize','page-organizer','organizer'],
 ['organize','insert-blank-page','blank-page'],['organize','document-assembly','assembly'],['export','document-utilities','doc-tools'],
 ['export','save-project','save-project'],['edit','table-structure','table'],['edit','font-tools','fonts'],['home','print','print'],
 ['home','metadata','metadata'],['home','page-diff','page-diff'],['home','ocr-preview','ocr-preview'],['home','recover','recover'],['home','edit-content','edit-content'],
 ['home','help','help'],['home','settings','settings'], // settings last: closing it restores the saved theme
];
(async()=>{
 const {app,page}=await require('./creative-harness.cjs')();page.setDefaultTimeout(15000);
 await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
 const capture=require('./native-capture.cjs'),dark=!!process.env.TOUR_DARK,suffix=dark?'dark':'light';
 fs.mkdirSync('tests/output/tour',{recursive:true});
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,900));
  await page.evaluate(async dark=>{(await import('./appearance.mjs')).applyAppearance({theme:dark?'dark':'light',palette:'cobalt'});},dark);
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),path.resolve(process.env.TOUR_PDF||'tests/output/workflow-250-source.pdf'));
  await page.locator('[data-action=open]').first().click();
  await page.waitForFunction(()=>document.querySelector('.document-tab,#doc-name')?.textContent.includes('.pdf')||document.querySelector('#page-total')?.textContent.includes('/ '));
  await page.locator('#busy').waitFor({state:'hidden'}).catch(()=>{});
  for(const [tab,cmd,name] of items){
   try{
    await page.evaluate(()=>{document.querySelector('#modal[open] #modal-close,#modal[open] [data-close]')?.click();document.querySelectorAll('dialog[open]').forEach(d=>d.close());});
    const t=page.locator('#ribbon-tab-'+tab);if(await t.count())await t.click();
    const proxy=page.locator(`[data-ribbon-command="${cmd}"]`);
    if(await proxy.count())await proxy.first().click({timeout:4000});
    else await page.evaluate(c=>document.querySelector(`[data-action="${c}"]`)?.click(),cmd);
    await page.waitForTimeout(700);
    await capture(app,page,`tests/output/tour/${name}-${suffix}.png`);
    console.log('ok',name);
   }catch(e){console.log('skip',name,String(e.message).split('\n')[0]);}
  }
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1)});

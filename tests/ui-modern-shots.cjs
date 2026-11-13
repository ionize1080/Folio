// Visual smoke for the Modern theme: captures welcome + document views in both appearances.
const path=require('node:path');
(async()=>{
 const {app,page}=await require('./creative-harness.cjs')();page.setDefaultTimeout(30000);
 await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
 const capture=require('./native-capture.cjs'),out=n=>`tests/output/modern-${n}.png`;
 const theme=(dark,palette='cobalt',lang='zh-Hans')=>page.evaluate(async({dark,palette,lang})=>{(await import('./i18n.mjs')).setLanguage(lang);(await import('./appearance.mjs')).applyAppearance({theme:dark?'dark':'light',palette});},{dark,palette,lang});
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,900));
  for(const dark of[false,true]){await theme(dark);await page.waitForTimeout(300);await capture(app,page,out('welcome-'+(dark?'dark':'light')));}
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),path.resolve('tests/output/workflow-250-source.pdf'));
  await page.locator('[data-action=open]').first().click();
  await page.waitForFunction(()=>document.querySelector('#doc-name,.document-tab')?.textContent.includes('workflow-250'));
  await page.locator('#busy').waitFor({state:'hidden'}).catch(()=>{});
  await page.locator('.tree-row').first().click().catch(()=>{});
  for(const dark of[false,true]){await theme(dark);await page.waitForTimeout(500);await capture(app,page,out('doc-'+(dark?'dark':'light')));}
  for(const p of['jade','amber','mulberry']){await theme(false,p);await page.waitForTimeout(300);await capture(app,page,out('doc-'+p));}
  await theme(false);await page.locator('#ribbon-tab-export').click().catch(()=>{});await page.waitForTimeout(300);await capture(app,page,out('ribbon-export'));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(900,600));await page.waitForTimeout(400);await capture(app,page,out('narrow'));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1)});

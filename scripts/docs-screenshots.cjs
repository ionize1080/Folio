// Capture the real 2.8.3 application with generated public fixtures and fresh profiles.
const fs=require('node:fs'),path=require('node:path');
const {_electron}=require('playwright');
(async()=>{
 const out=path.resolve('docs/images/2.8.3');fs.mkdirSync(out,{recursive:true});
 const profile=path.resolve('tests/output/docs-profile-'+Date.now());
 const app=await _electron.launch({args:[path.resolve('.'),'--force-device-scale-factor=1'],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:profile,FOLIO_CHATBOX_PROFILE:profile+'-chat'},timeout:60000});
 const p=await app.firstWindow();p.setDefaultTimeout(30000);
 await p.emulateMedia({reducedMotion:'reduce'});
 const capture=require('../tests/native-capture.cjs');
 async function shot(name){await p.waitForTimeout(450);await capture(app,p,path.join(out,name+'.png'));console.log('Captured',name);}
 async function close(){for(let i=0;i<4&&await p.locator('dialog[open]').count();i++){let d=p.locator('dialog[open]').last(),b=d.locator('#modal-close,button[data-close]').first();if(await b.count())await b.click();else await p.keyboard.press('Escape');} }
 async function action(a){const proxy=p.locator(`[data-ribbon-command="${a}"]`).first();if(await proxy.count()){const cat=await proxy.evaluate(e=>e.closest('.ribbon-category').id.replace('ribbon-panel-',''));await p.locator('#ribbon-tab-'+cat).click();await proxy.click();}else {await p.locator('#ribbon-tab-home').click();await p.locator(a==='print'?'#print-document':`[data-action="${a}"],#${a}`).first().click();}}
 try{
  await p.locator('#ribbon-tab-home').waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,960));
  await p.evaluate(async()=>{(await import('./i18n.mjs')).setLanguage('zh-Hans');(await import('./appearance.mjs')).applyAppearance({theme:'light',palette:'cobalt'});});
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),path.resolve('docs/examples/Folio-Demo.pdf'));
  await action('open');await p.locator('.pdf-page .textLayer span').first().waitFor();await p.locator('#busy').waitFor({state:'hidden'});
  await p.locator('.tree-row').first().click();await p.keyboard.press('Control+0');await shot('01-reader');
  await action('generate');await p.locator('dialog[open]').first().waitFor();await p.locator('[data-field=pattern]').fill('^0[1-6] +.+');await p.locator('#multi-range').fill('2-6');await p.locator('#multi-run').click();await p.waitForTimeout(600);await shot('02-bookmark-rules');await close();
  await action('bookmark-qc');await p.locator('#qc-summary').waitFor();await shot('03-bookmark-review');await close();
  await action('page-organizer');await p.locator('.organizer-page').first().waitFor();await shot('04-page-organizer');await close();
  await action('font-tools');await p.locator('dialog[open] [role=option]').first().waitFor();await p.locator('dialog[open] [data-sample]').fill('Folio / Aa 123 / Reading and editing');await shot('05-font-workbench');await close();
  await action('export-word');await p.locator('.document-tools').waitFor();await shot('06-word-export');await close();
  await action('print');await p.locator('dialog[open]').first().waitFor();await p.locator('dialog[open] [data-mode=booklet]').click();await shot('07-print');await close();
  await action('settings');await p.locator('.prefs').waitFor();await shot('08-preferences');await close();
  await p.evaluate(async()=>{(await import('./appearance.mjs')).applyAppearance({theme:'dark',palette:'cobalt'});});await p.locator('#ribbon-tab-home').click();await shot('09-dark-reader');
  await p.evaluate(async()=>{(await import('./appearance.mjs')).applyAppearance({theme:'light',palette:'cobalt'});});
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
 if(!process.argv.includes('--base-only'))await require('./docs-screenshots-detail.cjs')();
})().catch(e=>{console.error(e);process.exitCode=1;});

// Runs real OCR on a scanned PDF through the redesigned dialog.
const path=require('node:path');
(async()=>{
 const {app,page}=await require('./creative-harness.cjs')();page.setDefaultTimeout(60000);
 await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
 const capture=require('./native-capture.cjs');
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,900));
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),path.resolve(process.env.OCR_PDF||'tests/output/conversion-scan.pdf'));
  await page.locator('[data-action=open]').first().click();
  await page.waitForFunction(()=>document.querySelector('#page-total')?.textContent.match(/\d/));
  await page.locator('#busy').waitFor({state:'hidden'}).catch(()=>{});
  await page.locator('[data-action=ocr]').first().click();await page.waitForSelector('#ocr-start');
  await page.waitForTimeout(500);await capture(app,page,'tests/output/ocr-live-0-idle.png');
  await page.locator('#ocr-start').click();
  await page.waitForFunction(()=>/识别中|已完成/.test(document.querySelector('#ocr-job-title')?.textContent||''),null,{timeout:60000});
  await page.waitForTimeout(1500);await capture(app,page,'tests/output/ocr-live-1-running.png');
  await page.waitForFunction(()=>document.querySelector('#ocr-job-title')?.textContent==='已完成',null,{timeout:150000});
  await page.waitForTimeout(800);
  const info=await page.evaluate(()=>({title:document.querySelector('#ocr-job-title').textContent,pct:document.querySelector('#ocr-job-pct').textContent,stats:[...document.querySelectorAll('#ocr-stats > div')].map(d=>d.innerText.replace(/\n/g,' ')),options:document.querySelectorAll('#ocr-results option').length,tab:document.querySelector('#ocr-tab-count').textContent}));
  console.log(JSON.stringify(info));
  await capture(app,page,'tests/output/ocr-live-2-done.png');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1)});

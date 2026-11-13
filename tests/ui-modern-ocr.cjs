// Visual smoke for the redesigned OCR workbench with synthetic blocks (no inference).
const path=require('node:path');
(async()=>{
 const {app,page}=await require('./creative-harness.cjs')();page.setDefaultTimeout(30000);
 await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
 const capture=require('./native-capture.cjs'),out=n=>`tests/output/ocr-${n}.png`,tag=process.env.OCR_TAG||'new';
 const theme=dark=>page.evaluate(async dark=>{(await import('./appearance.mjs')).applyAppearance({theme:dark?'dark':'light',palette:'cobalt'});},dark);
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,900));
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),path.resolve('tests/output/workflow-250-source.pdf'));
  await page.locator('[data-action=open]').first().click();
  await page.waitForFunction(()=>document.querySelector('.document-tab,#doc-name')?.textContent.includes('workflow-250'));
  await page.locator('#busy').waitFor({state:'hidden'}).catch(()=>{});
  await page.evaluate(async()=>{const {S}=await import('./app.mjs');
   const words=['Folio 2025','This paragraph preserves the original text positions.','The 2025 report includes a second line','editing and a visible baseline for comparison.','中文段落编辑测试。保留原文字位、字体和行距','数字 2025 后保存，再次打开验证原位布局。'];
   S.ocr=Array.from({length:36},(_,i)=>({id:'qa:'+i,page:1,text:words[i%words.length]+(i>5?' #'+i:''),confidence:i%7===3?0.62:i%11===5?0.78:0.93+((i%5)/100),needsReview:i%7===3,quad:[[60,790-i*19],[420,790-i*19],[420,776-i*19],[60,776-i*19]]}));});
  await page.locator('[data-action=ocr]').first().click();
  await page.waitForSelector('#ocr-results');await page.waitForTimeout(900);
  for(const dark of[false,true]){await theme(dark);await page.waitForTimeout(200);await capture(app,page,out(tag+'-'+(dark?'dark':'light')));}
  await theme(false);
  const first=await page.locator('#ocr-results option').first().getAttribute('value');
  await page.locator('#ocr-results').selectOption(first).catch(()=>{});await page.waitForTimeout(300);await capture(app,page,out(tag+'-select'));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,680));await page.waitForTimeout(500);await capture(app,page,out(tag+'-narrow'));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1)});

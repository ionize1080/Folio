// Exercise the actual packaged preload, native worker and atomic save on Windows.
const {_electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/output'),checks=[],errors=[];
(async()=>{
 assert.equal(process.platform,'win32');assert(process.env.FOLIO_EXE);
 const app=await _electron.launch({executablePath:process.env.FOLIO_EXE,args:[],timeout:60000});let page;
 try{
  page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.waitForSelector('[data-action="open"]');
  await page.evaluate(()=>localStorage.setItem('folio-settings',JSON.stringify({saveSummary:false})));await page.reload();
  const fixture=path.join(out,'p4-narrow.pdf'),saved=path.join(out,'p4-electron-saved.pdf');fs.rmSync(saved,{force:true});
  await app.evaluate(({dialog},{fixture,saved})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});dialog.showSaveDialog=async()=>({canceled:false,filePath:saved});},{fixture,saved});
  await page.locator('[data-action="open"]').first().click();await page.waitForSelector('body.has-document');
  assert((await page.title()).includes(require('../package.json').releaseChannel.toUpperCase()));assert.equal(await page.evaluate(()=>typeof require),'undefined');
  await page.locator('[data-action="flow-edit"]').click();
  await page.locator('[data-cell-id="t0-r0-c0"]').click();
  await page.waitForFunction(()=>/完成/.test(document.querySelector('#pe-status')?.textContent));
  assert.equal((await page.locator('.page-edit-input').inputValue()).trim(),'A');
  await page.locator('.page-edit-input').evaluate(e=>{e.focus();e.select()});await page.locator('#pe-bold').click();
  await page.waitForFunction(()=>/原始字位完成/.test(document.querySelector('#pe-status')?.textContent));
  checks.push('Packaged Windows editor formats a 14pt narrow cell without the two-em validation dead end');
  await page.locator('#pe-more').click();await page.locator('.pe-position>summary').click();
  const height=page.locator('[data-frame="height"]');assert(await height.isEnabled());
  const models=JSON.parse(fs.readFileSync(path.join(out,'p4-narrow-models.json'),'utf8')),model=models.find(m=>m.text.trim()==='A');
  await height.fill(String(model.frame.height+24));await height.press('Tab');
  await page.waitForFunction(()=>/完成/.test(document.querySelector('#pe-status')?.textContent));await page.locator('#pe-close-properties').click();
  await page.screenshot({path:path.join(out,'p4-electron-expanded.png')});
  await page.locator('#pe-done').click();await page.waitForFunction(()=>!document.body.classList.contains('page-edit-mode'));
  await page.locator('[data-action="save"]').click();
  await page.waitForFunction(()=>!document.querySelector('#dirty-dot').classList.contains('changed')&&document.querySelector('#doc-name').textContent.includes('saved'),null,{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#busy').hidden,null,{timeout:60000});
  assert(fs.statSync(saved).size>100);
  const inspection=await page.evaluate(async bytes=>{const {nativeRequest}=await import('./native-source.mjs');return nativeRequest({command:'inspect',bytes:new Uint8Array(bytes),page:1});},Array.from(fs.readFileSync(saved)));
  const table=inspection.tables.find(t=>Math.abs(t.bounds[0]-80)<1);assert(table,'Saved PDF retains table structure');assert(Math.abs(table.bounds[3]-164)<1,JSON.stringify(table.bounds));
  assert(inspection.objects.filter(o=>o.type==='text').map(o=>o.text||'').join('').includes('A'));
  checks.push('Real packaged worker saves grown row and subsequent rows; reopened table bottom is 164pt');
  assert.deepEqual(errors,[]);const exe=await app.evaluate(()=>process.execPath),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const report={platform:process.platform,checks,errors,exe_sha256:hash(exe),asar_sha256:hash(path.join(path.dirname(exe),'resources/app.asar'))};
  fs.writeFileSync(path.join(out,'p4-electron-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){if(page){console.error(await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.join(out,'p4-electron-failure.png')}).catch(()=>{});}throw e;}
 finally{await page?.evaluate(()=>window.desktop?.setDirty(false)).catch(()=>{});await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

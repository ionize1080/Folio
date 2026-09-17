const {_electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/output'),checks=[];
(async()=>{
 const app=await _electron.launch({args:process.env.FOLIO_EXE?[]:[root],executablePath:process.env.FOLIO_EXE,timeout:60000});
 let page;
 try{
  page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForSelector('[data-action="open"]');
  await page.evaluate(()=>{localStorage.setItem('folio-settings',JSON.stringify({saveSummary:false}));});await page.reload();
  const fixture=path.join(out,'v11-fixture.pdf'),saved=path.join(out,'v12-electron-saved.pdf');
  await app.evaluate(({dialog},{fixture,saved})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});dialog.showSaveDialog=async()=>({canceled:false,filePath:saved});},{fixture,saved});
  await page.locator('[data-action="open"]').first().click();await page.waitForSelector('body.has-document');
  assert.equal(await page.evaluate(()=>typeof require),'undefined');checks.push('Real Electron sandbox, preload and open dialog IPC');
  const count=await page.evaluate(async()=>{const {S}=await import('./app.mjs'),{nativeRequest}=await import('./native-source.mjs');const r=await nativeRequest({command:'inspect',bytes:S.bytes,page:1});return r.objects.length;});assert(count>0);
  checks.push('Packaged Windows Python inspector through registered source handle');
  await page.locator('[data-action="flow-edit"]').click();await page.locator('.page-edit-hit').first().click();await page.waitForFunction(()=>/完成/.test(document.querySelector('#pe-status')?.textContent));
  const before=await page.locator('.page-edit-input').inputValue();await page.locator('.page-edit-input').fill(before.slice(0,1)+'A'+before.slice(2));await page.waitForFunction(()=>/完成/.test(document.querySelector('#pe-status')?.textContent));
  await page.locator('#pe-done').click();await page.waitForFunction(()=>!document.body.classList.contains('page-edit-mode'));
  await page.locator('[data-action="save"]').click();await page.waitForFunction(()=>!document.querySelector('#dirty-dot').classList.contains('changed') && document.querySelector('#doc-name').textContent.includes('saved'),null,{timeout:60000});
  assert(fs.statSync(saved).size>100);checks.push('Real Windows native edit and atomic PDF save');
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,'v12-electron.png')});
  const exe=await app.evaluate(()=>process.execPath),hash=p=>require('node:crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  fs.writeFileSync(path.join(out,'v12-electron-report.json'),JSON.stringify({platform:process.platform,checks,errors,exe_sha256:hash(exe),asar_sha256:process.env.FOLIO_EXE?hash(path.join(path.dirname(exe),'resources/app.asar')):null},null,2));console.log(checks);
 }catch(e){if(page){console.error(await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.join(out,'v12-electron-failure.png')}).catch(()=>{});}throw e;}finally{await page?.evaluate(()=>window.desktop?.setDirty(false)).catch(()=>{});await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

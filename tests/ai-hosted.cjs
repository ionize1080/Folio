const {_electron:electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const id=Date.now(), app=await electron.launch({args:[path.resolve('.')],env:{...process.env,FOLIO_TEST_BACKGROUND:'0',FOLIO_TEST_PROFILE:path.resolve('tests/output/hosted-'+id),FOLIO_CHATBOX_PROFILE:path.resolve('tests/output/hosted-chat-'+id)},timeout:60000});
 const errors=[];
 try {
  const host=await app.firstWindow();await host.waitForLoadState('domcontentloaded');
  host.on('pageerror',e=>errors.push(e.message));
  console.log('Opening source-built Chatbox');await host.evaluate(()=>window.desktop.aiOpen());
  const chat=app.context().pages().find(p=>p.url().includes('/renderer/index.html'));
  assert(chat,'Chatbox shares the host Electron context');
  chat.on('pageerror',e=>errors.push(e.message));
  await chat.waitForSelector('textarea[placeholder]',{timeout:30000});
  const settings=await chat.evaluate(()=>window.electronAPI.invoke('getSettings'));
  assert(!settings.providers?.['folio-qwen']);assert(!settings.customProviders?.some(p=>p.name==='Folio Qwen'));
  await host.evaluate(()=>window.desktop.aiApproval(true));await chat.reload();
  await chat.locator('.folio-control[aria-pressed="true"]').waitFor();
  const chosen={provider:'user-test',model:'user-model'};
  await chat.evaluate(async chosen=>{const s=await window.electronAPI.invoke('getSettings');s.defaultChatModel=chosen;await window.electronAPI.invoke('setStoreValue','settings',JSON.stringify(s));},chosen);
  await chat.reload();assert.deepEqual(await chat.evaluate(async()=>(await window.electronAPI.invoke('getSettings')).defaultChatModel),chosen);
  const input=chat.locator('textarea[placeholder]').first();
  for(const mode of ['sidebar','window','sidebar']) {
    await host.evaluate(mode=>window.desktop.aiDisplay(mode),mode);await input.fill('Focus 中文 '+mode);assert.equal(await input.inputValue(),'Focus 中文 '+mode);
  }
  await host.locator('.more-tools > summary').click();
  await host.locator('.more-tools-menu').waitFor({state:'visible'});
  assert.equal(await app.evaluate(()=>globalThis.__folioChatboxHost.view.getVisible()),false,'native view yields to dropdown');
  await host.locator('.more-tools > summary').click();
  await host.locator('[data-action="settings"]').click();
  await host.locator('dialog[open]').waitFor();
  assert.equal(await app.evaluate(()=>globalThis.__folioChatboxHost.view.getVisible()),false,'native view yields to modal');
  await host.locator('#modal-close').click();
  await host.waitForTimeout(300);
  assert.equal(await app.evaluate(()=>globalThis.__folioChatboxHost.view.getVisible()),true);
  await chat.evaluate(()=>{window.folioProgress.begin('test');window.folioProgress.chunk('test',{type:'tool-call',input:{operation:'bookmark.calibrate'}})});
  assert.match(await chat.locator('#folio-progress').innerText(),/校准/);
  await chat.evaluate(()=>window.folioProgress.end('test'));await chat.locator('#folio-progress').waitFor({state:'hidden'});
  await chat.waitForFunction(()=>window.folioToolsStatus().count>=8,{timeout:20000});
  await host.screenshot({path:'tests/output/hosted-202.png'});
  const report={errors,sharedElectron:true,noSeed:true,overlay:true,progress:true,settingsReloadPersisted:true,approvalReloadSynced:true,toolCount:await chat.evaluate(()=>window.folioToolsStatus().count)};
  fs.writeFileSync('tests/output/hosted-202.json',JSON.stringify(report,null,2));assert.deepEqual(errors,[]);console.log('PASS',report);
 } finally{await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

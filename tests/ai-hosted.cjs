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
  let draft='草稿 Draft 123';await input.click();await input.fill(draft);
  for(const [index,mode] of Array.from({length:21},(_,i)=>i%2?'window':'sidebar').entries()) {
    await host.evaluate(mode=>window.desktop.aiDisplay(mode),mode);
    assert.equal(await input.inputValue(),draft,'existing draft survives '+mode);
    draft='Focus 中文 '+mode+' '+index;
    await input.click();await input.fill(draft);assert.equal(await input.inputValue(),draft,'typing immediately after '+mode);
    await chat.waitForFunction(mode=>document.body.dataset.folioDisplay===mode,mode);
    await chat.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(await input.inputValue(),draft,'draft survives responsive layout');
  }
  draft='即时重载也保留 Draft 456';await input.click();await input.fill(draft);await chat.reload();
  await input.waitFor();assert.equal(await input.inputValue(),draft,'reload flushes unsaved debounce');
  await input.click();await input.fill('');assert.equal(await input.inputValue(),'','delete reaches focused editor');await chat.reload();await input.waitFor();
  assert.equal(await input.inputValue(),'','cleared draft does not return');
  await host.locator('.more-tools > summary').click();
  await host.locator('.more-tools-menu').waitFor({state:'visible'});
  async function checkNativeVisible(expected) {
    const start=Date.now();
    while(await app.evaluate(()=>globalThis.__folioChatboxHost.view.getVisible())!==expected) {
      if(Date.now()-start>1500) throw Error('Chatbox native visibility did not follow the active overlay');
      await host.waitForTimeout(10);
    }
  }
  await checkNativeVisible(false);
  await host.locator('.more-tools > summary').click();
  await host.locator('[data-action="settings"]').click();
  await host.locator('dialog[open]').waitFor();
  await checkNativeVisible(false);
  await host.locator('#modal-close').click();
  await checkNativeVisible(true);
  await chat.evaluate(()=>{window.folioProgress.begin('test');window.folioProgress.chunk('test',{type:'tool-call',input:{operation:'bookmark.calibrate'}})});
  assert.match(await chat.locator('#folio-progress').innerText(),/校准/);
  const layout=await chat.evaluate(()=>{
    const progress=document.querySelector('#folio-progress'), input=document.querySelector('textarea[placeholder]');
    const bar=progress.getBoundingClientRect(), field=input.getBoundingClientRect();
    return {inComposer:!!progress.closest('#folio-progress-slot'),overlaps:bar.bottom>field.top && bar.top<field.bottom};
  });
  assert(layout.inComposer && !layout.overlaps,JSON.stringify(layout));
  await chat.evaluate(()=>window.folioProgress.end('test'));await chat.locator('#folio-progress').waitFor({state:'hidden'});
  await chat.waitForFunction(()=>window.folioToolsStatus().count>=8,{timeout:20000});
  await host.screenshot({path:'tests/output/hosted-202.png'});
  const report={errors,sharedElectron:true,noSeed:true,overlay:true,progress:true,settingsReloadPersisted:true,approvalReloadSynced:true,draftSwitches:21,draftImmediateReload:true,draftCleared:true,toolCount:await chat.evaluate(()=>window.folioToolsStatus().count)};
  fs.writeFileSync('tests/output/hosted-202.json',JSON.stringify(report,null,2));assert.deepEqual(errors,[]);console.log('PASS',report);
 } finally{await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

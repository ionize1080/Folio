const {_electron:electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {configure}=require('./ai-live-support.cjs');
(async()=>{
 const file=process.env.FOLIO_LIVE_SAMPLE;assert(file,'Set FOLIO_LIVE_SAMPLE to a read-only test PDF');
 const crypto=require('node:crypto'),digest=()=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),original=digest(),id=Date.now();
 const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/real-'+id),FOLIO_CHATBOX_PROFILE:path.resolve('tests/output/real-chat-'+id)},timeout:60000});
 const checks=[];
 try{
  const host=await app.firstWindow();await host.waitForLoadState('domcontentloaded');host.on('dialog',d=>d.accept());
  await app.evaluate(({dialog,BrowserWindow,ipcMain},file)=>{
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});globalThis.trace=[];globalThis.replies=[];
   const reply=ipcMain._invokeHandlers.get('ai-reply');ipcMain.removeHandler('ai-reply');ipcMain.handle('ai-reply',(e,v)=>{globalThis.replies.push(v);return reply(e,v)});
   const wc=BrowserWindow.getAllWindows()[0].webContents,send=wc.send.bind(wc);wc.send=(n,...a)=>{if(n==='ai-request')globalThis.trace.push(a[0].params);return send(n,...a)}
  },file);
  await host.locator('[data-action="open"]').first().click();await host.waitForFunction(name=>document.querySelector('#doc-name').textContent.includes(name),path.basename(file));
  await host.locator('#busy').waitFor({state:'hidden',timeout:90000});
  await host.locator('[data-action="settings"]').click();await host.locator('#set-ai-approval').selectOption('auto');await host.locator('#modal-footer .primary').click();await host.evaluate(()=>window.desktop.aiOpen());
  const chat=app.context().pages().find(p=>p.url().includes('/renderer/index.html'));await chat.waitForSelector('textarea[placeholder]');await configure(chat);
  for(const [task,expected] of [
   ['请检查当前教材第4页的目录，使用现成工具给出识别条数和需要复核的情况。只检查第4页，正文仅核对第6到15页，暂不修改文件。','toc'],
   ['请用文件级工具一次性检查当前文档的信息、前2页文字和前5个书签，返回简短概述，勿修改文件。','read_pdf_batch']].filter(([,expected])=>!process.env.FOLIO_SAMPLE_TASK||expected===process.env.FOLIO_SAMPLE_TASK)){
    await app.evaluate(()=>{globalThis.trace=[];globalThis.replies=[]});await chat.keyboard.press('Control+n');await chat.waitForTimeout(300);const input=chat.locator('textarea[placeholder]').first();await input.fill(task);await input.press('Enter');await chat.locator('#folio-progress').waitFor({state:'visible'});await chat.locator('#folio-progress').waitFor({state:'hidden',timeout:240000});
    const trace=await app.evaluate(()=>globalThis.trace);
    console.log('Selected tools',JSON.stringify(trace.map(t=>({name:t.name,operation:t.arguments?.operation,action:t.arguments?.action,query:t.arguments?.query}))));
    fs.writeFileSync('tests/output/real-'+expected+'.txt',await chat.locator('body').innerText());
    assert(trace.some(t=>t.arguments?.action===expected||t.arguments?.operation===expected),'Must reuse '+expected);
    const replies=await app.evaluate(()=>globalThis.replies);assert(replies.length&&replies.every(r=>!r.error&&!r.result?.isError),'No tool failures');
    if(expected==='read_pdf_batch'){
     const batches=trace.filter(t=>t.name==='pdf_operation'&&t.arguments?.operation===expected);
     assert.equal(batches.length,1,'one batch, no failed retries');assert(trace.length<=4,'at most snapshot, discovery, schema, batch');
     assert.deepEqual(batches[0].arguments.options.queries.map(q=>q.op).sort(),['info','outline','text']);
    }
    checks.push({task,tools:trace.map(t=>({name:t.name,action:t.arguments?.action,operation:t.arguments?.operation})),allCallsSucceeded:true});console.log('PASS real sample',expected,trace.length,'calls');
  }
  assert.equal(digest(),original);fs.writeFileSync('tests/output/real-sample-202.json',JSON.stringify({status:'passed',source:path.basename(file),sourceUnchanged:true,checks},null,2));
 }finally{try{await(await app.firstWindow()).evaluate(()=>window.desktop.setDirty(false))}catch{}await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

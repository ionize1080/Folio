const {_electron:electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {configure}=require('./ai-live-support.cjs');
(async()=>{
 const id=Date.now(),app=await electron.launch({args:[path.resolve('.')],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/live-'+id),FOLIO_CHATBOX_PROFILE:path.resolve('tests/output/live-chat-'+id)},timeout:60000});
 const checks=[],errors=[];
 try {
  const host=await app.firstWindow();await host.waitForLoadState('domcontentloaded');host.on('dialog',d=>d.accept());
  await app.evaluate(({dialog,BrowserWindow,ipcMain})=>{
   globalThis.aiReplies={};
   const reply=ipcMain._invokeHandlers.get("ai-reply");ipcMain.removeHandler("ai-reply");ipcMain.handle("ai-reply",(e,v)=>{globalThis.aiReplies[v.id]=v;return reply(e,v)});
   globalThis.aiTrace=[];const wc=BrowserWindow.getAllWindows()[0].webContents,send=wc.send.bind(wc);
   wc.send=(name,...args)=>{if(name==='ai-request')globalThis.aiTrace.push(args[0].params);return send(name,...args)};
   const original=globalThis.fetch;globalThis.headerAudits=[];
   globalThis.fetch=(url,init)=>{if(String(url).includes('/chat/completions'))globalThis.headerAudits.push({userAgent:new Headers(init?.headers).get('user-agent'),bearer:new Headers(init?.headers).get('authorization')?.startsWith('Bearer ')});return original(url,init)};
  });
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},path.resolve('tests/output/ai-202.pdf'));
  await host.locator('[data-action="open"]').first().click();await host.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('ai-202'));
  await host.locator('[data-action="settings"]').click();await host.locator('#set-ai-approval').selectOption('auto');await host.locator('#modal-footer .primary').click();
  await host.evaluate(()=>window.desktop.aiOpen());
  const chat=app.context().pages().find(p=>p.url().includes('/renderer/index.html'));await chat.waitForSelector('textarea[placeholder]');chat.on('pageerror',e=>errors.push(e.message));
  const model=await configure(chat);
  let readId=-1;
  async function read(){
   const id=readId--;
   await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows()[0].webContents.send('ai-request',{id,params:{name:'folio_bookmarks',arguments:{action:'read',detail:'full'}}}),id);
   for(let n=0;n<100;n++){const r=await app.evaluate((_,id)=>globalThis.aiReplies[id],id);if(r){assert(!r.error,r.error);return r.result.nodes}await host.waitForTimeout(50)}throw Error('read timeout');
  }
  async function ask(task,expected){
   await app.evaluate(()=>{globalThis.aiTrace=[]});
   await chat.keyboard.press('Control+n');await chat.waitForTimeout(400);
   const input=chat.locator('textarea[placeholder]').first();await input.fill(task);const start=Date.now();await input.press('Enter');
   await chat.locator('#folio-progress').waitFor({state:'visible',timeout:15000});
   const initial=await chat.locator('#folio-progress').innerText();
   await chat.locator('#folio-progress').waitFor({state:'hidden',timeout:180000});
   const trace=await app.evaluate(()=>globalThis.aiTrace),body=await chat.locator('body').innerText();
   fs.writeFileSync('tests/output/live-'+expected+'.txt',body);
   console.log(expected,JSON.stringify(trace.map(t=>({name:t.name,operation:t.arguments?.operation,action:t.arguments?.action}))),Math.round((Date.now()-start)/1000)+'s');
   assert(trace.some(t=>t.name===expected),'Natural request should select '+expected);
   if(expected==='folio_document'){assert(trace.filter(t=>t.arguments?.action==='image').length===1,'image should not require retries');assert(trace.some(t=>JSON.stringify(t.arguments?.region)==='[0,0,1,0.5]'),'exact requested crop');assert(body.includes('Chapter 1'));}
   checks.push({task,expected,tools:trace.map(t=>({name:t.name,operation:t.arguments?.operation,action:t.arguments?.action})),seconds:(Date.now()-start)/1000,initialProgress:initial});
  }
  const before=await read();
  await ask('请校准所有书签的目标位置，标题上方保留5毫米留白。明确匹配的直接处理，不确定的保留原目标并告诉我。','folio_calibrate');
  const calibrated=await read();assert(calibrated.length===before.length);
  calibrated.forEach((n,i)=>{assert.equal(n.target.page,i+1);assert(n.target.args[1]>730 && n.target.args[1]<800,"title target within actual heading region: "+n.target.args[1])});
  await ask('请给所有书签目标再增加3毫米留白。','folio_whitespace');
  const spaced=await read();spaced.forEach((n,i)=>{assert(Math.abs(n.target.args[1]-calibrated[i].target.args[1]-3*72/25.4)<0.01)});
  await ask('请把顶层书签加粗，其他样式和子级书签保持不变。','folio_bookmarks');
  const styled=await read();styled.forEach((n,i)=>{assert.deepEqual(n.target,spaced[i].target);assert.equal(n.bold,!n.parent?true:spaced[i].bold);assert.equal(n.italic,spaced[i].italic);assert.equal(n.color,spaced[i].color)});
  await ask('读取当前文档第1页的上半页图像，告诉我图像中最大的英文标题。','folio_document');
  const audits=await app.evaluate(()=>globalThis.headerAudits);assert(audits.length);assert(audits.every(a=>a.bearer&&a.userAgent?.includes('ai-sdk')));
  await chat.screenshot({path:'tests/output/live-202.png'});
  fs.writeFileSync('tests/output/live-202.json',JSON.stringify({status:'passed',model,checks,headers:audits,independentStateChecks:true,errors},null,2));assert.deepEqual(errors,[]);
 } finally{try{await (await app.firstWindow()).evaluate(()=>window.desktop.setDirty(false))}catch{}await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

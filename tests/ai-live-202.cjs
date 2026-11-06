const {_electron:electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {configure}=require('./ai-live-support.cjs');
(async()=>{
 const id=Date.now(),app=await electron.launch({args:[path.resolve('.')],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/live-'+id),FOLIO_CHATBOX_PROFILE:path.resolve('tests/output/live-chat-'+id)},timeout:60000});
 const checks=[],errors=[];
 try {
  const host=await app.firstWindow();await host.waitForLoadState('domcontentloaded');host.on('dialog',d=>d.accept());
  await app.evaluate(({dialog,BrowserWindow,ipcMain,app})=>{
   globalThis.aiReplies={};
   const reply=ipcMain._invokeHandlers.get("ai-reply");ipcMain.removeHandler("ai-reply");ipcMain.handle("ai-reply",(e,v)=>{if(v.id<0)globalThis.aiReplies[v.id]=v;
     const item=globalThis.aiTrace?.find(t=>t.requestId===v.id);
     if(item){
       item.ms=Date.now()-item.started; item.error=v.error;
       const content=v.result?.content;
       item.images=(content||[]).filter(b=>b.type==="image").map(b=>({mime:b.mimeType,bytes:Math.floor(b.data.length*.75)}));
       item.textBytes=Buffer.byteLength(JSON.stringify(content?content.filter(b=>b.type==="text"):v.result)||"");
       if(item.images.length && content?.[0]?.text)try{const m=JSON.parse(content[0].text);item.dimensions=[m.width,m.height]}catch{}
     }
     return reply(e,v)});
   globalThis.aiTrace=[];
   const watch=wc=>{
     const send=wc.send.bind(wc);
     wc.send=(name,...args)=>{if(name==='ai-request')globalThis.aiTrace.push({...args[0].params,requestId:args[0].id,started:Date.now()});return send(name,...args)};
   };
   watch(BrowserWindow.getAllWindows()[0].webContents);app.on('web-contents-created',(_,wc)=>watch(wc));
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
  async function ask(task,expected,verify){
   await app.evaluate(()=>{globalThis.aiTrace=[]});
   await chat.locator('textarea[placeholder]').first().click();
   const apiStart=await app.evaluate(()=>globalThis.headerAudits.length);
   await chat.keyboard.press('Control+n');await chat.waitForTimeout(400);
   const input=chat.locator('textarea[placeholder]').first();await input.fill(task);const start=Date.now();
   const completed=await chat.evaluate(()=>window.folioProgress.status().completed);
   await input.press('Enter');
   try {await chat.waitForFunction(n=>window.folioProgress.status().completed>n,completed,{timeout:200000});}
   catch(error){
    const trace=await app.evaluate(()=>globalThis.aiTrace.map(({name,arguments:a,ms,error})=>({name,action:a?.action,operation:a?.operation,ms,error})));
    fs.writeFileSync('tests/output/live-timeout-trace.json',JSON.stringify(trace,null,2));
    fs.writeFileSync('tests/output/live-timeout-transcript.txt',(await chat.locator('body').innerText()).slice(-30000));
    console.error('Timed out trace',JSON.stringify(trace));throw error;
   }
   const initial=await chat.evaluate(()=>window.folioProgress.status().lastGeneration.firstVisible);
   assert(initial,'Native progress was displayed during the actual model request');
   const trace=await app.evaluate(()=>globalThis.aiTrace),body=await chat.locator('body').innerText();
   const finalText=await chat.locator('.msg-content').last().locator(':scope > div > div').last().innerText().catch(()=> '');
   fs.writeFileSync('tests/output/live-'+expected+'.txt',finalText);
   console.log(expected,JSON.stringify(trace.map(t=>({name:t.name,operation:t.arguments?.operation,action:t.arguments?.action}))),Math.round((Date.now()-start)/1000)+'s');
   assert(trace.some(t=>t.name===expected),'Natural request should select '+expected);
   if(verify) await verify(trace,finalText);
   else if(expected==='folio_document'){const renders=trace.filter(t=>t.name==='folio_render'||(t.name==='folio_document'&&t.arguments?.action==='image'));assert.equal(renders.length,1,'page image should not require retries');assert(renders[0].images?.some(i=>i.mime==='image/png'&&i.bytes>100),'actual native image returned');assert(!renders[0].error);assert.equal(JSON.stringify(renders[0].arguments?.region),'[0,0,1,0.5]','exact requested crop');assert(body.includes('Chapter 1'));}
   checks.push({task,expected,apiRequests:(await app.evaluate(()=>globalThis.headerAudits.length))-apiStart,tools:trace.map(t=>({name:t.name,operation:t.arguments?.operation,action:t.arguments?.action,ms:t.ms,textBytes:t.textBytes,images:t.images,dimensions:t.dimensions,error:t.error})),seconds:(Date.now()-start)/1000,initialProgress:initial});
  }
  if(!process.env.FOLIO_DEV_EXTRA_ONLY){
  const before=await read();
  await ask('请校准所有书签的目标位置，标题上方保留5毫米留白。明确匹配的直接处理，不确定的保留原目标并告诉我。','folio_calibrate');
  const calibrated=await read();assert(calibrated.length===before.length);
  calibrated.forEach((n,i)=>{assert.equal(n.target.page,i+1);assert(n.target.args[1]>730 && n.target.args[1]<800,"title target within actual heading region: "+n.target.args[1])});
  await ask('请给所有书签目标再增加3毫米留白。','folio_whitespace');
  const spaced=await read();spaced.forEach((n,i)=>{assert(Math.abs(n.target.args[1]-calibrated[i].target.args[1]-3*72/25.4)<0.01)});
  await ask('请把顶层书签加粗，其他样式和子级书签保持不变。','folio_bookmarks');
  const styled=await read();styled.forEach((n,i)=>{assert.deepEqual(n.target,spaced[i].target);assert.equal(n.bold,!n.parent?true:spaced[i].bold);assert.equal(n.italic,spaced[i].italic);assert.equal(n.color,spaced[i].color)});
  await ask('读取当前文档第1页的上半页图像，告诉我图像中最大的英文标题。','folio_document');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},path.resolve('tests/output/field-notes.pdf'));
  const newPage=app.context().waitForEvent('page',p=>p!==host && p!==chat);
  await host.evaluate(()=>window.desktop.openDocuments());
  const other=await newPage;
  await other.locator('.tree-row').first().click();
  await other.waitForFunction(()=>document.querySelector('#page-number').value==='3');
  const state=await other.evaluate(()=>window.desktop.tabsState());
  assert.equal(state.documents.length,2);
  const first=state.documents.find(d=>d.name==='ai-202.pdf').documentId;
  await ask('查询我当前所在的物理页和选中书签标题，读出这一页的标本编号。同时查看另一个打开的 PDF，给出它第一页的大号英文标题。请把四项写在最终回答里。','folio_document',(trace,body)=>{
    const calls=trace.filter(t=>t.name==='folio_document').map(t=>t.arguments);
    assert(calls.some(a=>a.action==='context'),'Read live selection');
    assert(calls.some(a=>a.action==='list'),'Enumerate open PDFs');
    assert(calls.some(a=>a.documentId===first && ['text','image','objects','brief'].includes(a.action))||trace.some(t=>t.name==='folio_render'&&t.arguments.documentId===first&&t.images?.length&&!t.error),'Read the inactive PDF by ID');
    assert(body.includes('ORCHID-812') && body.includes('Field observation') && body.includes('Chapter 1') && /3/.test(body),'Both documents and correct current page');
  });
  }
  await require("./ai-live-workflows.cjs")({app,host,chat,ask});
  const audits=await app.evaluate(()=>globalThis.headerAudits);assert(audits.length);assert(audits.every(a=>a.bearer&&a.userAgent?.includes('ai-sdk')));
  await chat.screenshot({path:'tests/output/live-202.png'});
  fs.writeFileSync('tests/output/live-202.json',JSON.stringify({status:'passed',model,checks,headers:audits,independentStateChecks:true,errors},null,2));assert.deepEqual(errors,[]);
 } finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{})}
})().catch(e=>{console.error(e);process.exitCode=1});

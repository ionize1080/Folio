// Real configured Qwen, the shipped Chatbox transport, and the live Folio tools.
// No output/context token ceiling is added by this acceptance test.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
(async()=>{
 const {app,page:host,call}=await require('./creative-harness.cjs')(),checks=[],out=path.resolve('tests/output');let chat;
 try{
  await app.evaluate(({BrowserWindow,ipcMain})=>{
   globalThis.creativeTrace=[];globalThis.creativeApi=[];
   const wc=BrowserWindow.getAllWindows()[0].webContents,send=wc.send.bind(wc);
   wc.send=(name,...args)=>{if(name==='ai-request'&&args[0].id>0)globalThis.creativeTrace.push({requestId:args[0].id,...args[0].params});return send(name,...args);};
   const reply=ipcMain._invokeHandlers.get('ai-reply');ipcMain.removeHandler('ai-reply');
   ipcMain.handle('ai-reply',(e,v)=>{const t=globalThis.creativeTrace.find(t=>t.requestId===v.id);if(t){t.error=v.error;t.completed=true;}return reply(e,v);});
   const fetch=globalThis.fetch;
   globalThis.fetch=(url,init)=>{if(String(url).includes('/chat/completions')){const b=JSON.parse(init.body);globalThis.creativeApi.push({model:b.model,maxTokens:b.max_tokens??b.max_completion_tokens??b.max_output_tokens??null,messageCount:b.messages?.length});}return fetch(url,init);};
  });
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.join(out,'creative-source.pdf'));
  await host.locator('[data-action=open]').first().click();await host.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('creative-source'));await host.locator('#busy').waitFor({state:'hidden'});
  const original=(await call({action:'objects',page:1})).objects.find(o=>o.kind==='image');assert(original);
  await host.evaluate(()=>window.desktop.aiOpen());chat=app.context().pages().find(p=>p.url().includes('/renderer/index.html'));await chat.waitForSelector('textarea[placeholder]');
  const model=await require('./ai-live-support.cjs').configure(chat);await host.evaluate(()=>window.desktop.aiApproval(true));
  async function ask(name,prompt){
   const start=Date.now(),completed=await chat.evaluate(()=>window.folioProgress.status().completed),first=await app.evaluate(()=>globalThis.creativeTrace.length);
   try{await require('./ai-live-support.cjs').send(chat,prompt);await chat.waitForFunction(n=>window.folioProgress.status().completed>n,completed,{timeout:600000});}
   catch(error){console.error('Qwen acceptance stalled',name,JSON.stringify(await app.evaluate(()=>({apiRequests:globalThis.creativeApi.length,tools:globalThis.creativeTrace.map(t=>({name:t.name,action:t.arguments?.action,completed:t.completed,error:t.error}))}))),(await chat.locator('body').innerText()).slice(-3000));throw error;}
   finally{fs.writeFileSync(path.join(out,'creative-live-'+name+'.txt'),await chat.locator('body').innerText());fs.writeFileSync(path.join(out,'creative-live-trace.json'),JSON.stringify(await app.evaluate(()=>globalThis.creativeTrace),null,2));}
   const trace=(await app.evaluate(()=>globalThis.creativeTrace)).slice(first);assert(trace.some(t=>t.completed&&!t.error),'Real model must complete actual tools');
   console.log('Qwen',name,Math.round((Date.now()-start)/1000)+'s',trace.map(t=>t.name+':'+(t.arguments.action||'organize')+(t.error?' ERROR':'')));
   checks.push({name,seconds:(Date.now()-start)/1000,tools:trace.map(t=>({name:t.name,action:t.arguments.action,command:t.arguments.command,method:t.arguments.method,error:t.error}))});return trace;
  }
  const photoTrace=await ask('raster','这是 Folio 的实际编辑验收，请直接操作当前 PDF。用 folio_studio objects 找到第1页第一个原有图像，在 photo 工作室打开且 visible=true。查询 commands 获取 layer.new.layer 和 paint.stroke 的准确参数，新建名为 Qwen raster 的图层，用 #00b050、size=8 从图像坐标 [12,12] 画到 [64,42]。调用 preview 实际检查图像，然后取得最新 revision 并 apply。保持原图在 PDF 中的位置、大小和旋转，不关闭会话，不另外导出。完成后简短报告。');
  assert(photoTrace.some(t=>t.arguments.action==='commands'));assert(photoTrace.some(t=>t.arguments.action==='preview'));
  let sessions=(await call({action:'list'})).sessions;const photo=sessions.find(s=>s.kind==='photo');assert(photo,'AI must open the raster editor');
  let objects=(await call({action:'objects',page:1})).objects,placedPhoto=objects.find(o=>o.kind==='photo');assert(placedPhoto,'AI must apply raster artwork');assert.deepEqual(placedPhoto.matrix,original.matrix);
  const photoPixels=(await call({action:'preview',sessionId:photo.sessionId})).content[0].data;
  const photoState=await call({action:'inspect',sessionId:photo.sessionId});assert(JSON.stringify(photoState.document).includes('Qwen raster'));
  fs.writeFileSync(path.join(out,'creative-live-raster.png'),Buffer.from(photoPixels,'base64'));
  await ask('raster-view','继续刚才的同一图像会话。设置 background 为 PDF 页面、opacity=0.4；将 view 缩放到12800%，然后适合 PDF 页面并水平居中、垂直居中。不要做任何像素或 PDF 几何修改。最后取最新 revision 再 apply 一次。保留会话，简短报告。');
  assert.equal((await call({action:'preview',sessionId:photo.sessionId})).content[0].data,photoPixels);
  objects=(await call({action:'objects',page:1})).objects;assert.deepEqual(objects.find(o=>o.id===placedPhoto.id).matrix,original.matrix);
  const back=await call({action:'request',sessionId:photo.sessionId,method:'folio.backdrop'});assert.equal(back.mode,'pdf');assert(Math.abs(back.opacity-.4)<.01);
  await ask('vector','现在用 folio_studio 新建 vector 工作室，画板200×120，visible=true。先用 commands 查询 shape.rectangle、object.pathfinder.unite、paint.setFill、text.create 的参数。创建两个相交矩形并合并为一个路径，设置从 #245bd4 到 #00b050 的线性渐变，再加入可见文字 Qwen vector。preview 检查，取得最新 revision 后 apply 到第1页 box=[180,40,160,96]。不要更改之前的图像，不关闭会话，完成后报告。');
  sessions=(await call({action:'list'})).sessions;const vector=sessions.find(s=>s.kind==='vector');assert(vector);
  objects=(await call({action:'objects',page:1})).objects;const placedVector=objects.find(o=>o.kind==='vector'&&o.target==='studio');assert(placedVector);
  assert.deepEqual(placedVector.matrix,[160,0,0,96,180,40]);
  const vectorPixels=(await call({action:'preview',sessionId:vector.sessionId})).content[0].data;
  fs.writeFileSync(path.join(out,'creative-live-vector.png'),Buffer.from(vectorPixels,'base64'));
  const vectorState=await call({action:'inspect',sessionId:vector.sessionId});assert(JSON.stringify(vectorState.document).includes('Qwen vector'));
  await ask('vector-view','继续当前矢量会话：将画布背景设为 PDF，opacity=0.55，view 缩放64000%，再适合PDF页面。只调整视图，不编辑路径或放置几何。取最新 revision 并 apply，保持会话。');
  assert.equal((await call({action:'preview',sessionId:vector.sessionId})).content[0].data,vectorPixels);
  objects=(await call({action:'objects',page:1})).objects;assert.deepEqual(objects.find(o=>o.id===placedVector.id).matrix,placedVector.matrix);assert.deepEqual(objects.find(o=>o.id===placedPhoto.id).matrix,original.matrix);
  const finalPDF=path.join(out,'creative-live.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},finalPDF);
  await host.evaluate(()=>document.querySelector('[data-action="save-as"]').click());await host.waitForFunction(()=>document.querySelector('#doc-name').textContent==='creative-live.pdf');
  const organized=path.join(out,'creative-live-organized.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},organized);
  await ask('organize','把当前 PDF 按原第2页、第1页、第1页的顺序另存一份，使用 folio_organize、最新 revision 和 options.order。保留当前已应用的图像与矢量编辑，不修改各页内容。不再进行其他操作。');assert(fs.existsSync(organized));
  const independent=JSON.parse(execFileSync(process.env.FOLIO_PYTHON||path.resolve('native/runtime/python.exe'),[path.resolve('tests/creative-live-verify.py')],{encoding:'utf8'}));
  const api=await app.evaluate(()=>globalThis.creativeApi);assert(api.length>=5,'Must use actual Qwen requests');assert(api.every(r=>r.maxTokens===null),'Live acceptance must not impose an output token limit');
  const trace=await app.evaluate(()=>globalThis.creativeTrace);assert(trace.some(t=>t.arguments.command==='object.pathfinder.unite'||t.arguments.steps?.some(s=>s.id==='object.pathfinder.unite')));
  fs.writeFileSync(path.join(out,'creative-live.json'),JSON.stringify({status:'passed',model,apiRequests:api.length,outputTokenLimit:null,checks,independent,placementUnchanged:true,viewOnlyExports:true,sameChat:true},null,2));console.log('PASS real Qwen artwork editing, view isolation and page organization',api.length,'API requests');
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

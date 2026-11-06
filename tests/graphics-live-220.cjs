const {_electron:electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {configure}=require('./ai-live-support.cjs');
(async()=>{
 const id=Date.now(),app=await electron.launch({executablePath:process.env.FOLIO_EXE,args:process.env.FOLIO_EXE?[]:[path.resolve('.')],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/graphics-live-'+id),FOLIO_CHATBOX_PROFILE:path.resolve('tests/output/graphics-live-chat-'+id)},timeout:60000});
 try{
  const host=await app.firstWindow();await host.locator('.folio-ai-open').waitFor();host.on('dialog',d=>d.accept());
  await app.evaluate(({dialog,ipcMain,BrowserWindow},file)=>{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});globalThis.graphicsTrace=[];globalThis.imageRequests=[];
    const send=BrowserWindow.getAllWindows()[0].webContents.send.bind(BrowserWindow.getAllWindows()[0].webContents);
    BrowserWindow.getAllWindows()[0].webContents.send=(channel,...args)=>{if(channel==='ai-request')globalThis.graphicsTrace.push({id:args[0].id,...args[0].params,started:Date.now()});return send(channel,...args);};
    const reply=ipcMain._invokeHandlers.get('ai-reply');ipcMain.removeHandler('ai-reply');ipcMain.handle('ai-reply',(e,v)=>{const t=globalThis.graphicsTrace.find(t=>t.id===v.id);if(t){t.error=v.error;t.finished=Date.now();if(v.result?.results)t.assets=v.result.results.map(r=>({assetId:r.assetId,error:r.error}));}return reply(e,v);});
    const fetch=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(!String(url).includes('multimodal-generation/generation')&&!String(url).includes('/images/generations'))return fetch(url,init);const t={start:Date.now()};globalThis.imageRequests.push(t);try{const r=await fetch(url,init);t.status=r.status;return r;}finally{t.end=Date.now();}};
  },path.resolve('tests/output/graphics-220-source.pdf'));
  await host.locator('[data-action="open"]').first().click();await host.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('graphics-220-source'));
  await host.evaluate(()=>window.desktop.aiApproval(true));await host.evaluate(()=>window.desktop.aiOpen());
  const chat=app.context().pages().find(p=>p.url().includes('/renderer/index.html'));await chat.waitForSelector('textarea[placeholder]');const model=await configure(chat);
  const task='请直接完成：用 folio_image 的 generate_new 一次传两个 prompts，并行生成两张 512x512 的简单产品插画：白底蓝色陶瓷杯、白底绿色叶子。parameters 用 size="512x512", enable_thinking=false。生成后依次把两张图片插入第2页，分别放在 PDF 坐标 x=40,y=270 和 x=270,y=270，width=180,height=150。然后把第一张图片旋转25度，透明度改为0.7。不要替换旧图片。再在第2页下半部添加一个原生矢量渐变矩形，红到蓝，白色横线，box=[80,70,300,120]。不要生成渐变矩形的位图。每次写入使用最新revision，完成后简短报告。';
  const completed=await chat.evaluate(()=>window.folioProgress.status().completed);await chat.locator('textarea[placeholder]').first().fill(task);await chat.locator('textarea[placeholder]').first().press('Enter');
  await chat.waitForFunction(n=>window.folioProgress.status().completed>n,completed,{timeout:420000});
  const trace=await app.evaluate(()=>globalThis.graphicsTrace),requests=await app.evaluate(()=>globalThis.imageRequests);
  fs.writeFileSync('tests/output/graphics-220-live-trace.json',JSON.stringify({trace,requests},null,2));
  const imageCalls=trace.filter(t=>t.name==='folio_image');assert(imageCalls.some(t=>t.arguments.action==='generate_new'&&t.arguments.prompts?.length===2),'main model requested parallel image generation');
  assert.equal(requests.length,2);assert(requests.every(r=>r.status===200));assert(requests[0].start<requests[1].end&&requests[1].start<requests[0].end,'real image requests overlap');
  const state=await host.evaluate(async()=>{const {S}=await import('./app.mjs');return {images:S.nativeEdits.filter(e=>e.type==='inserted-image').map(({imageData,...rest})=>({...rest,bytes:imageData.length})),vectors:S.nativeEdits.filter(e=>e.type==='vector-graphic')}});
  assert.equal(state.images.length,2);assert(state.images.every(e=>e.page===2&&e.bytes>1000));assert(state.images.some(e=>e.opacity===.7&&Math.abs(Math.atan2(e.matrix[1],e.matrix[0])*180/Math.PI-25)<.01));assert.equal(state.vectors.filter(e=>!e.delete).length,1);
  const file=path.resolve('tests/output/graphics-220-live.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file})},file);
  await host.keyboard.press('Control+Shift+s');await host.waitForFunction(()=>document.querySelector('#doc-name').textContent==='graphics-220-live.pdf',null,{timeout:90000});
  await chat.screenshot({path:'tests/output/graphics-220-live-chat.png'});
  fs.writeFileSync('tests/output/graphics-220-live.json',JSON.stringify({status:'passed',model,parallelRequests:requests,images:state.images.map(({bytes,page,opacity,matrix})=>({bytes,page,opacity,matrix})),vectors:state.vectors.length,tools:trace.map(t=>({name:t.name,action:t.arguments.action,error:t.error,ms:t.finished-t.started}))},null,2));
  console.log('PASS real main model, two concurrent Qwen Image requests, insertion, image properties and native gradient');
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

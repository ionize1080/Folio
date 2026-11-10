const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
  const {app,page}=await require('./creative-harness.cjs')();
  const user=process.env.FOLIO_USER_PDF, live=process.argv.includes('--live'), file=path.resolve(user||'tests/output/workflow-250-source.pdf');
  const digest=()=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before=digest(),checks=[],timings={};
  let seq=-50000,liveEvidence;
  async function tool(name,args){
    const id=--seq;
    await app.evaluate(({BrowserWindow},{id,name,args})=>BrowserWindow.getAllWindows()[0].webContents.send('ai-request',{id,deadline:Date.now()+180000,params:{name,arguments:args}}),{id,name,args});
    let reply;const until=Date.now()+175000;
    while(Date.now()<until){reply=await app.evaluate((_,id)=>globalThis.studioReplies[id],id);if(reply)break;await new Promise(r=>setTimeout(r,80));}
    assert(reply,'Tool timed out: '+name);assert(!reply.error,reply.error);return reply.result;
  }
  try {
    await app.evaluate(({ipcMain})=>{
      globalThis.workflowNativeStages=[];
      for(const channel of ['native','flow-layout']){
        const invoke=ipcMain._invokeHandlers.get(channel);ipcMain.removeHandler(channel);
        ipcMain.handle(channel,async(event,data)=>{
          const stage={command:channel==='native'?data.command:channel,fontKey:data.fontKey,startedAt:Date.now()};
          globalThis.workflowNativeStages.push(stage);
          try{return await invoke(event,data);}finally{stage.elapsedMs=Date.now()-stage.startedAt;}
        });
      }
    });
    await page.evaluate(()=>{
      globalThis.workflowActivations=[];
      document.addEventListener('click',event=>{
        if(!event.target.closest?.('.page-edit-hit:not(.unavailable)'))return;
        const input=document.querySelector('.page-edit-input');if(!input)return;
        const stage={startedAt:performance.now()};globalThis.workflowActivations.push(stage);
        let preparing=false;
        const observer=new MutationObserver(()=>{
          if(input.disabled)preparing=true;
          else if(preparing){stage.elapsedMs=performance.now()-stage.startedAt;observer.disconnect();}
        });
        observer.observe(input,{attributes:true,attributeFilter:['disabled']});
      },true);
    });
    await page.evaluate(async()=>(await import('./i18n.mjs')).setLanguage('zh-Hans'));
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
    await page.locator('[data-action=open]').first().click();
    await page.waitForFunction(name=>document.querySelector('#doc-name').textContent.includes(name),path.basename(file));
    await page.locator('#busy').waitFor({state:'hidden'});
    if(user){await page.locator('#page-number').fill('62');await page.locator('#page-number').press('Enter');await page.waitForFunction(async()=>(await import('./app.mjs')).S.page===62);}
    for(let cycle=0;cycle<2;cycle++){
      const start=Date.now();await page.locator('[data-action=flow-edit]').first().click();
      await page.locator('.page-edit-hit:not(.unavailable)').first().waitFor();
      timings[cycle?'reenterMs':'firstEnterMs']=Date.now()-start;
      timings[cycle?'reenterWorkMs':'firstEnterWorkMs']=await page.evaluate(()=>performance.getEntriesByName('folio:page-edit-open').at(-1)?.duration);
      if(!cycle){await page.locator('#pe-done').click();await page.locator('.page-edit-bar').waitFor({state:'detached'});}
    }
    assert(timings.reenterMs<timings.firstEnterMs+500,'Repeat entry reuses inspection');
    const candidates=await page.locator('.page-edit-hit:not(.unavailable)').evaluateAll(es=>es.map((e,i)=>({i,text:e.title})));
    const candidate=candidates.filter(c=>c.text.length>25&&/202[45]/.test(c.text)).sort((a,b)=>b.text.length-a.text.length)[0]||candidates.sort((a,b)=>b.text.length-a.text.length)[0];
    assert(candidate,'A paragraph can be selected');
    let firstSelectionAt;
    for(let cycle=0;cycle<2;cycle++){
      const active=Date.now();if(!cycle)firstSelectionAt=active;
      await page.locator('.page-edit-hit:not(.unavailable)').nth(candidate.i).click();
      await page.waitForFunction(()=>{const i=document.querySelector('.page-edit-input');return i&&!i.disabled&&i.value.length>0&&Number.isFinite(globalThis.workflowActivations.at(-1)?.elapsedMs)});
      timings[cycle?'reactivateParagraphMs':'activateParagraphMs']=Date.now()-active;
      timings[cycle?'reactivateParagraphWorkMs':'activateParagraphWorkMs']=await page.evaluate(()=>globalThis.workflowActivations.at(-1).elapsedMs);
      timings[cycle?'reactivateStages':'activateStages']=await app.evaluate((_,since)=>globalThis.workflowNativeStages.filter(s=>s.startedAt>=since),active);
      if(!cycle){await page.locator('#pe-cancel').click();await page.locator('.page-edit-hit:not(.unavailable)').nth(candidate.i).waitFor();}
    }
    timings.fallbackPreload=await app.evaluate((_,before)=>globalThis.workflowNativeStages.filter(s=>s.command==='font-fast'&&s.fontKey?.startsWith('builtin-')).map(s=>({...s,startedBeforeSelection:s.startedAt<before})),firstSelectionAt);
    for(const key of ['builtin-latin','builtin-cjk']){
      const calls=timings.fallbackPreload.filter(s=>s.fontKey===key);
      assert.equal(calls.length,1,key+' has one shared preparation across editor entry and two selections');
      assert(calls[0].startedBeforeSelection,key+' begins loading before paragraph selection');
    }
    const input=page.locator('.page-edit-input'),original=await input.inputValue();
    const edited=/202[45]/.test(original)?original.replace(/202[45]/,'2026'):original+' 2026';
    await input.fill(edited);
    await page.locator('#pe-done').click();await page.locator('.page-edit-bar').waitFor({state:'detached',timeout:120000});
    const edits=await page.evaluate(async()=>{const {S}=await import('./app.mjs');return S.nativeEdits.filter(e=>e.type==='flow').map(e=>({text:e.model.text,frame:e.model.frame,originalFrame:e.model.originalLayout?.frame,layoutMode:e.model.layoutMode,ink:e.ink?.length}));});
    assert(edits.some(e=>e.text===edited),'The edited paragraph was applied');
    const entry=edits.find(e=>e.text===edited);if(entry.originalFrame)assert.equal(entry.frame.x,entry.originalFrame.x);
    checks.push('Enter editing twice, select and change a paragraph, preserve its left anchor, apply');
    const snapshot=await tool('folio_document',{action:'snapshot'});assert(snapshot.path||snapshot.handle||snapshot.snapshotId,JSON.stringify(snapshot));
    const render=await tool('folio_document',{action:'image',page:user?62:1,maxWidth:700});assert(render, 'Edited document renders through AI');
    checks.push('AI snapshot and page rendering succeed after native edits with retained bookmarks');
    if(live){
      await app.evaluate(({BrowserWindow,ipcMain})=>{
        globalThis.workflowTrace=[];globalThis.workflowApi=[];
        const wc=BrowserWindow.getAllWindows()[0].webContents,send=wc.send.bind(wc);
        wc.send=(name,...args)=>{if(name==='ai-request'&&args[0].id>0)globalThis.workflowTrace.push({id:args[0].id,name:args[0].params.name,args:args[0].params.arguments});return send(name,...args)};
        const reply=ipcMain._invokeHandlers.get('ai-reply');ipcMain.removeHandler('ai-reply');
        ipcMain.handle('ai-reply',(event,value)=>{const item=globalThis.workflowTrace.find(t=>t.id===value.id);if(item){item.error=value.error;item.completed=true;item.images=(value.result?.content||[]).filter(c=>c.type==='image').map(c=>({mime:c.mimeType,bytes:Math.floor(c.data.length*.75)}));}return reply(event,value)});
        const fetch=globalThis.fetch;
        globalThis.fetch=(url,options)=>{if(String(url).includes('/chat/completions')){const b=JSON.parse(options.body);globalThis.workflowApi.push({model:b.model,maxTokens:b.max_tokens??b.max_completion_tokens??b.max_output_tokens??null});}return fetch(url,options)};
      });
      await page.evaluate(()=>window.desktop.aiOpen());
      const chat=app.context().pages().find(p=>p.url().includes('/renderer/index.html'));
      await chat.waitForSelector('textarea[placeholder]');
      const model=await require('./ai-live-support.cjs').configure(chat),completed=await chat.evaluate(()=>window.folioProgress.status().completed);
      await require('./ai-live-support.cjs').send(chat,`请使用 folio_render 或 folio_document 的 image 操作，实际查看当前 PDF 的物理第 ${user?62:1} 页。此页刚做过段落编辑。请报告页面上实际看见的年份和图文内容；必须实际调用渲染工具，不要只读取文本。不要修改文档。`);
      await chat.waitForFunction(n=>window.folioProgress.status().completed>n,completed,{timeout:240000});
      liveEvidence=await app.evaluate(()=>({apiRequests:globalThis.workflowApi,tools:globalThis.workflowTrace}));
      assert(liveEvidence.apiRequests.length>0);assert(liveEvidence.apiRequests.every(r=>r.maxTokens===null));
      assert(liveEvidence.tools.some(t=>t.completed&&!t.error&&t.images.some(i=>i.mime==='image/png'&&i.bytes>1000)),'The real model must receive rendered page pixels');
      assert(!liveEvidence.tools.some(t=>t.error),'Rendering must complete without bookmark-related errors');
      liveEvidence.model=model.model;
      fs.writeFileSync('tests/output/'+(user?'user-':'')+'workflow-live-250.txt',(await chat.locator('body').innerText()).slice(-20000));
      checks.push('Real Qwen receives edited-page pixels through the shipped Chatbox transport without an output token limit');
    }
    await page.locator('#ribbon-tab-organize').click();await page.locator('[data-ribbon-command=insert-blank-page]').click();
    const d=page.locator('.blank-pages-dialog');await d.waitFor();await d.locator('[data-mode]').selectOption('custom');
    await d.locator('[data-unit]').selectOption('in');
    assert(await d.locator('form').evaluate(f=>f.checkValidity()),'Converted fractional inches remain valid for insertion');
    await d.locator('[data-unit]').selectOption('mm');
    await d.locator('[data-width]').fill('180');await d.locator('[data-height]').fill('260');await d.locator('[data-count]').fill('2');
    await d.locator('[data-orientation]').selectOption('landscape');await d.locator('[data-target]').selectOption('first');await d.locator('[data-position]').selectOption('before');
    await d.locator('[data-insert]').click();
    const org=page.locator('.organizer-dialog');await page.waitForFunction(()=>document.querySelectorAll('.organizer-page[aria-selected=true]').length===2);
    const output=path.resolve('tests/output/'+(user?'user-':'')+'workflow-250.pdf');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file})},output);
    await org.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('.organizer-dialog [data-status]').textContent.includes('整理结果已保存'),null,{timeout:120000});
    assert(fs.existsSync(output));checks.push('Ribbon blank-page dialog creates two custom landscape pages before the first page');
    await require('./native-capture.cjs')(app,page,'tests/output/'+(user?'user-':'')+'workflow-250.png');
    assert.equal(digest(),before,'The test source remains unchanged');
    const report={status:'passed',source:path.basename(file),sourceUnchanged:true,timings,checks,output:path.basename(output),...(liveEvidence?{liveEvidence}:{})};
    fs.writeFileSync('tests/output/'+(user?'user-':'')+'workflow-'+(live?'live-':'')+'250.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  } finally {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1});

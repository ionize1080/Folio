const {_electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{let app;try{
 const stamp=Date.now();app=await _electron.launch({args:[path.resolve('.')],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/context-ui-'+stamp),FOLIO_CHATBOX_PROFILE:path.resolve('tests/output/context-chat-'+stamp)},timeout:60000});
 const host=await app.firstWindow();host.on('dialog',d=>d.accept());await host.waitForSelector('#document-utilities',{state:'attached'});
 const pick=file=>app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.resolve(file));
 await pick('tests/output/engineering-source.pdf');await host.locator('[data-action="open"]').first().click();await host.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('engineering-source'));await host.waitForSelector('#busy',{state:'hidden'});
 await host.evaluate(()=>window.desktop.aiOpen());const chat=app.context().pages().find(p=>p.url().includes('/renderer/index.html'));await chat.waitForSelector('textarea[placeholder]');const model=await require('./ai-live-support.cjs').configure(chat);await host.evaluate(()=>window.desktop.aiApproval(true));
 function unpack(r){if(r.currentPage)return r;for(const c of r.content||[]){if(c.type==='text'){try{const v=JSON.parse(c.text);if(v.currentPage)return v;}catch{}}}throw Error('Missing live context: '+JSON.stringify(r).slice(0,500));}
 const first=unpack(await chat.evaluate(()=>window.folioLiveContext()));assert.equal(first.currentPage,1);
 async function ask(text){const before=await chat.evaluate(()=>window.folioProgress.status().completed);await chat.locator('textarea[placeholder]').first().fill(text);await chat.locator('textarea[placeholder]').first().press('Enter');await chat.waitForFunction(n=>window.folioProgress.status().completed>n,before,{timeout:180000});return await chat.locator('body').innerText();}
 await ask('请查看实时当前页，只回答 CURRENT_PAGE=实际页码，不修改文档。');
 await host.locator('#canvas-host').evaluate(e=>{e.scrollTop=e.scrollHeight;});await host.waitForSelector('.pdf-page[data-page="2"] .textLayer span');
 await host.locator('.pdf-page[data-page="2"] .textLayer span').first().evaluate(e=>{const r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));});
 const second=unpack(await chat.evaluate(()=>window.folioLiveContext()));assert.equal(second.currentPage,2);assert.equal(first.revision,second.revision);assert(second.textSelection.rectangles.length);
 const transcript=await ask('我刚刚切换了页面。请重新读取实时上下文，调用 folio_render（不传 page）实际看图，回答 CURRENT_PAGE=实际页码，并引用图上可见的文字。不要沿用上一轮页码。');
 fs.writeFileSync('tests/output/context-live-transcript.txt',transcript.slice(-18000));assert.match(transcript,/CURRENT_PAGE\s*=\s*2/);assert.match(transcript,/Page two/);
 await pick('tests/output/engineering-hidden.pdf');await host.evaluate(()=>window.desktop.openDocuments());
 const active=await host.evaluate(()=>window.desktop.tabsState());const newHost=app.context().pages().find(p=>p!==host&&p!==chat&&p.url().includes('index.html'));if(newHost)await newHost.waitForSelector('#busy',{state:'hidden'});
 const switched=unpack(await chat.evaluate(()=>window.folioLiveContext()));assert.equal(switched.documentId,active.activeDocumentId);assert.notEqual(switched.documentId,first.documentId);
 fs.writeFileSync('tests/output/context-live-report.json',JSON.stringify({status:'passed',model,sameChat:true,pages:[first.currentPage,second.currentPage],revisionUnchanged:true,selectionRectangles:second.textSelection.rectangles.length,tabSwitch:true,nativeVisionRead:true},null,2));console.log('PASS real AI same-chat live page, selection, native vision and tab routing');
}finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}})().catch(e=>{console.error(e);process.exitCode=1});

const {_electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{let app;try{
 app=await _electron.launch({...(process.env.FOLIO_EXE?{executablePath:process.env.FOLIO_EXE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/engineering-ui-'+Date.now())},timeout:60000});
 const p=await app.firstWindow();p.setDefaultTimeout(30000);p.on('dialog',d=>d.accept());await p.waitForSelector('#font-tools',{state:'attached'});
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showSaveDialog=async()=>({canceled:true});},path.resolve('tests/output/engineering-tagged-patched.pdf'));
 await p.locator('[data-action="open"]').first().click();await p.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('engineering-tagged'));
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('ai-reply');ipcMain.handle('ai-reply',(_e,v)=>{globalThis.engineeringResult=v;});});let id=0;
 async function call(name,args){await app.evaluate(({BrowserWindow},{id,name,args})=>{globalThis.engineeringResult=null;BrowserWindow.getAllWindows()[0].webContents.send('ai-request',{id,params:{name,arguments:args}});},{id:++id,name,args});let r;for(let n=0;n<600;n++){r=await app.evaluate(()=>globalThis.engineeringResult);if(r)break;await new Promise(r=>setTimeout(r,50));}assert(r,'tool response');assert(!r.error,r.error);return r.result;}
 await p.waitForSelector('#busy',{state:'hidden'});
 const initial=await call('folio_document',{action:'context'});assert.equal(initial.currentPage,1);
 await p.locator('#canvas-host').evaluate(e=>{e.scrollTop=e.scrollHeight;});
 await p.waitForSelector('.pdf-page[data-page="2"] .textLayer span');
 const second=await call('folio_document',{action:'context',revision:initial.revision});assert.equal(second.currentPage,2);assert.equal(second.revision,initial.revision);assert(second.visiblePages.some(v=>v.page===2));
 await p.locator('.pdf-page[data-page="2"] .textLayer span').first().evaluate(e=>{const r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));});
 const selected=await call('folio_document',{action:'context'});assert(selected.textSelection.text.includes('Page two'));assert(selected.textSelection.rectangles.length);
 await p.locator('.folio-ai-open').focus();const retained=await call('folio_document',{action:'context'});assert(retained.textSelection.text.includes('Page two'));
 const image=await call('folio_render',{dpi:72});const meta=JSON.parse(image.content[0].text);assert.equal(meta.page,2);assert.equal(image.content[1].type,'image');assert(Buffer.from(image.content[1].data,'base64').subarray(0,4).equals(Buffer.from([137,80,78,71])));
 const old=await call('folio_document',{action:'image',page:1,purpose:'classify'});assert.equal(JSON.parse(old.content[0].text).page,1);
 const fonts=await call('folio_fonts',{action:'document',page:1});assert(fonts.fonts);
 const preview=await call('folio_fonts',{action:'preview',options:{fontKey:'builtin-latin',text:'Folio'}});assert.equal(preview.content[1].mimeType,'image/png');
 const structure=await call('folio_structure',{action:'tags',revision:initial.revision});assert(structure.nodes.length>=3);
 const paragraphs=await call('folio_fonts',{action:'paragraphs',page:2});assert(paragraphs.paragraphs.length);
 const applied=await call('folio_fonts',{action:'apply',page:2,revision:paragraphs.revision,options:{paragraphId:paragraphs.paragraphs[0].id,fontKey:'builtin-latin',frame:{width:300,height:45}}});assert(applied.applied);
 const after=await call('folio_render',{page:2,dpi:72,revision:applied.revision});assert.notEqual(after.content[1].data,image.content[1].data,'unsaved font change is visible');
 await call('folio_operation',{operation:'history.undo',revision:applied.revision});
 await p.locator('.more-tools summary').click();await p.locator('#document-utilities').click();await p.waitForFunction(()=>!document.querySelector('.document-tools [data-run]').disabled);
 for(const action of ['layers','tags','pdfx','validate-pdfua']){await p.locator('[data-utility-action="'+action+'"]').click();if(['layers','tags'].includes(action)){await p.locator('.document-tools [data-run]').click();await p.waitForFunction(()=>!document.querySelector('.document-tools [data-run]').disabled);}
  await p.screenshot({path:'tests/output/engineering-'+action+'.png'});assert(await p.locator('.document-tools').evaluate(e=>e.scrollWidth<=e.clientWidth));}
 await p.locator('.document-tools [data-close]').first().click();await p.locator('.more-tools summary').click();await p.locator('#font-tools').click();await p.locator('[data-query]').fill('DejaVu Sans');await p.waitForFunction(()=>document.querySelector('[data-fonts]').options.length>0);
 const fid=await p.locator('[data-fonts] option').first().getAttribute('value');await p.locator('[data-fonts]').selectOption(fid);await p.waitForSelector('[data-image]:not([hidden])',{timeout:60000});await p.screenshot({path:'tests/output/engineering-fonts.png'});
 fs.writeFileSync('tests/output/engineering-ui-report.json',JSON.stringify({status:'passed',livePage:second.currentPage,revisionUnchangedOnNavigation:true,selectionRectangles:selected.textSelection.rectangles.length,nativeVision:true,tools:['fonts','render','structure'],ui:['layers','tags','pdfx','pdfua','fonts']},null,2));console.log('PASS live page/selection, native MCP vision, fonts and structure UI');
}finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}})().catch(e=>{console.error(e);process.exitCode=1});

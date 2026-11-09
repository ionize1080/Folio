const {_electron:electron}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const app=await electron.launch({executablePath:process.env.FOLIO_EXE,args:process.env.FOLIO_EXE?[]:[path.resolve('.')],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/creative-ui-'+Date.now()),FOLIO_CHATBOX_PROFILE:path.resolve('tests/output/creative-chat-'+Date.now())},timeout:60000});
 const checks=[],errors=[];
 try {
  const host=await app.firstWindow();await host.locator('#ribbon-tab-photo').waitFor();host.on('dialog',d=>d.accept());host.on('pageerror',e=>errors.push(e.message));await host.evaluate(async()=>{(await import('./i18n.mjs')).setLanguage('zh-Hans')});
  await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root+'/creative-source.pdf']});dialog.showSaveDialog=async(_w,o)=>({canceled:false,filePath:root+'/'+pathBasename(o.defaultPath)});function pathBasename(p){return p.split(/[\\/]/).pop();}},path.resolve('tests/output'));
  await host.locator('[data-action="open"]').first().click();await host.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('creative-source'));
  await host.evaluate(()=>window.desktop.aiApproval(true));
  await app.evaluate(({ipcMain})=>{globalThis.creativeReplies={};const original=ipcMain._invokeHandlers.get('ai-reply');ipcMain.removeHandler('ai-reply');ipcMain.handle('ai-reply',(e,v)=>{if(v.id<0)globalThis.creativeReplies[v.id]=v;return original(e,v);});});
  let seq=0;
  async function call(name,args,allowError=false){const id=--seq;await app.evaluate(({BrowserWindow},{id,name,args})=>BrowserWindow.getAllWindows()[0].webContents.send('ai-request',{id,deadline:Date.now()+180000,params:{name,arguments:args}}),{id,name,args});let result;const until=Date.now()+170000;while(Date.now()<until){result=await app.evaluate((_,id)=>globalThis.creativeReplies[id],id);if(result)break;await new Promise(r=>setTimeout(r,75));}assert(result,'tool timeout');if(!allowError)assert(!result.error,result.error);return allowError?result:result.result;}
  const studio=a=>call('folio_studio',a),revision=async()=>(await studio({action:'objects',page:1})).revision;
  const initial=await studio({action:'objects',page:1});assert(initial.objects.some(x=>x.kind==='image'));assert(initial.objects.some(x=>x.kind==='path'));
  const photo=await studio({action:'open',kind:'photo',page:1,index:initial.objects.find(x=>x.kind==='image').index});
  await studio({action:'execute',sessionId:photo.sessionId,command:'layer.new.layer',params:{name:'Folio layer'}});
  await studio({action:'execute',sessionId:photo.sessionId,command:'paint.stroke',params:{points:[[20,20],[50,35]],size:8,color:'#28c080'}});
  const applied=await studio({action:'apply',sessionId:photo.sessionId,revision:await revision()});assert(applied.applied);
  await studio({action:'apply',sessionId:photo.sessionId,revision:await revision()});
  const vector=await studio({action:'open',kind:'vector',page:1,settings:{width:140,height:80}});
  await studio({action:'execute',sessionId:vector.sessionId,command:'shape.rectangle',params:{x:10,y:10,width:100,height:50}});
  const drawn=await studio({action:'apply',sessionId:vector.sessionId,revision:await revision(),box:[40,40,140,80]});
  const copied=await studio({action:'duplicate',page:1,id:drawn.id,revision:await revision()});assert(copied.id!==drawn.id);
  await studio({action:'delete',page:1,id:copied.id,revision:await revision()});
  await call('folio_operation',{operation:'history.undo',revision:await revision()});assert((await studio({action:'objects',page:1})).objects.some(o=>o.id===copied.id));
  checks.push('Shared MCP sessions create, edit, apply twice, duplicate, delete and undo actual PDF artwork');
  for(const category of ['photo','vector','bookmarks','organize','export']){
   await host.locator('#ribbon-tab-'+category).click();
   const command=category==='export'?'export-word':category==='bookmarks'?'generate':category==='organize'?'page-organizer':category+'-studio';assert(await host.locator(`[data-ribbon-command="${command}"]`).isVisible());
  }
  await host.locator('[data-ribbon-command="export-word"]').click();assert(await host.locator('.document-tools [data-run]').isVisible());assert.equal(await host.locator('.document-tools [data-key="ai"]').inputValue(),'false');await host.keyboard.press('Escape');
  for(const width of [800,1280,1500]){
   await app.evaluate(({BrowserWindow},w)=>{const win=BrowserWindow.getAllWindows()[0];win.setMinimumSize(780,600);win.setSize(w,900)},width);
   await host.locator('#ribbon-tab-photo').click();
   const layout=await host.evaluate(()=>{const h=document.querySelector('.appbar').getBoundingClientRect(),ai=document.querySelector('.folio-ai-open').getBoundingClientRect();const buttons=[...document.querySelectorAll('.ribbon-tabs button')].map(b=>b.getBoundingClientRect());return {height:h.height,ai:{x:ai.x,right:ai.right,width:ai.width},viewport:innerWidth,overlap:buttons.some((b,i)=>i&&b.left<buttons[i-1].right)};});
   assert(layout.height<=114);assert(layout.ai.width>30&&layout.ai.x>=0&&layout.ai.right<=layout.viewport);assert(!layout.overlap);
   await require('./native-capture.cjs')(app,host,`tests/output/creative-ribbon-${width}.png`);
  }
  await host.locator('[data-ribbon-command="photo-studio"]').click();await host.waitForFunction(()=>!document.querySelector('.creative-dialog [data-open]').disabled);assert(await host.locator('.creative-dialog [data-import]').isVisible());await require('./native-capture.cjs')(app,host,'tests/output/creative-dialog.png');await host.keyboard.press('Escape');
  await host.keyboard.press('Control+F1');assert((await host.locator('.appbar').boundingBox()).height<=72);await host.keyboard.press('Control+F1');
  checks.push('Compact ribbon, independent visible AI, direct offline Word export, creative import and responsive widths 800/1280/1500');
  await host.locator('#ribbon-tab-home').click();await host.locator('.more-tools > summary').click();await host.locator('[data-action="exchange"]').click();await host.locator('#export-project').click();await host.waitForTimeout(800);assert(fs.existsSync('tests/output/creative-source.folio'));
  await host.keyboard.press('Escape');
  await studio({action:'close',sessionId:photo.sessionId});await studio({action:'close',sessionId:vector.sessionId});
  const {decodeProject}=await import('../src/project.mjs');
  const project=await decodeProject(new Uint8Array(fs.readFileSync('tests/output/creative-source.folio')));assert(project.state.nativeEdits.filter(e=>e.type==='studio-graphic'&&!e.delete).every(e=>e.sourceData));
  checks.push('Portable .folio project contains reusable native sources for every studio edit');
  assert.deepEqual(errors,[]);fs.writeFileSync('tests/output/creative-ui.json',JSON.stringify({status:'passed',checks},null,2));console.log('PASS creative UI',checks);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

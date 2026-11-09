const {_electron}=require('playwright'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function(){
  const stamp=Date.now(),app=await _electron.launch({executablePath:process.env.FOLIO_EXE,args:process.env.FOLIO_EXE?[]:[path.resolve('.')],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/studio-profile-'+stamp),FOLIO_CHATBOX_PROFILE:path.resolve('tests/output/studio-chat-'+stamp)},timeout:60000});
  const page=await app.firstWindow();page.setDefaultTimeout(60000);await page.locator('#ribbon-tab-photo').waitFor();page.on('dialog',d=>d.accept());page.on('pageerror',e=>console.error('Renderer error:',e.message));await page.evaluate(()=>window.desktop.aiApproval(true));
  await app.evaluate(({ipcMain})=>{globalThis.studioReplies={};const original=ipcMain._invokeHandlers.get('ai-reply');ipcMain.removeHandler('ai-reply');ipcMain.handle('ai-reply',(e,v)=>{if(v.id<0)globalThis.studioReplies[v.id]=v;return original(e,v);});});
  let sequence=0;
  async function call(args){
    const id=--sequence;
    await app.evaluate(({BrowserWindow},{id,args})=>BrowserWindow.getAllWindows()[0].webContents.send('ai-request',{id,deadline:Date.now()+180000,params:{name:'folio_studio',arguments:args}}),{id,args});
    const deadline=Date.now()+175000;let answer;
    while(Date.now()<deadline){answer=await app.evaluate((_,id)=>globalThis.studioReplies[id],id);if(answer)break;await new Promise(r=>setTimeout(r,75));}
    assert(answer,'Embedded studio request timed out: '+args.action);if(answer.error)throw Error(answer.error);return answer.result;
  }
  return {app,page,call};
};

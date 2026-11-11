const fs=require('node:fs'),path=require('node:path');
function credentials(){
 if(process.env.FOLIO_QWEN_API_KEY && process.env.FOLIO_QWEN_API_URL)return {key:process.env.FOLIO_QWEN_API_KEY.trim(),endpoint:process.env.FOLIO_QWEN_API_URL,model:process.env.FOLIO_QWEN_MODEL||'qwen3.8-flash'};
 const profile=path.join(process.env.APPDATA,'Folio/Chatbox-1.20.3/config.json');
 if(fs.existsSync(profile)){
  const s=JSON.parse(fs.readFileSync(profile,'utf8')).settings,p=s.providers?.qwen;
  if(p?.apiKey && p.apiHost)return {key:p.apiKey,endpoint:p.apiHost,model:p.models?.[0]?.modelId||'qwen3.8-flash'};
 }
 const base=process.env.FOLIO_TEST_CREDENTIAL_DIR;
 if(!base)throw Error('Set FOLIO_QWEN_API_KEY and FOLIO_QWEN_API_URL for live acceptance');
 return {key:fs.readFileSync(path.join(base,'qwen-plan.txt'),'utf8').trim().replace(/^\uFEFF/,''),endpoint:fs.readFileSync(path.join(base,'qwen-plan-url.txt'),'utf8').match(/https?:\/\/\S+/)[0],model:process.env.FOLIO_QWEN_MODEL||'qwen3.8-flash'};
}
async function configure(chat){
 const config=credentials();
 await chat.waitForFunction(()=>typeof window.folioSettingsReady==='function');
 await chat.evaluate(()=>window.folioSettingsReady());
 // Let initial tool/provider setup finish before replacing test settings;
 // otherwise a late startup write can overwrite the configured provider.
 await chat.waitForFunction(()=>window.folioToolsStatus?.().count>=8,null,{timeout:30000});
 await chat.evaluate(async({key,endpoint,model})=>{
  const s=await window.electronAPI.invoke('getSettings');s.language='zh-Hans';s.messageLayout='left';
  delete s.maxTokens;delete s.maxContextSize;delete s.maxContextMessageCount;
  s.customProviders=[{id:'acceptance-qwen',name:'Qwen Test',type:'openai',isCustom:true}];
  s.providers={...s.providers,'acceptance-qwen':{apiKey:key,apiHost:endpoint.replace(/\/chat\/completions\/?$/,''),apiPath:'/chat/completions',models:[{modelId:model,capabilities:['vision','tool_use']}],useProxy:false}};
  s.defaultChatModel={provider:'acceptance-qwen',model};
  await window.electronAPI.invoke('setStoreValue','settings',JSON.stringify(s));
 },config);
 await chat.reload();await chat.waitForSelector('textarea[placeholder]');await chat.waitForFunction(()=>window.folioToolsStatus().count>=8,{timeout:30000});
 await chat.evaluate(()=>window.folioSettingsReady());
 const configured=await chat.evaluate(async model=>{
  const settings=await window.electronAPI.invoke('getSettings');
  return settings.defaultChatModel?.provider==='acceptance-qwen' && settings.defaultChatModel?.model===model && Boolean(settings.providers?.['acceptance-qwen']?.apiKey);
 },config.model);
 if(!configured)throw Error('Live acceptance provider did not persist after startup');
 // The initial home conversation may have been created before configuration.
 // Start a new test conversation and verify its actual model before sending.
 await chat.locator('textarea[placeholder]').first().focus();await chat.keyboard.press('Control+n');
 await chat.waitForFunction(model=>document.body.innerText.includes(model),config.model,{timeout:30000});
 return {model:config.model};
}
async function send(chat,text){
 const input=chat.locator('textarea[placeholder]').first();
 await input.fill(text);
 await chat.locator('[data-folio-send]:enabled').waitFor();
 await input.press('Enter');
 await chat.waitForFunction(()=>document.querySelector('textarea[placeholder]')?.value==='',null,{timeout:15000});
}
module.exports={credentials,configure,send};

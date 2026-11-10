const {_electron:electron}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const live=process.argv.includes('--live');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6uS8AAAAASUVORK5CYII=','base64');
(async()=>{
 const requests=[];
 const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;requests.push({url:req.url,authorization:req.headers.authorization,body});res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const id=Date.now(),app=await electron.launch({executablePath:process.env.FOLIO_EXE,args:process.env.FOLIO_EXE?[]:[path.resolve('.')],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/image-provider-'+id),FOLIO_CHATBOX_PROFILE:path.resolve('tests/output/image-provider-chat-'+id)},timeout:60000});
 const checks=[],errors=[],apiRequests=[];
 const out=path.resolve('tests/output');
 try {
  const host=await app.firstWindow();await host.locator('.folio-ai-open').waitFor();
  await host.evaluate(()=>window.desktop.aiOpen());
  const chat=app.context().pages().find(p=>p.url().includes('/renderer/index.html'));assert(chat);chat.on('pageerror',e=>errors.push(e.message));
  const homeURL=chat.url().split('#')[0];
  await chat.waitForFunction(()=>typeof window.folioImages?.config==='function');
  await chat.waitForSelector('textarea[placeholder]');await chat.evaluate(()=>window.folioSettingsReady());
  await chat.evaluate(async()=>{const s=await window.electronAPI.invoke('getSettings');s.language='en';s.languageInited=true;await window.electronAPI.invoke('setStoreValue','settings',JSON.stringify(s));});await chat.goto(homeURL);await chat.waitForSelector('textarea[placeholder]');await chat.evaluate(()=>window.folioSettingsReady());
  const openSettings=async(width=960)=>{
    await chat.waitForSelector('textarea[placeholder]');await chat.evaluate(()=>window.folioSettingsReady());
    await host.evaluate(width=>window.desktop.aiBounds({x:0,y:0,width,height:800}),width);
    await chat.waitForFunction(width=>innerWidth===width,width);
    if(width<640){
      await chat.locator('button:has(svg.tabler-icon-menu-2)').click();
      await chat.locator('button:has(svg.tabler-icon-settings-filled)').click();
    }else await chat.locator('button').filter({hasText:/Set up a model provider|设置模型服务|設定模型服務/}).click();
    await chat.locator('a').filter({hasText:/Image Model Provider|生图模型提供方|生圖模型提供方/}).click();await chat.locator('[data-folio-image-settings]').waitFor();
  };
  await openSettings();
  const select=async(value)=>{await chat.locator('[data-image-protocol]').click();try{await chat.getByRole('option',{name:value,exact:true}).click();}catch(e){console.log('SELECT STATE',await chat.evaluate(()=>({hash:location.hash,options:[...document.querySelectorAll('[role=option]')].map(e=>({text:e.textContent,visible:e.checkVisibility(),outer:e.outerHTML.slice(0,500),hiddenParent:e.closest('[aria-hidden=true]')?.outerHTML.slice(0,250)})),body:document.body.innerText.slice(0,3000)})));throw e;}};
  const field=name=>chat.locator('[data-image-'+name+']');
  await select('OpenAI or compatible service');
  await field('endpoint').fill('http://127.0.0.1:'+server.address().port+'/v1');
  await field('model').fill('custom-test-image');await field('key').fill('test-settings-only-secret');
  await field('save').click();await field('status').waitFor();
  const config=await chat.evaluate(()=>window.folioImages.config());assert.equal(config.model,'custom-test-image');assert(config.hasKey);assert(!JSON.stringify(config).includes('secret'));
  await chat.goto(homeURL);await openSettings();assert.equal(await field('model').inputValue(),'custom-test-image');assert.equal(await field('key').inputValue(),'');
  await field('test').click();await chat.locator('[data-image-preview]').waitFor({timeout:30000});assert.equal(requests.length,1);assert.equal(requests[0].authorization,'Bearer test-settings-only-secret');assert.equal(JSON.parse(requests[0].body).model,'custom-test-image');
  checks.push('Settings menu entry, encrypted key, reload persistence and preview from real host transport');
  console.log('Image provider: saved settings, reload and host preview passed');
  await host.evaluate(reference=>window.desktop.generateImage({prompt:'recolor',reference}), 'data:image/png;base64,'+png.toString('base64'));
  assert.equal(requests[1].url,'/v1/images/edits');assert(requests[1].body.includes('name="image"'));
  checks.push('PDF tools use the same image provider and multipart reference-image settings');
  for(const [language,theme,label] of [['en',1,'Image Model Provider'],['zh-Hans',1,'生图模型提供方'],['zh-Hant',0,'生圖模型提供方']]) {
    await chat.evaluate(async({language,theme})=>{const s=await window.electronAPI.invoke('getSettings');s.language=language;s.theme=theme;await window.electronAPI.invoke('setStoreValue','settings',JSON.stringify(s));},{language,theme});
    await chat.goto(homeURL);await openSettings(430);
    try{await chat.locator('[data-folio-image-settings] h5').filter({hasText:label}).waitFor();}catch(e){console.log(await chat.evaluate(()=>({hash:location.hash,text:document.body.innerText.slice(0,3000),forms:document.querySelectorAll('[data-folio-image-settings]').length})));throw e;}
    await chat.locator('[data-folio-image-settings] details summary').click();
    const layout=await chat.locator('[data-folio-image-settings]').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,viewport:innerWidth,controls:[...el.querySelectorAll('input,button,textarea')].filter(e=>e.checkVisibility({checkVisibilityCSS:true})).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,left:r.left,right:r.right}})}));
    assert(layout.scroll<=layout.width+1,JSON.stringify(layout));assert(layout.controls.every(r=>r.left>=-1&&r.right<=layout.viewport+1),JSON.stringify(layout));
    console.log('Image provider: narrow layout passed',language);
  }
  checks.push('English, Simplified Chinese and Traditional Chinese fit the narrow sidebar in light/dark themes');
  await require('./native-capture.cjs')(app,chat,path.join(out,'image-provider-settings.png'),{url:chat.url()});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'image-provider-ui.json'),JSON.stringify({status:'passed',checks,apiRequests:[],errors},null,2));
  if(live) {
    await select('Qwen · Token Plan');
    await field('model').fill('qwen-image-3.0-pro');
    if(process.env.FOLIO_IMAGE_API_KEY)await field('key').fill(process.env.FOLIO_IMAGE_API_KEY);
    else await field('key-file').fill(path.join(process.env.FOLIO_TEST_CREDENTIAL_DIR||'D:/APP/API','qwen-plan.txt'));
    await app.evaluate(()=>{const fetch=globalThis.fetch;globalThis.imageProviderAudit=[];globalThis.fetch=async(url,options)=>{if(options?.method!=='POST')return fetch(url,options);const payload=JSON.parse(options.body),entry={model:payload.model,reference:!!payload.input?.messages?.[0]?.content?.some(x=>x.image),started:Date.now()};globalThis.imageProviderAudit.push(entry);try{const response=await fetch(url,options);entry.status=response.status;return response;}finally{entry.elapsedMs=Date.now()-entry.started;}}});
    await field('test').click();await chat.locator('[data-image-preview]').waitFor({timeout:250000});
    console.log('Image provider: real Qwen generation preview received');
    const reference=await chat.locator('[data-image-preview]').getAttribute('src');assert(reference.startsWith('data:image/'));
    const initial=Buffer.from(reference.split(',')[1],'base64');assert(initial.length>10000);fs.writeFileSync(path.join(out,'image-provider-qwen-generated.png'),initial);
    const edited=await host.evaluate(async reference=>window.desktop.generateImage({prompt:'Keep the circle and white background. Change the circle from blue to orange.',reference,size:'1024x1024',enable_thinking:false}),reference);
    const bytes=Buffer.from(edited,'base64');assert(bytes.length>10000);assert(!bytes.equals(initial));fs.writeFileSync(path.join(out,'image-provider-qwen-edited.png'),bytes);
    apiRequests.push(...await app.evaluate(()=>globalThis.imageProviderAudit));assert.equal(apiRequests.length,2);assert(apiRequests.every(x=>x.status===200&&x.model==='qwen-image-3.0-pro'));assert(apiRequests[1].reference);
    checks.push('Real qwen-image-3.0-pro text-to-image and reference-image editing through the saved configuration');
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'image-provider-'+(live?'live':'ui')+'.json'),JSON.stringify({status:'passed',checks,apiRequests,errors},null,2));console.log(JSON.stringify({status:'passed',checks,apiRequests},null,2));
 }catch(e){
   console.error(e);
   if(live){const attempts=await app.evaluate(()=>globalThis.imageProviderAudit||[]).catch(()=>[]);if(attempts.length)fs.writeFileSync(path.join(out,'image-provider-live-failure.json'),JSON.stringify({status:'failed',error:e.message,apiRequests:attempts},null,2));}
   throw e;
 }finally{await app.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

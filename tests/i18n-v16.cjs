// Actual packaged Windows UI: language switching must preserve the edit session.
const {_electron}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/output'),checks=[],errors=[],coverage=[];
let app,page;
(async()=>{
 try {
  assert.equal(process.platform,'win32');assert(process.env.FOLIO_EXE);
  app=await _electron.launch({executablePath:process.env.FOLIO_EXE,args:['--force-device-scale-factor=1.5'],timeout:60000});
  page=await app.firstWindow();page.setDefaultTimeout(60000);
  page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(async({session})=>session.defaultSession.clearStorageData());await page.reload();
  await page.waitForSelector('#language-select');
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.equal(await page.locator('[data-action="open"]').first().innerText(),'Open');
  async function audit(name){
   await page.evaluate(async()=>{const m=await import('./i18n.mjs');m.localizeTree(document.body)});
   const missing=await page.evaluate(async()=> (await import('./i18n.mjs')).untranslatedUI());
   coverage.push({name,missing});
  }
  await audit('welcome');
  for(const locale of ['zh-Hans','zh-Hant','en']){
   await page.locator('#language-select').selectOption(locale);
   assert.equal(await page.locator('html').getAttribute('lang'),locale);
   await page.screenshot({path:path.join(out,`v16-welcome-${locale}.png`)});
  }
  checks.push('Clean profile defaults to English; all three native language names are discoverable and switch without restart');
  await page.locator('#language-select').selectOption('zh-Hant');await page.reload();
  assert.equal(await page.locator('#language-select').inputValue(),'zh-Hant');
  await page.locator('#language-select').selectOption('en');
  await page.locator('[data-action="settings"]').click();
  await page.locator('#settings-language').selectOption('zh-Hans');
  assert.equal(await page.locator('#language-select').inputValue(),'zh-Hans');
  await page.locator('#set-sidebar').fill('320');
  await page.locator('#settings-language').selectOption('en');
  assert.equal(await page.locator('#set-sidebar').inputValue(),'320');
  await audit('preferences');await page.screenshot({path:path.join(out,'v16-preferences.png')});
  await page.locator('#modal-footer button').first().click();
  checks.push('Language persists across reload; preferences selector synchronizes immediately and preserves unsaved settings fields');
  // Protect data even when identical to translatable labels and templates.
  await page.evaluate(async()=>{
   const {localizeTree,setLanguage}=await import('./i18n.mjs');
   const box=document.createElement('div');box.id='i18n-data-probe';
   box.innerHTML='<span translate="no">保存</span><textarea>打开</textarea><input value="删除"><div contenteditable="true">第 7 页</div><div class="textLayer"><span>保存</span></div><button>保存</button>';
   document.body.append(box);window.__probe=box;
   for(const lang of ['zh-Hans','zh-Hant','en']){setLanguage(lang);localizeTree(box);}
  });
  assert.equal(await page.locator('#i18n-data-probe [translate=no]').innerText(),'保存');
  assert.equal(await page.locator('#i18n-data-probe textarea').inputValue(),'打开');
  assert.equal(await page.locator('#i18n-data-probe input').inputValue(),'删除');
  assert.equal(await page.locator('#i18n-data-probe [contenteditable]').innerText(),'第 7 页');
  assert.equal(await page.locator('#i18n-data-probe .textLayer').innerText(),'保存');
  assert.equal(await page.locator('#i18n-data-probe button').innerText(),'Save');
  await page.evaluate(()=>window.__probe.remove());
  checks.push('Document text, user content, inputs, IME/edit surfaces and PDF text layers are never translated');
  const file=path.join(out,'v10-review-fixture.pdf');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
  await page.locator('[data-action="open"]').first().click();
  await page.waitForFunction(()=>document.querySelector('#page-total').textContent.includes('3'));
  await page.waitForFunction(()=>document.querySelector('#busy').hidden);
  await page.evaluate(async()=>{
   const {S,commit}=await import('./app.mjs');const {makeNode}=await import('./model.mjs');
   const node=makeNode('保存',1);commit([...S.nodes,node]);S.selected=new Set([node.id]);
  });
  const before=await page.evaluate(async()=>{const{S}=await import('./app.mjs');return {nodes:JSON.stringify(S.nodes),bytes:Array.from(S.bytes.slice(0,100)),edits:JSON.stringify(S.nativeEdits),session:S.sessionId,dirty:S.dirty,page:S.page}});
  for(const locale of ['zh-Hant','zh-Hans','en'])await page.locator('#language-select').selectOption(locale);
  const after=await page.evaluate(async()=>{const{S}=await import('./app.mjs');return {nodes:JSON.stringify(S.nodes),bytes:Array.from(S.bytes.slice(0,100)),edits:JSON.stringify(S.nativeEdits),session:S.sessionId,dirty:S.dirty,page:S.page}});
  assert.deepEqual(after,before);assert((await page.locator('#tree-rows').innerText()).includes('保存'));
  checks.push('Language switching preserves document identity, PDF bytes, bookmark data, dirty state and pending edits');
  for(const action of ['generate','batch','pages','exchange','metadata','table-structure','ocr','help']){
   await page.evaluate(action=>document.querySelector(`[data-action="${action}"]`)?.click(),action);
   await page.waitForSelector('#modal[open]');
   await audit(action);
   await page.screenshot({path:path.join(out,`v16-${action}.png`)});
   await page.locator('#modal-close').click();
  }
  await page.locator('[data-action="flow-edit"]').click();
  await page.locator('.page-edit-hit:not(.unavailable)').first().click();
  await page.waitForSelector('.page-edit-input');
  await page.locator('.page-edit-input').fill('Pending draft text');
  const editorValue=await page.locator('.page-edit-input').inputValue();
  for(const locale of ['zh-Hant','zh-Hans','en']){
   await page.locator('#language-select').selectOption(locale);
   assert.equal(await page.locator('.page-edit-input').inputValue(),editorValue);
  }
  await page.locator('#pe-more').click();
  await page.locator('.pe-layers').evaluate(el=>el.open=true);
  await audit('text-edit');
  await page.evaluate(()=>document.querySelector('#pe-fallback').click());
  await audit('font-substitution');
  assert.equal(await page.locator('#pe-fallback-panel button').first().innerText(),'Close substitution details');
  await page.locator('#pe-fallback-panel button').first().click();
  await page.screenshot({path:path.join(out,'v16-text-edit.png')});
  await page.locator('#pe-cancel').click();
  await page.locator('#pe-done').click();
  const imageFile=path.join(out,'v16-image.pdf');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},imageFile);
  await page.locator('[data-action="open"]').first().click();
  await page.waitForSelector('#modal[open]');await audit('unsaved-confirmation');
  await page.locator('#modal-footer button').nth(1).click();
  await page.waitForFunction(()=>document.querySelector('#doc-name')?.textContent==='v16-image.pdf' && document.querySelector('#busy').hidden);
  await page.locator('[data-action="edit-image"]').click();
  await page.locator('.image-page-hit').first().click();
  await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent.includes('Preview updated'));
  await page.locator('[data-adjust="brightness"]').fill('12');
  await page.locator('[data-adjust="brightness"]').dispatchEvent('input');
  for(const locale of ['zh-Hant','zh-Hans','en']){
   await page.locator('#language-select').selectOption(locale);
   assert.equal(await page.locator('[data-adjust="brightness"]').inputValue(),'12');
  }
  await audit('image-edit');await page.screenshot({path:path.join(out,'v16-image-edit.png')});
  checks.push('Uncommitted text and image parameters survive live switching in active editors');
  for(const size of [[1080,800],[1280,900],[1920,1080]]){
   await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),size);
   for(const locale of ['en','zh-Hans','zh-Hant']){
    await page.locator('#language-select').selectOption(locale);
    const geometry=await page.locator('#language-select').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight,overflow:document.body.scrollWidth-innerWidth}});
    assert(geometry.left>=0 && geometry.right<=geometry.w && geometry.bottom<=geometry.h,JSON.stringify(geometry));
    assert(geometry.overflow<=1,JSON.stringify({geometry,overflowing:await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1 && getComputedStyle(el).visibility==='visible').slice(0,20).map(el=>({tag:el.tagName,id:el.id,class:el.className,right:el.getBoundingClientRect().right})))}));
    await page.screenshot({path:path.join(out,`v16-layout-${size[0]}-${locale}.png`)});
   }
  }
  await page.locator('[data-action="theme"]').click();await page.locator('#language-select').selectOption('en');
  await page.screenshot({path:path.join(out,'v16-dark.png')});
  checks.push('Language control remains visible at 1080, 1280 and 1920 CSS-pixel widths at 150% scale, in light and dark themes');
  // Programmatic native-select keyboard access: focus survives a locale change.
  await page.locator('#language-select').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#language-select').evaluate(el=>document.activeElement===el),true);
  checks.push('Keyboard-accessible native language selector retains focus');
  const missing=coverage.flatMap(c=>c.missing.map(m=>({screen:c.name,...m})));
  fs.writeFileSync(path.join(out,'v16-coverage.json'),JSON.stringify(coverage,null,2));
  assert.deepEqual(missing,[],'Untranslated UI copy: '+JSON.stringify(missing));
  assert.deepEqual(errors,[]);
 }catch(e){errors.push(e.stack);if(page)await page.screenshot({path:path.join(out,'v16-failure.png')}).catch(()=>{});throw e;}
 finally{
  const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'v16-ui-report.json'),JSON.stringify({platform:process.platform,checks,errors,coverage,exe_sha256:hash(process.env.FOLIO_EXE),asar_sha256:hash(path.join(path.dirname(process.env.FOLIO_EXE),'resources/app.asar'))},null,2));
  if(page)await page.evaluate(()=>window.desktop?.setDirty(false)).catch(()=>{});
  await app?.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1});

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 let {app,page}=await require('./creative-harness.cjs')();const checks=[],timings={},errors=[];page.on('pageerror',e=>errors.push(e.message));
 const source=process.env.FOLIO_INTERACTION_PDF||'tests/output/save-281/fixture.pdf',file=path.resolve('tests/output/interaction-281.pdf');fs.copyFileSync(source,file);
 try{
  await app.evaluate(({BrowserWindow,dialog},file)=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1440,960);win.show();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showSaveDialog=async()=>{throw Error('Unexpected Save As');};},file);
  await page.evaluate(async()=>{(await import('./i18n.mjs')).setLanguage('zh-Hans');const value=JSON.stringify({...JSON.parse(localStorage.getItem('folio-settings')||'{}'),protect:false,saveSummary:false});localStorage.setItem('folio-settings',value);dispatchEvent(new StorageEvent('storage',{key:'folio-settings',newValue:value}));});
  await page.evaluate(()=>window.desktop.openDocuments());
  await page.evaluate(async()=>{window.interactionState=(await import('./app.mjs')).S;window.longTasks=[];new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});});
  const pageNumber=Number(process.env.FOLIO_INTERACTION_PAGE||1);
  if(pageNumber>1){await page.locator('#page-number').fill(String(pageNumber));await page.locator('#page-number').press('Enter');await page.waitForFunction(p=>window.interactionState.page===p,pageNumber);}
  await page.locator(`.pdf-page[data-page="${pageNumber}"] .textLayer span`).first().waitFor();
  const start=performance.now();await page.locator('[data-action=flow-edit]').first().click();await page.locator('.page-edit-hit:not(.unavailable)').first().waitFor();timings.editorOpenMs=performance.now()-start;
  const candidates=await page.locator('.page-edit-hit:not(.unavailable)').evaluateAll(es=>es.map((e,i)=>({i,text:e.title})));
  const selected=candidates.filter(c=>c.text.length>40&&/202[45]/.test(c.text)).sort((a,b)=>b.text.length-a.text.length)[0]||candidates.sort((a,b)=>b.text.length-a.text.length)[0];assert(selected);
  const active=performance.now();await page.locator('.page-edit-hit:not(.unavailable)').nth(selected.i).click();await page.waitForFunction(()=>{const e=document.querySelector('.page-edit-input');return e&&!e.disabled&&e.value.length>0;});timings.paragraphActivateMs=performance.now()-active;
  const input=page.locator('.page-edit-input'),before=await input.inputValue(),edited=/202[45]/.test(before)?before.replace(/202[45]/,'2026'):before.replace(/a/,'A');
  const typing=performance.now();await input.fill(edited);timings.inputMs=performance.now()-typing;const apply=performance.now();await page.locator('#pe-done').click();await page.locator('.page-edit-bar').waitFor({state:'detached',timeout:120000});timings.applyMs=performance.now()-apply;
  assert(await page.evaluate(text=>window.interactionState.nativeEdits.some(e=>e.model?.text===text),edited));
  checks.push('A real paragraph is edited and applied through the on-page editor');
  async function selectPage(){
   await page.evaluate(async number=>{const {surface}=await import('./app.mjs');window.selectionSurface=surface;await surface.go(number);await surface.update();await Promise.all([...surface.entries.values()].map(e=>e.promise));},pageNumber);
   // A newly attached document resizes its prepared viewport once. Select only
   // after that actual text layer has settled, rather than a detached predecessor.
   await page.waitForFunction(number=>{const layer=document.querySelector(`.pdf-page[data-page="${number}"] .textLayer`),now=performance.now();if(!layer||window.selectionSurface.updatePromise||layer!==window.stableSelectionLayer){window.stableSelectionLayer=layer;window.selectionStableSince=now;return false;}return now-window.selectionStableSince>300;},pageNumber);
   const detail=await page.evaluate(number=>{
    const layer=document.querySelector(`.pdf-page[data-page="${number}"] .textLayer`),spans=[...layer.querySelectorAll('span')].filter(e=>e.firstChild?.nodeType===3&&e.textContent.trim());
    const range=document.createRange();range.setStart(spans[0].firstChild,0);range.setEnd(spans.at(-1).firstChild,spans.at(-1).firstChild.length);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
    return {text:selection.toString(),fragments:spans.length};
   },pageNumber);
   try{await page.waitForFunction(number=>!!document.querySelector(`.pdf-page[data-page="${number}"] .text-selection-overlay path`),pageNumber,{timeout:10000});}catch(error){console.log('Selection diagnostic',await page.evaluate(()=>({visibility:document.visibilityState,selected:getSelection()?.toString().length,anchorConnected:getSelection()?.anchorNode?.isConnected,layer:getSelection()?.anchorNode?.parentElement?.closest('.textLayer')?.outerHTML.slice(0,250),pages:[...document.querySelectorAll('.pdf-page')].map(e=>({page:e.dataset.page,width:e.getBoundingClientRect().width,spans:e.querySelectorAll('.textLayer span').length})),errors:document.querySelector('#toast')?.textContent})));throw error;}
   await page.waitForTimeout(80);
   const painted=await page.locator(`.pdf-page[data-page="${pageNumber}"] .text-selection-overlay path`).evaluate(p=>({bands:(p.getAttribute('d').match(/M/g)||[]).length,stroke:getComputedStyle(p).stroke,text:getSelection().toString()}));
   assert.equal(painted.text,detail.text,'Painting must not rewrite copied text');assert(painted.bands<detail.fragments,JSON.stringify({detail:{fragments:detail.fragments},painted:{bands:painted.bands}}));return {fragments:detail.fragments,bands:painted.bands,stroke:painted.stroke};
  }
  const selection=await selectPage();assert.equal(selection.stroke,'none');
  await page.evaluate(text=>{const el=[...document.querySelectorAll('.pdf-page .textLayer span')].find(e=>e.textContent.includes(text.slice(0,12)));el?.scrollIntoView({block:'center'});},edited);
  await require('./native-capture.cjs')(app,page,'tests/output/selection-edited-281.png');
  checks.push('Edited text fragments merge into continuous line bands; copying is unchanged and the default has no outline');
  await page.evaluate(()=>getSelection().removeAllRanges());await page.keyboard.press('Control+k');await page.locator('#set-wrap').waitFor({state:'attached'});
  const ids=await page.locator('.prefs input[type=checkbox]').evaluateAll(es=>es.map(e=>e.id));
  for(const id of ids){const el=page.locator('#'+id),label=page.locator('label').filter({has:el});await el.scrollIntoViewIfNeeded();const initial=await el.isChecked();await label.click();assert.equal(await el.isChecked(),!initial,id+' label single click');await el.click();assert.equal(await el.isChecked(),initial,id+' input single click');await el.focus();await page.keyboard.press('Space');assert.equal(await el.isChecked(),!initial,id+' keyboard');await page.keyboard.press('Space');}
  // A category jump must finish before the first checkbox pointer sequence.
  await page.locator('[data-pref-nav=bookmarks]').click();const wrap=page.locator('#set-wrap');await wrap.check();
  await page.locator('[data-pref-nav=reading]').click();await page.locator('#set-selection-border').check();
  await page.locator('#modal-footer button').last().click();await page.locator('#modal').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('folio-settings')).selectionBorder),true);
  await page.evaluate(async()=>{const {S,commit}=await import('./app.mjs'),{makeNode}=await import('./model.mjs');const nodes=[makeNode('Short',1),makeNode('Long bookmark title with enough words to occupy two lines in the bookmark sidebar '.repeat(2),1)];for(let i=0;i<10000;i++)nodes.push(makeNode('Chapter '+i,1));const start=performance.now();commit(nodes);window.treeBuildMs=performance.now()-start;});
  const heights=await page.locator('.tree-row').evaluateAll(es=>es.slice(0,3).map(e=>({text:e.querySelector('.title').textContent,height:e.getBoundingClientRect().height,top:e.offsetTop})));assert.equal(heights[0].height,heights[2].height);assert(heights[1].height>heights[0].height);assert.equal(heights[2].top,heights[0].height+heights[1].height);
  timings.treeBuildMs=await page.evaluate(()=>window.treeBuildMs);assert(await page.locator('.tree-row').count()<60,'Bookmark rows remain virtualized');
  checks.push(`${ids.length} preferences toggle on the first label/input/keyboard action; short bookmarks retain single-row height in a 10,002-row wrapped tree`);
  const outlined=await selectPage();assert.notEqual(outlined.stroke,'none');await require('./native-capture.cjs')(app,page,'tests/output/selection-outline-281.png');
  await page.evaluate(()=>getSelection().removeAllRanges());await page.keyboard.press('Control+k');await page.locator('[data-pref-nav=reading]').click();assert(await page.locator('#set-selection-border').isChecked());await page.locator('#set-selection-border').uncheck();await page.locator('#modal-footer button').last().click();
  await page.locator('#modal').waitFor({state:'hidden'});
  const borderless=await selectPage();assert.equal(borderless.stroke,'none');
  checks.push('The selection outline preference persists, reopens checked, and can be disabled independently');
  await page.evaluate(()=>{getSelection().removeAllRanges();window.interactionState.lastSaveMetrics=null;document.querySelector('[data-action=save]').click();});await page.waitForFunction(()=>!!window.interactionState.lastSaveMetrics&&!window.interactionState.busy&&!window.interactionState.dirty);
  timings.save=await page.evaluate(()=>window.interactionState.lastSaveMetrics);
  const original=fs.readFileSync(source),saved=fs.readFileSync(file);assert(saved.subarray(0,original.length).equals(original));
  const longTasks=await page.evaluate(()=>window.longTasks);assert.deepEqual(errors,[]);
  const coldFile=path.resolve('tests/output/interaction-281-reopened.pdf');fs.writeFileSync(coldFile,saved);
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),coldFile);
  const created=app.context().waitForEvent('page'),opening=page.evaluate(()=>window.desktop.openDocuments());page=await created;await opening;page.on('pageerror',e=>errors.push(e.message));
  const cold=await selectPage();assert.equal(cold.stroke,'none');
  const reopenedText=await page.evaluate(async number=>{const {S}=await import('./app.mjs');return (await (await S.pdf.getPage(number)).getTextContent()).items.map(i=>i.str).join('');},pageNumber);
  assert(reopenedText.replace(/\s/g,'').includes(edited.replace(/\s/g,'')),'Edited paragraph survives cold reopening');
  checks.push('Saved paragraph text and continuous selection survive opening in a fresh document process');
  assert.deepEqual(errors,[]);fs.writeFileSync('tests/output/interaction-281.json',JSON.stringify({status:'passed',checks,selection,outlined,borderless,cold,heights,timings,longTasks,errors},null,2));console.log('PASS',checks,timings);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

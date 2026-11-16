const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const h=await require('./ui-audit-support.cjs')('reader'),{app,page,out}=h;
  const report={checks:[],controls:[],errors:h.errors};
  try{
    await h.openPDF();
    await page.locator('.tree-row .title').first().click();
    await page.locator('.target-marker').waitFor();await h.frames();
    await page.waitForTimeout(220); // Let the initial 180 ms viewer resize debounce finish before measuring settings.
    await page.evaluate(async()=>{
      const {surface}=await import('./app.mjs');
      window.auditMarkerRefreshes=0;window.auditMarkerRefresh=surface.refresh;
      surface.refresh=function(...args){window.auditMarkerRefreshes++;return window.auditMarkerRefresh.apply(this,args);};
    });
    const applyMarkerSettings=async change=>{
      await page.locator('[data-action=settings]').click();await page.locator('.prefs').waitFor();
      await page.locator('[data-pref-nav=bookmarks]').click();await change();
      await page.locator('#modal-footer .primary').click();await page.locator('#modal').waitFor({state:'hidden'});await h.frames();
    };
    await applyMarkerSettings(async()=>{
      assert(await page.locator('#set-target-marker').isChecked());await page.locator('#set-target-marker').click();
    });
    assert.equal(await page.locator('.target-marker').count(),0,'Disabling target markers removes the visible line immediately');
    await applyMarkerSettings(async()=>{
      assert(!await page.locator('#set-target-marker').isChecked());await page.locator('#set-target-marker').click();
    });
    assert.equal(await page.locator('.target-marker').count(),1,'Enabling target markers restores the current line immediately');
    await applyMarkerSettings(async()=>{
      await page.locator('#set-target-color').click();await page.locator('.cp-hex').fill('#20aa70');await page.locator('.cp-hex').press('Enter');
    });
    assert.equal(await page.locator('.target-marker').evaluate(e=>getComputedStyle(e).borderTopColor),'rgb(32, 170, 112)','Changing the target color updates the visible line immediately');
    await applyMarkerSettings(async()=>{});
    const markerRefreshes=await page.evaluate(async()=>{
      const {surface}=await import('./app.mjs');surface.refresh=window.auditMarkerRefresh;return window.auditMarkerRefreshes;
    });
    assert.equal(markerRefreshes,0,'Marker changes and unchanged settings must not refresh the PDF');
    report.checks.push('Target marker disable, enable and color changes apply immediately through real controls without refreshing the PDF; unchanged settings also avoid refresh');
    report.markerSettings={pdfRefreshes:markerRefreshes,color:'#20aa70'};
    for(const theme of ['light','dark']){
      await page.evaluate(async theme=>(await import('./appearance.mjs')).applyAppearance({theme,palette:'mulberry'}),theme);
      await page.locator('.view-options>summary').click();
      for(const id of ['cover','gaps']){
        const input=page.locator('#'+id),label=page.locator('.view-check').filter({has:input}),initial=await input.isChecked();
        await input.click();assert.equal(await input.isChecked(),!initial);
        await label.click({position:{x:80,y:16}});assert.equal(await input.isChecked(),initial);
        await input.focus();await page.keyboard.press('Space');assert.equal(await input.isChecked(),!initial);await page.keyboard.press('Space');
        const geometry=await input.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e.parentElement);return {width:r.width,height:r.height,labelHeight:e.parentElement.getBoundingClientRect().height,fontSize:parseFloat(s.fontSize)};});
        assert.equal(geometry.width,geometry.height,'Reading checkboxes remain square');assert(geometry.labelHeight>=32&&geometry.fontSize>=13);
        report.controls.push({theme,id,...geometry});
      }
      await h.capture(theme+'-display-options.png');await page.locator('.view-options>summary').click();
    }
    report.checks.push('Reading display checkboxes: pointer, label, keyboard, square geometry and readable text in both themes');
    for(const id of ['layout','zoom']){
      const select=page.locator('#'+id),original=await select.inputValue();
      const options=await select.locator('option').evaluateAll(es=>es.map(e=>({value:e.value,text:e.textContent})));
      for(const option of options){await select.click();await select.getByRole('option',{name:option.text,exact:true}).click();assert.equal(await select.inputValue(),option.value);await h.frames();}
      await select.selectOption(original);report.controls.push({id,options});
    }
    report.checks.push('Every reader zoom and page layout option selected through its visible popup');
    await page.locator('#bookmark-filter-settings>summary').click();
    for(const id of ['filter-regex','filter-case']){const b=page.locator('#'+id);await b.click();assert.equal(await b.getAttribute('aria-pressed'),'true');await b.click();assert.equal(await b.getAttribute('aria-pressed'),'false');}
    await page.locator('#bookmark-filter-settings>summary').click();await page.locator('#filter').fill('First');
    await page.waitForFunction(()=>[...document.querySelectorAll('.tree-row .title')].some(e=>e.textContent==='First'));
    await page.locator('#clear-filter').click();assert.equal(await page.locator('#filter').inputValue(),'');
    report.checks.push('Bookmark filter switches and clear action respond to clicks');
    await page.keyboard.press('Control+f');await page.locator('#find-text').fill('Folio');await page.locator('[data-action=find-run]').click();
    await page.waitForFunction(async()=>{const {S,surface}=await import('./app.mjs');return S.hits.length>0&&S.hitIndex>=0&&!surface.navigating;});
    report.search=await page.locator('#find-count').textContent();assert(!report.search.startsWith('0'));await page.keyboard.press('Escape');
    assert(await page.locator('#findbar').isHidden());
    report.checks.push('Full-document text search returns results and closes with Escape');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,520));
    await page.locator('.view-options>summary').click();
    const bounds=await page.locator('.view-options>div').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};});
    assert(bounds.left>=0&&bounds.top>=0&&bounds.right<=bounds.width&&bounds.bottom<=bounds.height);
    for(const id of ['cover','gaps']){const input=page.locator('#'+id),initial=await input.isChecked();await input.click();assert.equal(await input.isChecked(),!initial);await input.click();}
    await h.capture('compact-display-options.png');report.checks.push('Display popup and controls remain usable at 800 × 520');
    assert.deepEqual(h.errors,[]);report.status='passed';
  }finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await h.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
(async () => {
  const h = await require('./ui-audit-support.cjs')('preferences'), { app, page, out } = h;
  const report = { checks: [], issues: [], checkboxes: [], selects: [], themes: [], errors: h.errors };
  const check = (ok, message, detail) => { if (!ok) report.issues.push({ message, detail }); };
  async function open() { await page.locator('[data-action=settings]').click(); await page.locator('.prefs').waitFor(); }
  async function colorState(el) {
    return el.evaluate(e => {
      const s = getComputedStyle(e), a = getComputedStyle(e, '::after');
      const c = document.createElement('canvas').getContext('2d'); c.canvas.width = c.canvas.height = 1;
      const rgb = color => { c.clearRect(0,0,1,1); c.fillStyle=color; c.fillRect(0,0,1,1); return [...c.getImageData(0,0,1,1).data].slice(0,3); };
      const luminance = color => rgb(color).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
      const x=luminance(s.backgroundColor),y=luminance(a.borderBottomColor);
      return { checked:e.checked, focused:document.activeElement===e, background:s.backgroundColor,
        tick:a.borderBottomColor, contrast:(Math.max(x,y)+.05)/(Math.min(x,y)+.05), width:e.getBoundingClientRect().width };
    });
  }
  try {
    await open();
    const ids = await page.locator('.prefs input[type=checkbox]').evaluateAll(es=>es.map(e=>e.id));
    for (const id of ids) {
      console.log('checkbox', id);
      const el=page.locator('#'+id),label=page.locator('label').filter({has:el});
      await el.scrollIntoViewIfNeeded();
      const initial=await el.isChecked();
      await el.click(); check(await el.isChecked()===!initial,id+' input click');
      if (!await el.isChecked()) await el.click();
      await page.waitForTimeout(180); // Inspect the final visible state with real transitions enabled.
      const visual=await colorState(el); check(visual.focused&&visual.contrast>=3,id+' focused checkmark contrast',visual);
      report.checkboxes.push({id,...visual});
      if (id==='set-ignore-zoom') await h.capture('focused-checkbox.png');
      await label.click({position:{x:90,y:12}}); check(!await el.isChecked(),id+' label click');
      await el.focus(); await page.keyboard.press('Space'); check(await el.isChecked(),id+' Space toggles');
      await page.keyboard.press('Space'); check(!await el.isChecked(),id+' second Space toggles');
      if(initial)await el.click();
    }
    report.checks.push('All preferences checkboxes: pointer, label, Space, focused visual contrast');
    if(process.env.FOLIO_AUDIT_BASELINE) return;
    // Change options through the Chromium picker, including its real option hit areas.
    for (const id of ['settings-language','set-theme','set-whitespace-unit','set-wheel-preset','set-quality','set-row','set-save-mode','set-ai-display']) {
      console.log('select', id);
      const el=page.locator('#'+id),initial=await el.inputValue();
      const values=await el.locator('option').evaluateAll(es=>es.filter(e=>!e.disabled).map(e=>e.value));
      for(const value of values){await el.scrollIntoViewIfNeeded();await el.click();await el.locator('option').filter({hasText:await el.locator('option').evaluateAll((es,v)=>es.find(e=>e.value===v).textContent,value)}).click();check(await el.inputValue()===value,id+' option '+value);}
      await el.selectOption(initial);report.selects.push({id,values});
    }
    await page.locator('#settings-language').selectOption('zh-Hans');
    for(const theme of ['light','dark'])for(const palette of ['cobalt','jade','amber','mulberry','slate','custom']){
      console.log('palette', theme, palette);
      await page.locator('#set-theme').selectOption(theme);
      await page.locator(`.palette-options label:has(input[value=${palette}])`).click();
      await page.locator('[data-pref-nav=bookmarks]').click();
      const el=page.locator('#set-ignore-zoom');if(!await el.isChecked())await el.click();else await el.focus();
      await page.waitForTimeout(180);const visual=await colorState(el);
      check(visual.contrast>=3,theme+'/'+palette+' checkmark contrast',visual);report.themes.push({theme,palette,contrast:visual.contrast});
    }
    report.checks.push('Every non-security preference select option; all 12 theme/palette combinations');
    // Every numeric field must reject empty, out-of-range and fractional values.
    for(const id of ['set-sidebar','set-wheel-lines','set-undo','set-disk-budget','set-ai-threshold']){
      const el=page.locator('#'+id),original=await el.inputValue();
      for(const value of ['',String(Number(await el.getAttribute('min'))-1),String(Number(await el.getAttribute('max'))+1),'1.5']){
        await el.fill(value);await page.locator('#modal-footer .primary').click();
        check(await page.locator('.prefs').isVisible(),id+' invalid value stays in preferences',value);
        check(await el.evaluate(e=>!e.validity.valid),id+' invalid '+value);
      }
      await el.fill(original);
    }
    report.checks.push('Numeric required/range/integer validation before settings writes');
    await page.locator('#set-theme').selectOption('light');
    await page.locator('.palette-options label:has(input[value=mulberry])').click();
    await page.locator('#set-sidebar').fill('302');await page.locator('#set-row').selectOption('28');
    const expected={};
    for(const id of ids){const el=page.locator('#'+id);if(id==='set-gpu'){if(await el.isChecked())await el.click();}else await el.click();expected[id]=await el.isChecked();}
    await page.locator('#modal-footer .primary').click();await page.locator('#modal').waitFor({state:'hidden'});
    await open();
    for(const [id,value]of Object.entries(expected))check(await page.locator('#'+id).isChecked()===value,id+' persisted');
    check(await page.locator('#set-sidebar').inputValue()==='302','Sidebar persisted');
    await page.locator('#set-theme').selectOption('dark');await page.locator('#set-sidebar').fill('400');await page.keyboard.press('Escape');
    await open();check(await page.locator('#set-sidebar').inputValue()==='302','Cancel discards numeric draft');check(await page.locator('#set-theme').inputValue()==='light','Cancel restores theme');
    await page.locator('[data-pref-nav=general]').click();await page.locator('#set-selection-color').click();
    await page.locator('.cp-pop').waitFor();const old=await page.locator('#set-selection-color').inputValue();
    await page.locator('.cp-hex').fill('#ff0000');await page.locator('.cp-hex').press('Tab');await page.keyboard.press('Escape');
    check(await page.locator('#set-selection-color').inputValue()===old,'Color picker Escape restores preview');
    check(await page.locator('#modal').isVisible(),'Picker Escape does not dismiss preferences');
    report.checks.push('Apply/reopen persistence, cancellation rollback, color picker Escape');
    for(const size of [[800,520],[1024,768],[1440,960]]){
      await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),size);await h.frames();
      for(const category of ['general','reading','bookmarks','saving','performance','ai','advanced']){
        await page.locator(`[data-pref-nav=${category}]`).click();
        const layout=await page.evaluate(()=>{const d=document.querySelector('#modal'),p=document.querySelector('.prefs-scroll'),f=document.querySelector('#modal-footer'),r=f.getBoundingClientRect();return {overflow:d.scrollWidth>d.clientWidth+1||p.scrollWidth>p.clientWidth+1,footer:r.top>=0&&r.bottom<=innerHeight,active:document.querySelector('[data-pref-nav][aria-current=true]')?.dataset.prefNav};});
        check(!layout.overflow&&layout.footer&&layout.active===category,'Preferences layout '+size+' '+category,layout);
      }
      await h.capture('preferences-'+size.join('x')+'.png');
    }
    report.checks.push('All seven categories at 800×520, 1024×768 and 1440×960');
    await page.keyboard.press('Escape');await page.reload();await page.locator('#ribbon-tab-home').waitFor();await open();
    for(const [id,value]of Object.entries(expected))check(await page.locator('#'+id).isChecked()===value,id+' reload persisted');
    report.checks.push('Settings survive a renderer reload');
    // Hold the native write until real pointer/keyboard attempts have exercised the busy dialog.
    await app.evaluate(({ipcMain})=>{
      const state=globalThis.folioSettingsAuditIPC={original:ipcMain._invokeHandlers.get('storage-budget'),calls:0,release:null,fail:true};
      ipcMain.removeHandler('storage-budget');
      ipcMain.handle('storage-budget',async(event,value)=>{
        if(value===undefined)return state.original(event,value);
        state.calls++;await new Promise(resolve=>{state.release=resolve;});state.release=null;
        if(state.fail)throw Error('Settings audit: simulated cache write failure');
        return state.original(event,value);
      });
    });
    try{
      const originalBudget=Number(await page.locator('#set-disk-budget').inputValue());
      const originalSidebar=await page.locator('#set-sidebar').inputValue();
      const disabledBefore=await page.locator('#modal button,#modal input,#modal select,#modal textarea').evaluateAll(es=>es.map(e=>e.disabled));
      const clickAt=async locator=>{const r=await locator.boundingBox();assert(r);await page.mouse.click(r.x+r.width/2,r.y+r.height/2);};
      const exercisePending=async calls=>{
        await page.waitForFunction(()=>document.querySelector('#modal').getAttribute('aria-busy')==='true');
        assert(await page.locator('#modal button,#modal input,#modal select,#modal textarea').evaluateAll(es=>es.every(e=>e.disabled)),'All preferences controls are frozen during the native write');
        const budget=page.locator('#set-disk-budget'),draft=await budget.inputValue();
        await clickAt(budget);await page.keyboard.press('Control+A');await page.keyboard.press('9');
        assert.equal(await budget.inputValue(),draft,'A pending draft cannot be edited');
        const gpu=page.locator('#set-gpu'),checked=await gpu.isChecked();await clickAt(gpu);
        assert.equal(await gpu.isChecked(),checked,'A pending checkbox cannot be toggled');
        for(const selector of ['#modal-footer button:not(.primary)','#modal-close','#modal-footer .primary']){
          await clickAt(page.locator(selector));assert(await page.locator('#modal').isVisible(),'Busy settings stay open after clicking '+selector);
        }
        await page.keyboard.press('Escape');assert(await page.locator('#modal').isVisible(),'Escape cannot dismiss a pending write');
        assert.equal(await app.evaluate(()=>globalThis.folioSettingsAuditIPC.calls),calls,'Repeated clicks cannot start a second write');
        assert.equal(await page.evaluate(()=>String(JSON.parse(localStorage.getItem('folio-settings')).sidebar)),originalSidebar,'A pending draft has not been silently applied');
      };
      await page.locator('#set-sidebar').fill('318');await page.locator('#set-disk-budget').fill(String(originalBudget+1));
      await page.locator('[data-pref-nav=performance]').click();await page.locator('#modal-footer .primary').click();
      await exercisePending(1);
      await app.evaluate(()=>globalThis.folioSettingsAuditIPC.release());
      await page.locator('#modal-error:not([hidden])').waitFor();
      assert((await page.locator('#modal-error').textContent()).includes('simulated cache write failure'));
      assert.deepEqual(await page.locator('#modal button,#modal input,#modal select,#modal textarea').evaluateAll(es=>es.map(e=>e.disabled)),disabledBefore,'Failure restores every original enabled/disabled state');
      assert.equal(await page.locator('#modal').getAttribute('aria-busy'),null);
      assert.equal(await page.evaluate(()=>String(JSON.parse(localStorage.getItem('folio-settings')).sidebar)),originalSidebar,'Failure does not apply the UI draft');
      await page.locator('#set-sidebar').fill('320');await page.locator('#set-disk-budget').fill(String(originalBudget+2));
      await page.locator('[data-pref-nav=performance]').click();await page.locator('#modal-footer .primary').click();
      await exercisePending(2);
      await app.evaluate(()=>{const state=globalThis.folioSettingsAuditIPC;state.fail=false;state.release();});
      await page.locator('#modal').waitFor({state:'hidden'});await open();
      assert.equal(await page.locator('#set-sidebar').inputValue(),'320');
      assert.equal(await page.locator('#set-disk-budget').inputValue(),String(originalBudget+2));
      assert(await page.locator('#modal-close').isEnabled());await page.locator('#modal-close').click();
      await page.locator('[data-action=help]').click();await page.locator('#modal').waitFor();
      assert(await page.locator('#modal-close').isEnabled());await page.keyboard.press('Escape');await page.locator('#modal').waitFor({state:'hidden'});
      report.checks.push('Delayed native submission freezes inputs and blocks Cancel, close, Escape and duplicate Apply; failure unlocks for retry, success persists and other dialogs still close');
    }finally{
      await app.evaluate(({ipcMain})=>{const state=globalThis.folioSettingsAuditIPC;state.release?.();ipcMain.removeHandler('storage-budget');ipcMain.handle('storage-budget',state.original);delete globalThis.folioSettingsAuditIPC;});
    }
  } finally {
    report.status=report.issues.length||h.errors.length?'failed':'passed';
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));await h.close();
  }
  assert.equal(report.issues.length,0,'Preferences audit has failures');assert.deepEqual(h.errors,[]);
})().catch(e=>{console.error(e);process.exitCode=1;});

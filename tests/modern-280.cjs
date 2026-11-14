const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const {app,page} = await require('./creative-harness.cjs')();
  const errors=[], checks=[], capture=require('./native-capture.cjs');
  page.on('pageerror',e=>errors.push(e.message));
  try {
    await app.evaluate(({BrowserWindow,dialog}, file) => {
      const win=BrowserWindow.getAllWindows()[0];win.setSize(1440,900);win.show();
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
    },path.resolve('tests/output/workflow-250-source.pdf'));
    await page.evaluate(()=>window.desktop.openDocuments());
    await page.locator('.tree-row .title').first().click();
    for(let i=0;i<3;i++) {
      await page.keyboard.press('F2');
      await page.locator('.inline-name').fill('Renamed '+i);
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.tree-row').count(),3);
      assert.equal(await page.locator('.tree-row .title').first().innerText(),'Renamed '+i);
    }
    checks.push('repeated bookmark rename retains exactly one row per bookmark');
    await page.evaluate(()=>document.querySelector('[data-action=right-expand]')?.click());
    await page.locator('#prop-color').click();
    await page.evaluate(()=>{window.colourEvents=[];const input=document.querySelector('#prop-color');for(const type of ['input','change'])input.addEventListener(type,()=>window.colourEvents.push(type));});
    const swatch=page.locator('.cp-grid .cp-swatch').nth(6), colour=await swatch.getAttribute('data-hex');
    await swatch.click();
    assert.deepEqual(await page.evaluate(()=>window.colourEvents),['input','change']);
    assert.equal((await page.locator('#prop-color').inputValue()).toLowerCase(),colour.toLowerCase());
    await page.locator('#prop-color').click();
    await page.locator('.cp-hex').fill('#123456');
    await page.keyboard.press('Escape');
    assert.equal((await page.locator('#prop-color').inputValue()).toLowerCase(),colour.toLowerCase());
    checks.push('colour presets emit input before change; Escape restores the previous colour');

    const thumbnail=await page.evaluate(async()=>{
      const {installTargetThumb}=await import('./target-thumb.mjs');
      let renders=0,gets=0,coordinate=20;
      const host=document.createElement('div');document.body.append(host);
      const pdf={async getPage(){gets++;return {getViewport:()=>({width:232,height:300,convertToViewportPoint:(x,y)=>[x,y]}),render:()=>{renders++;return {promise:Promise.resolve(),cancel(){}};}};}};
      const thumb=installTargetThumb({S:{pdf,info:{pageCount:1}},host,read:()=>({page:1,mode:'XYZ',args:[coordinate,30]})});
      const flush=()=>new Promise(r=>setTimeout(r,20));
      thumb.show(true);thumb.refresh(true);await flush();
      coordinate=50;thumb.refresh(true);await flush();
      const marker=host.querySelector('.tt-mark').style.left;
      thumb.show(false);thumb.refresh(true);await flush();
      thumb.destroy();host.remove();return {renders,gets,marker};
    });
    assert.deepEqual(thumbnail,{renders:1,gets:1,marker:'50px'});
    checks.push('bookmark coordinate edits reuse the raster and hidden previews do no work');

    await page.locator('#ribbon-tab-bookmarks').click();
    await page.locator('[data-ribbon-command=generate]').click();
    await page.locator('.rule-card:not([hidden]) [data-field=pattern]').fill('^Folio');
    await page.locator('.rule-card:not([hidden]) [data-field=template]').fill('$0');
    await page.locator('#multi-range').fill('1-3');
    await page.waitForFunction(()=>!document.querySelector('#multi-apply').disabled);
    assert.equal(await page.locator('#multi-preview .preview-item').count(),3);
    const invalidated=await page.evaluate(()=>{const box=document.querySelector('#multi-dedupe');box.click();return document.querySelector('#multi-apply').disabled;});
    assert(invalidated,'footer dedupe changes must invalidate the old preview');
    await page.waitForFunction(()=>!document.querySelector('#multi-apply').disabled);
    checks.push('automatic rule preview covers the range and footer changes regenerate it');
    for (const [theme,language,width,height] of [['light','zh-Hans',1440,900],['dark','en',1440,900],['light','zh-Hant',900,700]]) {
      await app.evaluate(({BrowserWindow},[width,height])=>BrowserWindow.getAllWindows()[0].setSize(width,height),[width,height]);
      await page.evaluate(async({theme,language})=>{(await import('./appearance.mjs')).applyAppearance({theme,palette:'cobalt'});(await import('./i18n.mjs')).setLanguage(language);},{theme,language});
      await page.waitForTimeout(250);
      const layout=await page.evaluate(()=>{
        const d=document.querySelector('#modal'), r=d.getBoundingClientRect();
        const b=document.querySelector('#multi-apply').getBoundingClientRect();
        return {inside:r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1,action:b.top>=r.top&&b.bottom<=r.bottom+1,overflow:d.scrollWidth>d.clientWidth+2,panes:[...d.querySelectorAll('.rules-nav,.rules-editor,.rules-results')].every(p=>p.clientWidth>100&&p.clientHeight>80)};
      });
      assert(layout.inside&&layout.action&&!layout.overflow&&layout.panes,JSON.stringify({theme,language,layout}));
      await capture(app,page,`tests/output/modern-280-${theme}-${language}.png`);
    }
    checks.push('light/dark and three languages keep preview, editor and Apply within the window');
    await page.locator('#modal-close').click();
    assert.deepEqual(errors,[]);
    fs.writeFileSync('tests/output/modern-280.json',JSON.stringify({status:'passed',checks,thumbnail,errors},null,2));
    console.log('PASS modern UI',checks);
  } finally {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

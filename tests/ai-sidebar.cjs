const { _electron: electron, chromium } = require('playwright');
const path = require('path'), fs = require('fs'), assert = require('assert/strict');
(async () => {
  const id = Date.now();
  const app = await electron.launch({args:[path.resolve('.')], env:{...process.env,
    FOLIO_TEST_BACKGROUND:'0', FOLIO_TEST_PROFILE:path.resolve('tests/output/sidebar-'+id),
    FOLIO_CHATBOX_PROFILE:path.resolve('tests/output/sidebar-chat-'+id), FOLIO_TEST_CHATBOX_PORT:'19486'}, timeout:60000});
  let browser;
  const checks=[];
  try {
    const host=await app.firstWindow(); await host.waitForLoadState('domcontentloaded');
    await host.evaluate(()=>window.desktop.aiOpen());
    for(let n=0;n<40;n++) { try { browser=await chromium.connectOverCDP('http://127.0.0.1:19486');break; } catch {await new Promise(r=>setTimeout(r,250));} }
    assert(browser);
    const chat=browser.contexts()[0].pages().find(p=>p.url().includes('/renderer/index.html'));
    await chat.waitForFunction(()=>!!window.electronAPI);
    await chat.waitForTimeout(2000);
    const input=chat.locator('textarea[placeholder]').first();
    for(const mode of ['sidebar','window','sidebar','window','sidebar']) {
      await host.evaluate(mode=>window.desktop.aiDisplay(mode),mode);
      await chat.waitForTimeout(400); await chat.bringToFront();
      await input.click(); await chat.keyboard.press('Control+a');
      await chat.keyboard.type('Focus-'+mode); await chat.keyboard.insertText(' 中文输入');
      assert.equal(await input.inputValue(),'Focus-'+mode+' 中文输入');
      assert(await input.evaluate(e=>document.activeElement===e && document.hasFocus()),'native renderer focus');
      await chat.keyboard.press('Backspace');
      assert.equal(await input.inputValue(),'Focus-'+mode+' 中文输');
      checks.push(mode+' click, keys, Chinese text and Backspace');
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:70,y:70,width:1200,height:820}));
    await host.evaluate(()=>window.desktop.aiOverlay(true));
    await host.evaluate(()=>window.desktop.aiOverlay(false));
    await host.evaluate(()=>window.desktop.aiOpen()); await host.evaluate(()=>window.desktop.aiOpen());
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.minimize();});
    await host.waitForTimeout(400);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].restore());
    await chat.waitForTimeout(500);await chat.bringToFront();await input.click();
    await chat.keyboard.press('Control+a');await chat.keyboard.type('RESTORED');
    assert.equal(await input.inputValue(),'RESTORED');
    checks.push('resize, overlay, hide/show and minimize/restore preserve input');
    await chat.screenshot({path:'tests/output/sidebar-201.png'});
    fs.writeFileSync('tests/output/sidebar-201.json',JSON.stringify({checks,errors:[],inputMethod:'Chromium keyboard events; physical IME candidate selection not certified'},null,2));
    console.log('PASS',checks);
  } finally { await browser?.close();await app.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});

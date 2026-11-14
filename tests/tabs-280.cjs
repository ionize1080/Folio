const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

(async () => {
  const { app, page: home } = await require('./creative-harness.cjs')();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  const errors = [], checks = [];
  const watch = page => page.on('pageerror', e => errors.push(e.message));
  watch(home); app.context().on('page', watch);
  const pick = file => app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, path.resolve(file));
  try {
    await pick('tests/output/workflow-250-source.pdf');
    await home.evaluate(() => window.desktop.openDocuments());
    const first = await home.evaluate(() => window.desktop.tabsState());
    await home.evaluate(() => { window.retainedTab = document.querySelector('.document-tab'); });
    // Hold the second renderer's successful load acknowledgement. During this
    // deterministic slow-open interval the first document must remain on screen.
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows()[0].webContents;
      const handler = ipcMain._invokeHandlers.get('tabs-reply');
      const gate = new Promise(resolve => { globalThis.releaseDocumentLoad = resolve; });
      ipcMain.removeHandler('tabs-reply');
      ipcMain.handle('tabs-reply', async (event, value) => {
        if (event.sender !== owner && value.result === true && !globalThis.documentLoadBlocked) {
          globalThis.documentLoadBlocked = true;
          await gate;
        }
        return handler(event, value);
      });
    });
    await pick('tests/output/organizer-source.pdf');
    const created = app.context().waitForEvent('page', { predicate: p => p !== home });
    const opening = home.evaluate(() => window.desktop.openDocuments());
    opening.catch(() => {});
    const other = await created;
    other.setDefaultTimeout(30000);
    await other.waitForFunction(() => document.querySelector('#page-shell')?.dataset.ready === 'true').catch(async error => {
      console.error('Preparing editor:', await other.evaluate(async () => ({
        url: location.href, viewport: [innerWidth, innerHeight],
        body: document.body.innerText.slice(-1400), state: await window.desktop.tabsState(),
        pages: [...document.querySelectorAll('.pdf-page')].map(p => ({ready:p.dataset.ready, size:[p.clientWidth,p.clientHeight]})),
      })));
      throw error;
    });
    let blocked = false;
    for (let i = 0; i < 200 && !blocked; i++) {
      blocked = await app.evaluate(() => !!globalThis.documentLoadBlocked);
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert(blocked, 'second load must reach the held acknowledgement');
    const during = await home.evaluate(async () => ({
      state: await window.desktop.tabsState(),
      retained: window.retainedTab === document.querySelector('.document-tab'),
      name: document.querySelector('#doc-name').textContent,
    }));
    assert.equal(during.state.activeDocumentId, first.activeDocumentId);
    assert.equal(during.state.documents.length, 2);
    assert(during.state.documents[1].loading);
    assert(during.retained);
    assert.match(during.name, /workflow-250/);
    checks.push('opening a second file keeps the existing document and tab DOM visible until its first page is ready');
    const readyStart = performance.now();
    await app.evaluate(() => globalThis.releaseDocumentLoad());
    await opening;
    const readySwapMs = performance.now() - readyStart;
    const loaded = await home.evaluate(() => window.desktop.tabsState());
    assert.equal(loaded.activeDocumentId, loaded.documents[1].documentId);
    assert(loaded.documents.every(d => !d.loading));
    assert.equal(await other.locator('#page-shell').getAttribute('data-ready'), 'true');
    const switches = [];
    for (let i = 0; i < 16; i++) {
      const start = performance.now(), target = loaded.documents[i % 2].documentId;
      await home.evaluate(id => window.desktop.tabSelect(id), target);
      assert.equal((await home.evaluate(() => window.desktop.tabsState())).activeDocumentId, target);
      switches.push(performance.now() - start);
    }
    assert(await home.evaluate(() => window.retainedTab === document.querySelector('.document-tab')));
    checks.push('16 warm document switches preserve live editors and tab nodes');
    await other.locator('#ribbon-tab-read').focus();
    await other.keyboard.press('ArrowRight');
    assert.equal(await other.locator('#ribbon-tab-edit').getAttribute('aria-selected'), 'true');
    assert.equal((await home.evaluate(() => window.desktop.tabsState())).activeDocumentId, loaded.activeDocumentId);
    checks.push('ribbon arrow keys never switch documents');
    await pick('tests/output/organizer-source.pdf');
    await other.evaluate(() => window.desktop.openDocuments());
    assert.equal((await home.evaluate(() => window.desktop.tabsState())).documents.length, 2);
    checks.push('reopening the same path selects its existing Chrome-style tab');
    const invalid = path.resolve('tests/output/tabs-invalid.pdf');
    fs.writeFileSync(invalid, 'not a PDF');
    await pick(invalid);
    await other.evaluate(() => window.desktop.openDocuments());
    const afterError = await home.evaluate(() => window.desktop.tabsState());
    assert.equal(afterError.activeDocumentId, loaded.activeDocumentId);
    assert.equal(afterError.documents.length, 2);
    checks.push('an invalid new document leaves the previous document active');
    const encrypted=path.resolve('tests/output/tabs-encrypted.pdf');
    const fixture=require('node:child_process').spawnSync(process.env.FOLIO_PYTHON||path.resolve('native/runtime/python.exe'),['-c',
      'import fitz,sys; d=fitz.open(sys.argv[1]); d.save(sys.argv[2],encryption=fitz.PDF_ENCRYPT_AES_256,owner_pw="owner-test",user_pw="folio-test")',
      path.resolve('tests/output/organizer-source.pdf'),encrypted],{encoding:'utf8',windowsHide:true});
    assert.equal(fixture.status,0,fixture.stderr);
    await pick(encrypted);
    const passwordPage=app.context().waitForEvent('page',{predicate:p=>p!==home&&p!==other});
    const unlocking=other.evaluate(()=>window.desktop.openDocuments());unlocking.catch(()=>{});
    const locked=await passwordPage;
    await locked.locator('#open-password').waitFor();
    const waiting=await home.evaluate(()=>window.desktop.tabsState());
    assert.equal(waiting.activeDocumentId,waiting.documents[2].documentId,'password prompt must be in the visible editor');
    await home.evaluate(id=>window.desktop.tabSelect(id),loaded.activeDocumentId);
    await home.evaluate(id=>window.desktop.tabSelect(id),waiting.activeDocumentId);
    assert.equal((await home.evaluate(()=>window.desktop.tabsState())).activeDocumentId,waiting.activeDocumentId);
    await locked.locator('#modal-footer button').first().click().catch(error => {
      // Cancel closes this renderer; Chromium can acknowledge after it exits.
      if (!locked.isClosed()) throw error;
    });
    await unlocking;
    const cancelled=await home.evaluate(()=>window.desktop.tabsState());
    assert.equal(cancelled.documents.length,2);
    assert.equal(cancelled.activeDocumentId,loaded.activeDocumentId);
    checks.push('encrypted documents expose their password prompt, allow switching away/back, and cancel safely');
    assert.deepEqual(errors, []);
    const medianSwitchMs = [...switches].sort((a, b) => a - b)[Math.floor(switches.length / 2)];
    fs.writeFileSync('tests/output/tabs-280.json', JSON.stringify({ status: 'passed', checks, readySwapMs, medianSwitchMs, switches, errors }, null, 2));
    console.log(JSON.stringify({ checks, readySwapMs, medianSwitchMs }));
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
})().catch(e => { console.error(e); process.exitCode = 1; });

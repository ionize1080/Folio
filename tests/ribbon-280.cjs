// Exercise the real Electron renderer; keep timing evidence separate from layout invariants.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const { app, page } = await require('./creative-harness.cjs')();
  const errors = [], checks = [], baseline = process.env.FOLIO_RIBBON_BASELINE === '1';
  page.on('pageerror', e => errors.push(e.message));
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.setSize(1440, 900); win.show();
    });
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, path.resolve('tests/output/workflow-250-source.pdf'));
    await page.locator('[data-action=open]').first().click();
    await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent.includes('workflow-250'));
    await page.locator('#busy').waitFor({ state: 'hidden' });
    await page.locator('#page-shell[data-ready]').waitFor();
    // Let initial PDF text/tile rendering settle before attributing work to tabs.
    await page.waitForTimeout(1200);
    const timings = [];
    for (const language of ['zh-Hans', 'en', 'zh-Hant']) {
      await page.evaluate(async lang => (await import('./i18n.mjs')).setLanguage(lang), language);
      const result = await page.evaluate(async () => {
        const ids = [...document.querySelectorAll('.ribbon-tabs button')].map(b => b.dataset.category);
        const header = document.querySelector('.appbar'), host = document.querySelector('#canvas-host');
        const switches = [], longTasks = [];
        let mutations = 0, resizes = 0;
        const mo = new MutationObserver(rs => { mutations += rs.filter(r => r.type === 'childList').length; });
        const ro = new ResizeObserver(() => resizes++);
        const po = new PerformanceObserver(l => longTasks.push(...l.getEntries().map(e => e.duration)));
        mo.observe(header, { childList: true, subtree: true }); ro.observe(host);
        po.observe({ type: 'longtask' });
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        mutations = 0; resizes = 0;
        const height = header.offsetHeight, hostSize = [host.clientWidth, host.clientHeight];
        for (let round = 0; round < 4; round++) for (const id of ids) {
          await new Promise(r => requestAnimationFrame(r));
          const start = performance.now();
          document.querySelector('#ribbon-tab-' + id).click();
          const handlerMs = performance.now() - start;
          await Promise.resolve();
          const layoutStart = performance.now();
          const stable = header.offsetHeight === height && host.clientWidth === hostSize[0] && host.clientHeight === hostSize[1];
          const layoutMs = performance.now() - layoutStart;
          const frameMs = await new Promise(r => requestAnimationFrame(() => r(performance.now() - start)));
          switches.push({ id, handlerMs, layoutMs, frameMs, stable });
        }
        mo.disconnect(); ro.disconnect(); po.disconnect();
        return { switches, mutations, resizes, longTasks };
      });
      assert(result.switches.every(s => s.stable), language + ': tab switches must not resize the document');
      if (!baseline) assert.equal(result.mutations, 0, language + ': switching must retain command DOM');
      timings.push({ language, ...result });
    }
    checks.push('96 category switches across three languages preserve the document viewport');
    if (!baseline) {
      await page.locator('#ribbon-tab-read').click();
      await page.locator('#ribbon-tab-read').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#ribbon-tab-edit').getAttribute('aria-selected'), 'true');
      await page.keyboard.press('Home');
      assert.equal(await page.locator('#ribbon-tab-home').getAttribute('aria-selected'), 'true');
      await page.keyboard.press('End');
      assert.equal(await page.locator('#ribbon-tab-export').getAttribute('aria-selected'), 'true');
      const controls = await page.locator('.ribbon-tabs button[aria-selected=true]').getAttribute('aria-controls');
      assert(await page.locator('#' + controls).isVisible());
      await page.keyboard.press('Control+F1');
      assert.equal(await page.locator('.ribbon-collapse').getAttribute('aria-expanded'), 'false');
      await page.locator('#ribbon-tab-read').click();
      assert.equal(await page.locator('.ribbon-collapse').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.evaluate(() => localStorage.getItem('folio-ribbon-collapsed')), 'false');
      checks.push('keyboard navigation, panel accessibility and collapse state stay synchronized');
      await page.locator('#ribbon-tab-edit').click();
      const disabled = await page.locator('[data-ribbon-command=undo]').isDisabled();
      assert.equal(disabled, await page.locator('[data-action=undo]').first().isDisabled());
      checks.push('command proxies retain source disabled state');
    }
    const samples = timings.flatMap(t => t.switches);
    const percentile = (key, p) => {
      const values = samples.map(s => s[key]).sort((a, b) => a - b);
      return +values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)].toFixed(2);
    };
    const metrics = Object.fromEntries(['handlerMs', 'layoutMs', 'frameMs'].map(k => [k, { median: percentile(k, .5), p95: percentile(k, .95), max: percentile(k, 1) }]));
    assert.deepEqual(errors, []);
    if (!baseline) {
      assert(metrics.handlerMs.p95 < 20, 'ribbon handler p95 must stay below 20 ms');
      assert(metrics.frameMs.p95 < 100, 'next-frame p95 must stay below 100 ms on CI');
    }
    fs.writeFileSync('tests/output/ribbon-280' + (baseline ? '-baseline' : '') + '.json', JSON.stringify({ status: 'passed', checks, metrics, timings, errors }, null, 2));
    console.log(JSON.stringify({ checks, metrics, childListMutations: timings.map(t => t.mutations) }));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

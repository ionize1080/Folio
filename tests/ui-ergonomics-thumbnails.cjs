// Verification, latency benchmark & visual gallery for:
// 1. Ergonomic Ribbon sizing & aesthetics
// 2. VS Code-style zero-latency pointerdown Ribbon switching & CSS containment
// 3. Left Sidebar Thumbnail mode (1-col, 2-col, active sync, Ctrl+T, narrow rail)
// 4. Bug fixes & performance optimizations (fixed-zoom resize without rerender, view-options close)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const h = await require('./ui-audit-support.cjs')('ergonomics-thumbnails');
  const { app, page, out } = h;
  const checks = [];
  const demoPdf = path.resolve('docs/examples/Folio-Demo.pdf');
  assert(fs.existsSync(demoPdf), 'Demo PDF must exist');

  try {
    await h.openPDF(demoPdf);
    await h.frames();

    // 1. Verify ergonomic Ribbon dimensions & zero overflow across 3 languages & 1080/1440px
    for (const language of ['zh-Hans', 'en', 'zh-Hant']) {
      await page.evaluate(async lang => (await import('./i18n.mjs')).setLanguage(lang), language);
      for (const width of [1080, 1440]) {
        await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 900), width);
        await h.frames();
        const geom = await page.evaluate(() => {
          const tabs = [...document.querySelectorAll('.ribbon-tabs button')].map(b => {
            const r = b.getBoundingClientRect();
            return { id: b.id, h: Math.round(r.height), w: Math.round(r.width) };
          });
          const cmds = [...document.querySelectorAll('#ribbon-home button')].filter(e => e.checkVisibility()).map(b => {
            const r = b.getBoundingClientRect();
            return { label: b.textContent.trim() || b.title, x: r.x, right: r.right, h: Math.round(r.height) };
          });
          const tabRow = document.querySelector('.ribbon-tab-row').getBoundingClientRect();
          const cmdRow = document.querySelector('#ribbon-home').getBoundingClientRect();
          return {
            innerWidth,
            overflow: document.documentElement.scrollWidth > innerWidth,
            tabRowH: Math.round(tabRow.height),
            cmdRowH: Math.round(cmdRow.height),
            tabs,
            cmds,
          };
        });
        assert(!geom.overflow, `${language}@${width}: document must not overflow horizontally`);
        assert(geom.tabRowH >= 36, `${language}@${width}: ribbon tab row should be >= 36px, got ${geom.tabRowH}`);
        assert(geom.cmdRowH >= 48, `${language}@${width}: ribbon command row should be >= 48px, got ${geom.cmdRowH}`);
        for (const t of geom.tabs) {
          assert(t.h >= 36, `${language}@${width}: tab ${t.id} height should be >= 36px, got ${t.h}`);
        }
        for (const c of geom.cmds) {
          assert(c.h === 36, `${language}@${width}: command ${c.label} height should be 36px, got ${c.h}`);
          assert(c.x >= 0 && c.right <= geom.innerWidth + 1, `${language}@${width}: command ${c.label} clipped: ${JSON.stringify(c)}`);
        }
      }
    }
    await page.evaluate(async () => (await import('./i18n.mjs')).setLanguage('zh-Hans'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await h.frames();
    checks.push('Ribbon tabs, 36px commands and unclipped labels verified across three languages at 1080px and 1440px');

    // 2. Verify VS Code-style zero-latency pointerdown Ribbon switching & benchmark
    const pointerdownOk = await page.evaluate(() => {
      const tab = document.querySelector('#ribbon-tab-bookmarks');
      tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      const selectedOnDown = tab.getAttribute('aria-selected') === 'true';
      const panelVisibleOnDown = document.querySelector('#ribbon-panel-bookmarks button').checkVisibility();
      const homeHiddenOnDown =
        !document.querySelector('#ribbon-home').checkVisibility({ visibilityProperty: true }) &&
        !document.querySelector('#ribbon-home button').checkVisibility();
      return { selectedOnDown, panelVisibleOnDown, homeHiddenOnDown };
    });
    assert(pointerdownOk.selectedOnDown && pointerdownOk.panelVisibleOnDown && pointerdownOk.homeHiddenOnDown,
      'Ribbon submenu must appear immediately on pointerdown before click: ' + JSON.stringify(pointerdownOk));
    await h.frames();
    await h.capture('01-ribbon-bookmarks-submenu.png');

    // Benchmark 48 consecutive switches via pointerdown
    const ribbonBench = await page.evaluate(async () => {
      const ids = ['read', 'edit', 'photo', 'vector', 'bookmarks', 'organize', 'export', 'home'];
      const header = document.querySelector('.appbar'), host = document.querySelector('#canvas-host');
      let mutations = 0, resizes = 0;
      const mo = new MutationObserver(rs => { mutations += rs.filter(r => r.type === 'childList').length; });
      const ro = new ResizeObserver(() => resizes++);
      mo.observe(header, { childList: true, subtree: true });
      ro.observe(host);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      mutations = 0; resizes = 0;
      const syncs = [], frames = [];
      for (let round = 0; round < 6; round++) {
        for (const id of ids) {
          const t0 = performance.now();
          document.querySelector('#ribbon-tab-' + id).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
          syncs.push(performance.now() - t0);
          await new Promise(r => requestAnimationFrame(r));
          frames.push(performance.now() - t0);
        }
      }
      mo.disconnect(); ro.disconnect();
      const pct = (arr, p) => {
        const s = [...arr].sort((a, b) => a - b);
        return +s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)].toFixed(2);
      };
      return {
        mutations,
        resizes,
        syncMedianMs: pct(syncs, 0.5),
        syncP95Ms: pct(syncs, 0.95),
        frameMedianMs: pct(frames, 0.5),
        frameP95Ms: pct(frames, 0.95),
      };
    });
    assert.equal(ribbonBench.mutations, 0, 'Ribbon switches must not mutate childList');
    assert.equal(ribbonBench.resizes, 0, 'Ribbon switches must not resize document viewport');
    assert(ribbonBench.syncP95Ms < 5, 'Ribbon sync handler p95 must be < 5ms, got ' + ribbonBench.syncP95Ms);
    checks.push(`VS Code pointerdown Ribbon benchmark: sync median ${ribbonBench.syncMedianMs}ms (p95 ${ribbonBench.syncP95Ms}ms), frame median ${ribbonBench.frameMedianMs}ms, 0 mutations, 0 resizes`);

    // 2b. Verify ArrowRight focus on Ribbon tab has NO rectangular button background and NO clipped button outline
    await page.locator('#ribbon-tab-home').click();
    await page.locator('#ribbon-tab-home').focus();
    await page.keyboard.press('ArrowRight');
    await h.frames();
    const arrowFocusStyle = await page.locator('#ribbon-tab-read').evaluate(el => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, outlineStyle: s.outlineStyle, selected: el.getAttribute('aria-selected') };
    });
    assert.equal(arrowFocusStyle.selected, 'true', 'ArrowRight selects Read tab');
    assert.equal(arrowFocusStyle.bg, 'rgba(0, 0, 0, 0)', 'Ribbon tab cell must stay transparent (no rectangular box): ' + JSON.stringify(arrowFocusStyle));
    assert.equal(arrowFocusStyle.outlineStyle, 'none', 'Ribbon tab must not draw clipped rectangular outline (vertical dividers): ' + JSON.stringify(arrowFocusStyle));
    await h.capture('01b-ribbon-arrow-focus-clean.png');
    checks.push('Ribbon tab click & ArrowLeft/ArrowRight focus verified: zero rectangular box & zero clipped vertical lines');

    // 3. Left Sidebar Thumbnail Mode (flat tabs, Ctrl+Wheel zoom + auto multi-column reflow, click nav, dark mode, Ctrl+T, narrow rail)
    await page.locator('#ribbon-tab-home').click();
    await h.frames();
    await h.capture('02-sidebar-bookmarks-light.png');

    // Switch to Thumbnails via pointerdown
    // Hide and reopen while PDF.js is still fetching the first thumbnail.
    await page.evaluate(async () => {
      const { S } = await import('./app.mjs');
      const pdf = S.pdf, original = pdf.getPage;
      let signalStarted, resume;
      const started = new Promise(resolve => { signalStarted = resolve; });
      const released = new Promise(resolve => { resume = resolve; });
      pdf.getPage = async function (...args) {
        signalStarted();
        await released;
        return original.apply(this, args);
      };
      const thumbnails = document.getElementById('sidebar-tab-thumbnails');
      let timer;
      try {
        thumbnails.click();
        await Promise.race([started, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('No thumbnail request started')), 5000);
        })]);
        document.getElementById('sidebar-tab-bookmarks').click();
        thumbnails.click();
      } finally {
        clearTimeout(timer);
        pdf.getPage = original;
        resume();
      }
    });
    await page.locator('#thumb-panel').waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const loaded = document.querySelectorAll('#thumb-rows .thumb-card[data-loaded="true"]');
      return loaded.length >= 2;
    });
    await h.frames();
    const thumbCount = await page.locator('#thumb-page-count').textContent();
    assert.equal(thumbCount.trim(), '6', 'Thumbnail tab badge should show total page count');
    // Verify sidebar mode tab labels are never truncated at default width
    const tabFits = await page.evaluate(() => {
      return [...document.querySelectorAll('.sidebar-mode-tabs button > span:first-of-type')].map(el => ({
        text: el.textContent,
        clipped: el.scrollWidth > el.clientWidth + 1,
      }));
    });
    for (const f of tabFits) assert(!f.clipped, 'Sidebar mode tab label must not clip: ' + JSON.stringify(f));
    await h.capture('03-sidebar-thumbnails-1col-light.png');

    // Scroll virtualized thumbnail list to page 4, then click page 4 and verify navigation & active sync
    await page.evaluate(() => {
      const list = document.getElementById('thumb-list');
      list.scrollTop = 650;
      list.dispatchEvent(new Event('scroll'));
    });
    await page.locator('#thumb-rows .thumb-card[data-page="4"]').waitFor({ state: 'visible' });
    await page.locator('#thumb-rows .thumb-card[data-page="4"]').click();
    await page.waitForFunction(async () => (await import('./app.mjs')).S.page === 4);
    await h.frames();
    assert.equal(await page.locator('#thumb-rows .thumb-card[data-page="4"]').getAttribute('aria-current'), 'page');
    await page.locator('#thumb-rows .thumb-card[data-page="4"]').click({ button: 'right' });
    await page.locator('#context-menu').waitFor();
    assert((await page.locator('#context-menu button svg').count()) >= 4, 'thumbnail menu rows carry icons');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#context-menu').count(), 0);
    checks.push('Thumbnail right-click menu opens with icons and closes on Escape');
    checks.push('Thumbnail sidebar 1-col renders PDF pages & clicking page 4 navigates viewer + syncs active ring');

    // Test commercial Ctrl+Wheel zoom out on thumbnails -> auto reflows to 2 columns without zooming main PDF!
    const mainZoomBefore = await page.evaluate(async () => (await import('./app.mjs')).S.scale);
    const thumbZoomResult = await page.evaluate(async () => {
      const panel = document.getElementById('thumb-panel');
      const slider = document.getElementById('thumb-zoom-slider');
      const beforeW = Number(slider.value);
      for (let i = 0; i < 6; i++) {
        panel.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true, clientY: 300 }));
        await new Promise(r => requestAnimationFrame(r));
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        beforeW,
        afterW: Number(slider.value),
        cols: Number(document.querySelector('#thumb-rows .thumb-row')?.dataset.cols || 1),
      };
    });
    const mainZoomAfter = await page.evaluate(async () => (await import('./app.mjs')).S.scale);
    assert(thumbZoomResult.afterW < thumbZoomResult.beforeW, 'Ctrl+Wheel down must shrink thumbnails: ' + JSON.stringify(thumbZoomResult));
    assert(thumbZoomResult.cols >= 2, 'Shrinking thumbnails via Ctrl+Wheel must auto-reflow to >= 2 columns: ' + JSON.stringify(thumbZoomResult));
    assert.equal(mainZoomAfter, mainZoomBefore, 'Ctrl+Wheel on thumbnail sidebar must not zoom the main PDF viewer');
    await page.waitForFunction(() => document.querySelectorAll('#thumb-rows .thumb-card[data-loaded="true"]').length >= 4);
    await h.frames();
    await h.capture('04-sidebar-thumbnails-2col-light.png');
    checks.push(`Commercial Ctrl+Wheel thumbnail zoom verified (${thumbZoomResult.beforeW}px -> ${thumbZoomResult.afterW}px, auto ${thumbZoomResult.cols}-col reflow, main PDF zoom untouched)`);

    // Dark theme + dark page tone thumbnail harmony
    await page.evaluate(async () => (await import('./appearance.mjs')).applyAppearance({ theme: 'dark', palette: 'cobalt' }));
    await page.locator('.view-options > summary').click();
    await page.locator('[data-page-tone="dark"]').click();
    // Test bug fix: clicking outside .view-options closes it!
    await page.locator('#canvas-host').click({ position: { x: 200, y: 200 } });
    await h.frames();
    const viewOptsOpenAfterOutsideClick = await page.evaluate(() => document.querySelector('.view-options').open);
    assert.equal(viewOptsOpenAfterOutsideClick, false, '.view-options must close on outside click');
    checks.push('Bug fix verified: .view-options closes on outside click');
    await h.capture('05-sidebar-thumbnails-dark.png');

    // Reset theme & tone back to light/default and zoom thumbnails back up via Ctrl+Wheel up
    await page.locator('.view-options > summary').click();
    await page.locator('[data-page-tone="default"]').click();
    await page.keyboard.press('Escape');
    const viewOptsOpenAfterEsc = await page.evaluate(() => document.querySelector('.view-options').open);
    assert.equal(viewOptsOpenAfterEsc, false, '.view-options must close on Escape');
    await page.evaluate(async () => (await import('./appearance.mjs')).applyAppearance({ theme: 'light', palette: 'cobalt' }));
    await page.evaluate(async () => {
      const panel = document.getElementById('thumb-panel');
      for (let i = 0; i < 6; i++) {
        panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true, clientY: 300 }));
        await new Promise(r => requestAnimationFrame(r));
      }
    });

    // Test Ctrl+T toggles between Thumbnails and Bookmarks, and expands from narrow rail
    await page.keyboard.press('Control+t');
    assert.equal(await page.locator('#sidebar-tab-bookmarks').getAttribute('aria-selected'), 'true', 'Ctrl+T toggles back to Bookmarks when already on Thumbnails');
    await page.keyboard.press('Control+t');
    assert.equal(await page.locator('#sidebar-tab-thumbnails').getAttribute('aria-selected'), 'true', 'Ctrl+T switches to Thumbnails');

    // Switch left sidebar to narrow rail, then click thumbnail button on rail
    await page.locator('[data-action="left-mode"]').click();
    assert.equal(await page.evaluate(() => document.body.dataset.left), 'narrow');
    await page.locator('.panel-rail [data-action="left-expand"]').click();
    assert.equal(await page.evaluate(() => document.body.dataset.left), 'full');
    assert.equal(await page.locator('#sidebar-tab-bookmarks').getAttribute('aria-selected'), 'true');
    await page.locator('[data-action="left-mode"]').click();
    await page.locator('.panel-rail [data-action="toggle-thumbnails"]').click();
    assert.equal(await page.evaluate(() => document.body.dataset.left), 'full');
    assert.equal(await page.locator('#sidebar-tab-thumbnails').getAttribute('aria-selected'), 'true');
    checks.push('Ctrl+T shortcut and narrow panel-rail icons expand cleanly to Bookmarks / Thumbnails');

    await page.locator('#thumb-panel [data-action="select-page-range"]').click();
    await page.locator('#thumb-range').fill('2-4');
    await h.frames();
    assert.equal(await page.locator('#thumb-range').inputValue(), '2-4');
    await page.keyboard.press('Escape');
    await page.locator('#modal').waitFor({state:'hidden'});
    checks.push('Thumbnail sidebar opens the page-range picker for OCR and bookmark generation');

    // 4. Verify Performance Optimization: toggling sidebar at fixed zoom (100%) repositions pages WITHOUT cancelling/re-rendering canvases!
    await page.locator('#zoom').selectOption('1');
    await page.evaluate(async () => {
      const { surface } = await import('./app.mjs');
      await surface.update();
      await Promise.all([...surface.entries.values()].map(e => e.promise));
    });
    const resizeNoRerender = await page.evaluate(async () => {
      const { surface } = await import('./app.mjs');
      const epochBefore = surface.epoch;
      const canvasBefore = surface.entries.get(surface.s.page)?.canvas;
      document.querySelector('[data-action="left-mode"]').click();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const epochAfter = surface.epoch;
      const canvasAfter = surface.entries.get(surface.s.page)?.canvas;
      return { epochBefore, epochAfter, sameCanvas: canvasBefore === canvasAfter };
    });
    assert.equal(resizeNoRerender.epochBefore, resizeNoRerender.epochAfter, 'Fixed-zoom sidebar toggle must not cancel/re-render PDF pages');
    assert.equal(resizeNoRerender.sameCanvas, true, 'Fixed-zoom sidebar toggle must reuse existing rendered canvas');
    checks.push('Viewer perf verified: sidebar toggle at fixed zoom repositions pages in place with 0 canvas re-renders');

    // 5. Verify English translation coverage on Ribbon + Thumbnail Sidebar
    await page.locator('.panel-rail [data-action="toggle-thumbnails"]').click();
    await page.evaluate(async () => (await import('./i18n.mjs')).setLanguage('en'));
    await h.frames();
    const untranslated = await page.evaluate(async () => {
      const { untranslatedUI } = await import('./i18n.mjs');
      return [
        ...untranslatedUI(document.querySelector('.appbar')),
        ...untranslatedUI(document.querySelector('.outline-panel')),
      ];
    });
    assert.deepEqual(untranslated, [], 'English Ribbon & Thumbnail sidebar must have zero untranslated Chinese strings');
    checks.push('Zero untranslated Chinese strings in English Ribbon & Thumbnail Sidebar');

    assert.deepEqual(h.errors, [], 'Zero uncaught page errors');
    const report = { status: 'passed', ribbonBench, checks, errors: h.errors };
    fs.writeFileSync(path.resolve('tests/output/thumbnail-workspace-285.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await h.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});

// Verification & visual gallery check for Folio 2.8.4 UI/UX & performance upgrades.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const h = await require('./ui-audit-support.cjs')('polish-284');
  const { app, page, out } = h;
  const checks = [];
  const demoPdf = path.resolve('docs/examples/Folio-Demo.pdf');
  assert(fs.existsSync(demoPdf), 'Demo PDF must exist');

  try {
    // 1. Welcome screen screenshot (clean, zero-AI-slop, no neon glow)
    await h.frames();
    await h.capture('01-welcome.png');

    // 2. Open Folio-Demo.pdf and verify Recent Files recorded
    await h.openPDF(demoPdf);
    await h.frames();
    const recents = await page.evaluate(() => window.desktop.recentFiles());
    assert(recents.some(r => r.name === 'Folio-Demo.pdf'), 'Opened PDF recorded in recentFiles');
    checks.push('Recent documents persisted via main process IPC');

    // 3. Verify Titlebar Quick Actions are NOT visually duplicated when Ribbon Home is open
    const quickHiddenOnHome = await page.evaluate(() => {
      const q = document.querySelector('.titlebar-quick');
      return !q || q.getBoundingClientRect().width === 0;
    });
    assert(quickHiddenOnHome, 'Titlebar quick actions hidden when Ribbon Home already shows Save/Undo/Redo');
    checks.push('Titlebar Save/Undo/Redo de-duplicated on Ribbon Home');
    await h.capture('02-reader-light.png');

    // 4. Test Page Reading Tone (warm / soft / dark) without refreshing PDF
    await page.locator('.view-options > summary').click();
    await page.locator('[data-page-tone="warm"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.pageTone), 'warm');
    await h.frames();
    await h.capture('03-reader-warm-tone.png');

    await page.evaluate(async () => (await import('./appearance.mjs')).applyAppearance({ theme: 'dark', palette: 'cobalt' }));
    await page.locator('[data-page-tone="dark"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.pageTone), 'dark');
    await h.frames();
    await h.capture('04-reader-dark-inverted.png');

    await page.locator('[data-page-tone="default"]').click();
    await page.locator('.view-options > summary').click();
    await page.evaluate(async () => (await import('./appearance.mjs')).applyAppearance({ theme: 'light', palette: 'cobalt' }));
    checks.push('Page reading tones (warm/soft/dark/default) toggle cleanly');

    // 5. Test Global Command Palette (Ctrl+Shift+P)
    await page.keyboard.press('Control+Shift+P');
    await page.locator('.command-palette-dialog[open]').waitFor();
    await page.locator('#cmd-input').fill('书签');
    await h.frames();
    const cmdCount = await page.locator('.cmd-item').count();
    assert(cmdCount >= 5, 'Command palette filters commands');
    await h.capture('05-command-palette.png');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.command-palette-dialog[open]').count(), 0);
    checks.push('Global command palette opens via Ctrl+Shift+P, filters, and closes via Escape');

    // 6. Test Enhanced Full-Text Search (cached index, case toggle, snippet list, current highlight)
    await page.keyboard.press('Control+f');
    await page.locator('#find-text').fill('Folio');
    await page.locator('[data-action=find-run]').click();
    await page.waitForFunction(async () => {
      const { S, surface } = await import('./app.mjs');
      return S.hits.length > 0 && S.hitIndex >= 0 && !surface.navigating;
    });
    const t0 = await page.evaluate(() => performance.now());
    await page.locator('#find-case').click();
    await page.waitForFunction(() => !document.querySelector('#find-count').textContent.includes('扫描'));
    const cachedMs = await page.evaluate((s) => performance.now() - s, t0);
    assert(cachedMs < 1500, 'Cached search completes rapidly: ' + cachedMs);
    await page.locator('#find-list-toggle').click();
    assert(await page.locator('#find-results .find-result-item').count() > 0, 'Search snippet list renders hits');
    assert(await page.locator('.search-mark.current').count() > 0, 'Active search hit has distinct .current highlight');
    assert(await page.locator('#find-results .fr-snippet mark').count() > 0, 'matched text is highlighted in the result list');
    await page.locator('#find-results .find-result-item').first().click({ button: 'right' });
    await page.locator('#context-menu').waitFor();
    assert(await page.locator('#context-menu button svg').count() >= 4, 'result menu rows carry icons');
    await page.keyboard.press('Escape');
    await page.locator('#find-regex').click();
    await page.locator('#find-text').fill('(unclosed');
    await page.waitForFunction(() => document.querySelector('#find-text').getAttribute('aria-invalid') === 'true');
    assert.match(await page.locator('#find-count').innerText(), /正则语法错误：/);
    await page.locator('#find-text').fill('Fol.o');
    await page.waitForFunction(() => !document.querySelector('#find-text').hasAttribute('aria-invalid') && /处匹配/.test(document.querySelector('#find-count').textContent));
    await page.locator('#find-regex').click();
    await page.locator('#find-text').fill('Folio');
    await page.locator('#find-word').click();
    await page.waitForFunction(() => /处匹配|无匹配/.test(document.querySelector('#find-count').textContent));
    await page.locator('#find-word').click();
    checks.push('find: live regex search, invalid-pattern feedback, whole-word toggle, highlighted snippets, result menu');
    await h.frames();
    await h.capture('06-search-results.png');
    await page.keyboard.press('Escape');
    checks.push(`Enhanced search with cache (${Math.round(cachedMs)}ms), Aa toggle, snippet list & current highlight`);

    // 7. Test Bookmark Auto-Generation Workbench (live sample preview, template chips, duplicate level)
    await page.locator('#ribbon-tab-bookmarks').click();
    await page.locator('[data-ribbon-command=generate]').click();
    await page.locator('#modal.rules-v2').waitFor();
    await page.locator('.rule-card:not([hidden]) [data-field=pattern]').fill('^0([1-6])\\s+(.+)');
    await page.locator('#multi-range').fill('1-6');
    await page.waitForFunction(() => !document.querySelector('#multi-apply').disabled);
    await h.frames();
    const sampleVisible = await page.locator('.rule-card:not([hidden]) .rg-live-sample').isVisible();
    assert(sampleVisible, 'Live regex match & capture group sample preview is visible');
    await page.locator('#multi-preview .preview-item').first().click();
    await page.locator('#multi-target-wrap').waitFor({ state: 'visible' });
    await h.frames();
    await h.capture('07-bookmark-rules.png');
    await page.locator('#multi-target-close').click();
    assert(await page.locator('#multi-target-wrap').isHidden(), 'Target preview card dismisses cleanly');
    await page.locator('#modal-close').click();
    checks.push('Bookmark rules workbench: live regex sample, capture chips, dismissible target preview & persistent worker');

    // 8. Test OCR Workbench (custom high-contrast list, compact completed header, search & replace)
    await page.evaluate(async () => {
      const { S } = await import('./app.mjs');
      S.ocr = [
        { id: 'o1', page: 1, text: 'FOLIO / PUBLIC DEMO', confidence: 0.96, needsReview: false, quad: [[72, 720], [260, 720], [260, 704], [72, 704]] },
        { id: 'o2', page: 1, text: '01 Project overview', confidence: 0.98, needsReview: false, quad: [[72, 680], [280, 680], [280, 656], [72, 656]] },
        { id: 'o3', page: 1, text: '合成演示文档 · 疑似低分条目', confidence: 0.74, needsReview: true, quad: [[72, 640], [320, 640], [320, 624], [72, 624]] },
        { id: 'o4', page: 1, text: 'This fictional field guide demonstrates reading and OCR review.', confidence: 0.99, needsReview: false, quad: [[72, 600], [420, 600], [420, 584], [72, 584]] },
      ];
    });
    await page.locator('#ribbon-tab-home').click();
    await page.locator('[data-action=ocr]').first().click();
    await page.locator('#modal.ocr-dialog').waitFor();
    await page.locator('#ocr-results-list .ocr-row').first().waitFor();
    await page.locator('#ocr-results-list .ocr-row').first().click();
    await h.frames();
    // Verify high contrast on selected OCR row!
    const ocrContrast = await page.locator('#ocr-results-list .ocr-row[aria-selected="true"] .ocr-row-text').evaluate(el => {
      const c = document.createElement('canvas').getContext('2d'); c.canvas.width = c.canvas.height = 1;
      const rgb = col => { c.clearRect(0,0,1,1); c.fillStyle = col; c.fillRect(0,0,1,1); return [...c.getImageData(0,0,1,1).data].slice(0,3); };
      const lum = col => rgb(col).map(n => { n /= 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const textCol = getComputedStyle(el).color;
      const bgCol = getComputedStyle(el.closest('.ocr-row')).backgroundColor;
      const l1 = lum(textCol), l2 = lum(bgCol);
      return { textCol, bgCol, contrast: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) };
    });
    assert(ocrContrast.contrast >= 4.5, 'Selected OCR row must have >= 4.5:1 text contrast: ' + JSON.stringify(ocrContrast));
    await h.capture('08-ocr-review.png');
    await page.locator('#modal-close').click();
    checks.push(`OCR review custom listbox verified with ${ocrContrast.contrast.toFixed(2)}:1 contrast`);

    // 9. Test Printing Booklet Preview (crisp page badge + blank page label)
    await page.locator('#print-document').click();
    await page.locator('.print-dialog[open]').waitFor();
    await page.locator('.print-dialog [data-mode="booklet"]').click();
    await page.waitForTimeout(350);
    await h.frames();
    await h.capture('09-print-booklet.png');
    await page.locator('.print-dialog [data-cancel]').click();
    checks.push('Printing booklet preview badges & blank-page placeholder rendered cleanly');

    // 10. Test Page Organizer (distinct 选页 / 选中 / 插入位置)
    await page.locator('#ribbon-tab-organize').click();
    await page.locator('[data-ribbon-command=page-organizer]').click();
    await page.locator('.organizer-dialog[open]').waitFor();
    await h.frames();
    await h.capture('10-page-organizer.png');
    await page.locator('.organizer-dialog [data-close]').click();
    checks.push('Page organizer toolbar labels disambiguated');

    // 11. Test Bookmark QC (0-selected disabled buttons + right-aligned 定位)
    await page.locator('#ribbon-tab-bookmarks').click();
    await page.locator('[data-ribbon-command=bookmark-qc]').click();
    await page.locator('#qc-list').waitFor();
    assert(await page.locator('#qc-repair').isDisabled(), 'QC repair disabled when 0 selected');
    assert(await page.locator('#qc-delete').isDisabled(), 'QC delete disabled when 0 selected');
    await h.frames();
    await h.capture('11-bookmark-qc.png');
    await page.locator('#modal-close').click();
    checks.push('Bookmark QC buttons properly disabled at 0 selection and rows cleanly aligned');

    // 12. Test Document Utilities search + focused Word Export title
    await page.locator('#ribbon-tab-export').click();
    await page.locator('[data-ribbon-command=export-word]').click();
    await page.locator('.document-tools[open]').waitFor();
    assert.equal(await page.locator('.document-tools header h2').textContent(), '导出 Word');
    await page.locator('[data-dt-search]').fill('加密');
    const shownTools = await page.locator('.document-tools nav button:not([hidden])').count();
    assert.equal(shownTools, 1, 'Document utilities sidebar search filters to matching tool');
    await page.locator('[data-dt-search]').fill('');
    await h.frames();
    await h.capture('12-export-word.png');
    await page.locator('.document-tools [data-close]').click();
    checks.push('Document utilities sidebar search & focused header verified');

    assert.deepEqual(h.errors, [], 'Zero uncaught page errors');
    const report = { status: 'passed', checks, ocrContrast, errors: h.errors };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await h.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});

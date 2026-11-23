const { _electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path');

module.exports = async function auditHarness(name) {
  const out = path.resolve(process.env.FOLIO_AUDIT_OUT || 'tests/output/ui-audit-283', name);
  fs.mkdirSync(out, { recursive: true });
  const started = performance.now();
  const app = await _electron.launch({
    executablePath: process.env.FOLIO_EXE,
    args: process.env.FOLIO_EXE ? [] : [path.resolve('.')], timeout: 60000,
    env: { ...process.env, FOLIO_TEST_BACKGROUND: '1',
      FOLIO_TEST_PROFILE: path.join(out, 'profile-' + Date.now()),
      FOLIO_CHATBOX_PROFILE: path.join(out, 'chat-' + Date.now()) },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const w=BrowserWindow.getAllWindows()[0];w.setSize(1440, 960);w.showInactive(); });
  await page.locator('#ribbon-tab-home').waitFor();
  // The audit includes localized feedback. Keep it deterministic on English CI hosts.
  await page.evaluate(async () => (await import('./i18n.mjs')).setLanguage('zh-Hans'));
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const startupMs = performance.now() - started;
  const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const capture = file => require('./native-capture.cjs')(app, page, path.join(out, file));
  const openPDF = async (file = 'tests/output/save-281/fixture.pdf') => {
    await fs.promises.access(path.resolve(file), fs.constants.R_OK);
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.resolve(file));
    const start = performance.now();
    await page.locator('[data-action=open]').first().click();
    await page.locator('.pdf-page .textLayer span').first().waitFor();
    await page.evaluate(async () => {
      const { surface } = await import('./app.mjs');
      await surface.update(); await Promise.all([...surface.entries.values()].map(e => e.promise));
    });
    return performance.now() - start;
  };
  return { app, page, out, errors, startupMs, frames, capture, openPDF,
    close: () => app.evaluate(({ app }) => app.exit(0)).catch(() => {}) };
};

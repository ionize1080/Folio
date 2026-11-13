// Real-frame timing of ribbon switches with a visible window (no background throttling).
const { _electron } = require("playwright"), path = require("node:path");
(async () => {
  const stamp = Date.now();
  const env = { ...process.env, FOLIO_TEST_PROFILE: path.resolve("tests/output/perf-profile-" + stamp), FOLIO_CHATBOX_PROFILE: path.resolve("tests/output/perf-chat-" + stamp) };
  delete env.FOLIO_TEST_BACKGROUND;
  const app = await _electron.launch({ executablePath: process.env.FOLIO_EXE, args: process.env.FOLIO_EXE ? [] : [path.resolve(".")], env, timeout: 60000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(30000);
  await page.locator("#ribbon-tab-photo").waitFor();
  try {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.show(); });
    await app.evaluate(({ dialog }, f) => (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })), path.resolve(process.env.TOUR_PDF));
    await page.locator("[data-action=open]").first().click();
    await page.waitForFunction(() => /\/ \d/.test(document.querySelector("#page-total")?.textContent || ""));
    await page.locator("#busy").waitFor({ state: "hidden" }).catch(() => {});
    await page.waitForTimeout(2500);
    const rows = await page.evaluate(async () => {
      const host = document.querySelector("#canvas-host"), w = { resize: 0, mut: 0 }; new ResizeObserver(() => w.resize++).observe(host); new MutationObserver(m => { w.mut += m.length; }).observe(host, { childList: true, subtree: true, attributes: true }); await new Promise(r => setTimeout(r, 1200)); w.resize = 0; w.mut = 0;
      const out = [], frame = () => new Promise(r => requestAnimationFrame(() => r(performance.now())));
      const longs = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => longs.push(Math.round(e.duration)))).observe({ type: "longtask" }); } catch {}
      for (const id of ["read", "home", "read", "home", "bookmarks", "home", "organize", "home"]) {
        await frame(); const t0 = performance.now();
        document.querySelector("#ribbon-tab-" + id).click();
        const t1 = performance.now(); const t2 = await frame(); const t3 = await frame();
        out.push({ resize: w.resize, mut: w.mut, id, js: +(t1 - t0).toFixed(1), firstFrame: +(t2 - t0).toFixed(1), secondFrame: +(t3 - t0).toFixed(1) });
        w.resize = 0; w.mut = 0; await new Promise(r => setTimeout(r, 400));
      }
      return { out, longs };
    });
    console.log(JSON.stringify(rows));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });

// Counts the work a ribbon tab switch triggers: resizes of the canvas host, DOM churn in the page area, long tasks.
const path = require("node:path");
(async () => {
  const { app, page } = await require("./creative-harness.cjs")(); page.setDefaultTimeout(20000);
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await app.evaluate(({ dialog }, f) => (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })), path.resolve(process.env.TOUR_PDF));
    await page.locator("[data-action=open]").first().click();
    await page.waitForFunction(() => /\/ \d/.test(document.querySelector("#page-total")?.textContent || ""));
    await page.locator("#busy").waitFor({ state: "hidden" }).catch(() => {});
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const host = document.querySelector("#canvas-host"), log = { resize: 0, hostMut: 0, longTasks: [], sizes: [] };
      new ResizeObserver(() => { log.resize++; log.sizes.push(host.clientHeight + "x" + host.clientWidth); }).observe(host);
      log.what = {}; new MutationObserver(m => { log.hostMut += m.length; for (const x of m) { const k = x.type + ":" + (x.target.id || x.target.className?.baseVal || x.target.className || x.target.nodeName) + (x.attributeName ? "@" + x.attributeName : ""); log.what[k] = (log.what[k] || 0) + 1; } }).observe(host, { childList: true, subtree: true, attributes: true });
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) log.longTasks.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: false }); } catch {}
      await new Promise(r => setTimeout(r, 300)); log.resize = 0; log.hostMut = 0; log.sizes = [];
      const rows = [];
      for (const id of ["read", "home", "read", "home"]) { log.what = {}; log.resize = 0;
        const h = document.querySelector(".appbar").offsetHeight;
        document.querySelector("#ribbon-tab-" + id).click();
        const t0 = performance.now(); document.body.offsetHeight; const layout = performance.now() - t0;
        await new Promise(r => setTimeout(r, 600));
        rows.push({ resize: log.resize, what: JSON.stringify(log.what), id, layoutMs: +layout.toFixed(1), appbar: h + "->" + document.querySelector(".appbar").offsetHeight });
      }
      return { rows, ...log };
    });
    console.log(JSON.stringify(r));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });

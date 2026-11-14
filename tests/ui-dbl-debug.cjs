const path = require("node:path");
(async () => {
  const { app, page } = await require("./creative-harness.cjs")(); page.setDefaultTimeout(20000);
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await app.evaluate(({ dialog }, f) => (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })), path.resolve(process.env.TOUR_PDF));
    await page.locator("[data-action=open]").first().click();
    await page.waitForFunction(() => /\/ \d/.test(document.querySelector("#page-total")?.textContent || ""));
    await page.locator("#busy").waitFor({ state: "hidden" }).catch(() => {});
    await page.evaluate(() => {
      window.__log = [];
      for (const t of ["click", "dblclick", "focusout"]) document.querySelector("#tree").addEventListener(t, e => window.__log.push(t + ":" + (e.target.className || e.target.tagName) + "@" + Math.round(performance.now() % 100000)), true);
    });
    const box = await page.locator(".tree-row .title").nth(1).boundingBox();
    await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
    for (const ms of [0, 60, 200, 600]) { await page.waitForTimeout(ms); console.log(ms, await page.locator("input.inline-name").count(), await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName)); }
    console.log(JSON.stringify(await page.evaluate(() => window.__log)));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });

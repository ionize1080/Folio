// Bookmark workbenches with real data: generate preview, TOC recognition, QC, inspector, tree.
const path = require("node:path"), fs = require("node:fs");
(async () => {
  const { app, page } = await require("./creative-harness.cjs")(); page.setDefaultTimeout(20000);
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
  const capture = require("./native-capture.cjs"), dark = !!process.env.TOUR_DARK, sfx = dark ? "dark" : "light";
  fs.mkdirSync("tests/output/bm", { recursive: true });
  const shot = async n => { if (dark) { await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1441, 900); w.setSize(1440, 900); }); } await page.waitForTimeout(700); await capture(app, page, `tests/output/bm/${n}-${sfx}.png`); console.log("ok", n); };
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const closeAll = () => page.evaluate(() => { document.querySelector("#modal[open] #modal-close")?.click(); document.querySelectorAll("dialog[open]").forEach(d => d.close()); });
  const openCmd = async cmd => { await closeAll(); await page.locator("#ribbon-tab-bookmarks").click(); await page.locator(`[data-ribbon-command="${cmd}"]`).first().click(); await page.waitForTimeout(600); };
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await page.evaluate(async dark => { (await import("./appearance.mjs")).applyAppearance({ theme: dark ? "dark" : "light", palette: "cobalt" }); }, dark);
    await app.evaluate(({ dialog }, f) => (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })), path.resolve(process.env.TOUR_PDF));
    await page.locator("[data-action=open]").first().click();
    await page.waitForFunction(() => /\/ \d/.test(document.querySelector("#page-total")?.textContent || ""));
    await page.locator("#busy").waitFor({ state: "hidden" }).catch(() => {});
    if (dark) await page.evaluate(async () => { (await import("./appearance.mjs")).applyAppearance({ theme: "dark", palette: "cobalt" }); });

    console.log("computed:", await page.evaluate(() => { const c = getComputedStyle(document.body); const a = getComputedStyle(document.querySelector(".appbar")); return JSON.stringify({bg: c.backgroundColor, color: c.color, text: c.getPropertyValue("--text"), appbar: a.backgroundColor, cs: c.colorScheme}); }));
    console.log("body class:", await page.evaluate(() => document.body.className + " | bg " + getComputedStyle(document.body).getPropertyValue("--bg") + " | panel " + getComputedStyle(document.body).getPropertyValue("--panel")));
    // tree + inspector
    await page.locator(".tree-row").nth(2).click(); await page.evaluate(() => document.querySelector("[data-action=right-expand]")?.click());
    await shot("tree-inspector");

    // generate with preview
    await openCmd("generate");
    const probe = await page.evaluate(() => { const i = document.querySelector('[data-field="level"]'); const c = getComputedStyle(i); return { value: i.value, w: c.width, color: c.color, fs: c.fontSize, display: c.display, h: c.height }; });
    console.log("level input", JSON.stringify(probe));
    await shot("generate-idle");
    await page.locator("#multi-run").click().catch(() => {}); await page.waitForTimeout(2500); await shot("generate-preview");

    // smart toc recognition
    await openCmd("smart-toc");
    await page.locator("#st-start").click(); await page.waitForTimeout(6000); await shot("smart-toc-run");

    // QC, batch, calibrate, whitespace, every, exchange
    for (const [cmd, n] of [["bookmark-qc", "qc"], ["batch", "batch"], ["calibrate", "calibrate"], ["whitespace", "whitespace"], ["bookmark-every", "every"], ["exchange", "exchange"]]) { await openCmd(cmd); await shot(n); }
    // batch: switch to another operation card
    await openCmd("batch"); await page.locator('.choice-cards button[role=radio]').nth(2).click(); await shot("batch-op2");
  } finally { console.log("page errors:", JSON.stringify(errors)); await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });

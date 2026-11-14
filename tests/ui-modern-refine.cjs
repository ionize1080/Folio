// Captures the 2026-11 refinement items: tabs, ribbon hit area, preferences + colour picker,
// splitter, context menus, organizer apply button.
const path = require("node:path"), fs = require("node:fs");
(async () => {
  const { app, page } = await require("./creative-harness.cjs")();
  page.setDefaultTimeout(15000);
  const capture = require("./native-capture.cjs"), dark = !!process.env.TOUR_DARK, sfx = dark ? "dark" : "light";
  fs.mkdirSync("tests/output/refine", { recursive: true });
  const shot = async n => { await page.waitForTimeout(450); await capture(app, page, `tests/output/refine/${n}-${sfx}.png`); console.log("ok", n); };
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await page.evaluate(async dark => { (await import("./appearance.mjs")).applyAppearance({ theme: dark ? "dark" : "light", palette: "cobalt" }); }, dark);
    await app.evaluate(({ dialog }, file) => (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })), path.resolve(process.env.TOUR_PDF || "tests/output/workflow-250-source.pdf"));
    await page.locator("[data-action=open]").first().click();
    await page.waitForFunction(() => /\/ \d/.test(document.querySelector("#page-total")?.textContent || ""));
    await page.locator("#busy").waitFor({ state: "hidden" }).catch(() => {});

    // Ribbon: corner hit area and switch latency.
    const tab = page.locator("#ribbon-tab-bookmarks"), box = await tab.boundingBox();
    await page.mouse.move(box.x + 2, box.y + box.height - 2);
    await shot("ribbon-corner-hover");
    const timing = await page.evaluate(async () => {
      const ids = ["bookmarks", "organize", "export", "edit", "home"], out = [];
      for (let round = 0; round < 3; round++) for (const id of ids) {
        const t = performance.now(); document.querySelector("#ribbon-tab-" + id).click(); void document.body.offsetHeight;
        out.push(performance.now() - t);
      }
      return { max: Math.max(...out), avg: out.reduce((a, b) => a + b) / out.length };
    });
    console.log("ribbon switch ms", JSON.stringify(timing));
    await page.locator("#ribbon-tab-home").click();

    // Splitter hover.
    const handle = page.locator(".panel-resizer.left"); const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await shot("splitter-hover");

    // Context menu.
    await page.locator(".tree-row").first().click({ button: "right" }); await shot("context-bookmark"); await page.keyboard.press("Escape");
    await page.locator("#canvas-host").click({ button: "right", position: { x: 300, y: 300 } }); await shot("context-page"); await page.keyboard.press("Escape");

    // Preferences + picker.
    await page.evaluate(() => document.querySelector("[data-action=settings]")?.click());
    await page.waitForSelector("#set-selection-color"); await shot("prefs-top");
    await page.locator("#set-selection-color").click(); await page.waitForSelector(".cp-pop"); await shot("picker");
    await page.locator(".cp-pop .cp-grid .cp-swatch").nth(6).click();
    console.log("selection value", await page.locator("#set-selection-color").inputValue());
    await page.locator("#set-target-color").scrollIntoViewIfNeeded(); await shot("prefs-bottom");
    await page.keyboard.press("Escape"); await page.evaluate(() => document.querySelector("#modal-close,[data-close]")?.click());

    // Organizer.
    await page.locator("#ribbon-tab-organize").click();
    await page.locator('[data-ribbon-command="page-organizer"]').first().click();
    await page.waitForSelector(".organizer-dialog [data-apply]"); await shot("organizer");
    await page.locator('.organizer-dialog [data-org=rotate]').click();
    await page.locator(".organizer-dialog [data-apply]").click();
    await page.waitForFunction(() => !document.querySelector(".organizer-dialog"), null, { timeout: 30000 });
    await page.waitForTimeout(800);
    console.log("dirty after apply:", await page.evaluate(() => document.querySelector("#dirty-dot")?.className));
    await shot("after-apply");
  } finally { console.log("page errors:", JSON.stringify(errors)); await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });

// Round 3 checks: dblclick rename, selection colour, drag label cleanup, picker bounds, prefs layout, switch timing.
const path = require("node:path"), fs = require("node:fs");
(async () => {
  const { app, page } = await require("./creative-harness.cjs")(); page.setDefaultTimeout(20000);
  const capture = require("./native-capture.cjs"); await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
  fs.mkdirSync("tests/output/r3", { recursive: true });
  const shot = async n => { await page.waitForTimeout(500); await capture(app, page, `tests/output/r3/${n}.png`); console.log("shot", n); };
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await app.evaluate(({ dialog }, f) => (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })), path.resolve(process.env.TOUR_PDF));
    await page.locator("[data-action=open]").first().click();
    await page.waitForFunction(() => /\/ \d/.test(document.querySelector("#page-total")?.textContent || ""));
    await page.locator("#busy").waitFor({ state: "hidden" }).catch(() => {});

    // 1. double-click rename
    await page.locator(".tree-row .title").nth(1).dblclick();
    await page.waitForTimeout(300);
    console.log("inline rename input:", await page.locator("input.inline-name").count());
    await page.keyboard.press("Escape");

    // 2. selection colour reaches the overlay
    const sel = await page.evaluate(async () => {
      document.documentElement.style.setProperty("--text-selection", "#ff0000");
      const o = document.createElementNS("http://www.w3.org/2000/svg", "svg"); o.classList.add("text-selection-overlay");
      const host = document.querySelector(".pdf-page") || document.body; host.append(o);
      const fill = getComputedStyle(o).fill; o.remove(); return fill;
    });
    console.log("overlay fill (expect red):", sel);

    // 3. tab switch cost
    const t = await page.evaluate(async () => {
      const out = [];
      for (const id of ["read", "home", "read", "home", "edit", "home"]) {
        const a = performance.now(); document.querySelector("#ribbon-tab-" + id).click();
        const sync = performance.now() - a;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        out.push([id, +sync.toFixed(1), +(performance.now() - a).toFixed(1)]);
      }
      return out;
    });
    console.log("switch [tab, sync ms, to 2nd frame ms]:", JSON.stringify(t));

    // 4. preferences
    await page.evaluate(() => document.querySelector("[data-action=settings]")?.click());
    await page.waitForSelector(".prefs-nav"); await shot("prefs-general");
    await page.locator('[data-pref-nav="bookmarks"]').click(); await page.waitForTimeout(700);
    console.log("nav current after click:", await page.evaluate(() => document.querySelector('[data-pref-nav][aria-current=true]')?.dataset.prefNav));
    await shot("prefs-bookmarks");
    await page.evaluate(() => { const p = document.querySelector(".prefs-scroll"); p.scrollTop = p.scrollHeight; }); await page.waitForTimeout(400);
    console.log("nav current at bottom:", await page.evaluate(() => document.querySelector('[data-pref-nav][aria-current=true]')?.dataset.prefNav));
    // picker bounds inside dialog
    await page.evaluate(() => { const p = document.querySelector(".prefs-scroll"); p.scrollTop = 0; }); await page.waitForTimeout(200);
    await page.locator("#set-selection-color").click(); await page.waitForSelector(".cp-pop");
    const b = await page.evaluate(() => { const r = document.querySelector(".cp-pop").getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight, width: r.width }; });
    console.log("picker rect:", JSON.stringify(b)); await shot("prefs-picker");
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await page.evaluate(() => document.querySelector("#modal-close")?.click());

    // 5. picker in inspector
    await page.locator(".tree-row").nth(1).click(); await page.evaluate(() => document.querySelector("[data-action=right-expand]")?.click()); await page.waitForTimeout(400);
    await page.locator("#prop-color").click(); await page.waitForSelector(".cp-pop");
    const c = await page.evaluate(() => { const r = document.querySelector(".cp-pop").getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight }; });
    console.log("inspector picker rect:", JSON.stringify(c)); await shot("inspector-picker");
  } finally { console.log("page errors:", JSON.stringify(errors)); await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });

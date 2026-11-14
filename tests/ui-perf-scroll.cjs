// Frame pacing while scrolling pages, scrolling the bookmark tree, and dragging the splitter (visible window).
const { _electron } = require("playwright"), path = require("node:path");
(async () => {
  const stamp = Date.now();
  const env = { ...process.env, FOLIO_TEST_PROFILE: path.resolve("tests/output/perf-profile-" + stamp), FOLIO_CHATBOX_PROFILE: path.resolve("tests/output/perf-chat-" + stamp) };
  delete env.FOLIO_TEST_BACKGROUND;
  const app = await _electron.launch({ executablePath: process.env.FOLIO_EXE, args: process.env.FOLIO_EXE ? [] : [path.resolve(".")], env, timeout: 60000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(30000);
  await page.locator("#ribbon-tab-photo").waitFor();
  const probe = () => page.evaluate(() => { window.__f = []; let last = performance.now(); window.__run = true; const tick = t => { window.__f.push(t - last); last = t; if (window.__run) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const stats = label => page.evaluate(l => { window.__run = false; const f = window.__f.slice(2).sort((a, b) => a - b); const p = q => f[Math.min(f.length - 1, Math.floor(f.length * q))]; return `${l}: frames=${f.length} p50=${p(.5).toFixed(1)} p95=${p(.95).toFixed(1)} max=${f.at(-1).toFixed(1)} over33=${f.filter(x => x > 33).length}`; }, label);
  try {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.show(); });
    await app.evaluate(({ dialog }, f) => (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })), path.resolve(process.env.TOUR_PDF));
    await page.locator("[data-action=open]").first().click();
    await page.waitForFunction(() => /\/ \d/.test(document.querySelector("#page-total")?.textContent || ""));
    await page.locator("#busy").waitFor({ state: "hidden" }).catch(() => {});
    await page.waitForTimeout(2500);
    const host = await page.locator("#canvas-host").boundingBox();
    await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2);
    await probe();
    for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(16); }
    console.log(await stats("page wheel scroll"));
    const tree = await page.locator("#tree").boundingBox();
    await page.mouse.move(tree.x + 100, tree.y + 200); await probe();
    for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(16); }
    console.log(await stats("tree wheel scroll"));
    const h = await page.locator(".panel-resizer.left").boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + 300); await page.mouse.down(); await probe();
    for (let i = 0; i < 40; i++) { await page.mouse.move(h.x + 250 + (i % 20) * 6, h.y + 300); await page.waitForTimeout(16); }
    console.log(await stats("splitter drag")); await page.mouse.up();
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const h = await require("./ui-audit-support.cjs")("corners-and-tools");
  const { app, page } = h;
  const cases = [];
  const summary = page.locator(".more-tools > summary");
  const input = page.locator(".tool-library-search input");
  const inspect = () => input.evaluate(el => {
    const r = el.getBoundingClientRect(), menu = el.closest(".more-tools-menu").getBoundingClientRect();
    return {
      hit: [3, r.height / 2, r.height - 3].every(y =>
        [6, r.width / 2, r.width - 6].every(x => document.elementFromPoint(r.left + x, r.top + y) === el)),
      inside: menu.left >= 0 && menu.right <= innerWidth + 1 && menu.bottom <= innerHeight + 1,
      top: r.top,
    };
  });
  try {
    for (const [width, height, zoom, category, lang] of [
      [1440, 960, 1, "home", "en"],
      [1280, 720, 1.25, "edit", "zh-Hans"],
      [1080, 720, 1, "bookmarks", "zh-Hant"],
    ]) {
      await app.evaluate(({ BrowserWindow }, [w, h, z]) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setContentSize(w, h); win.webContents.setZoomFactor(z);
      }, [width, height, zoom]);
      await page.evaluate(async lang => (await import("./i18n.mjs")).setLanguage(lang), lang);
      await page.locator("#ribbon-tab-" + category).click();
      await summary.click();
      await input.waitFor();
      await h.frames();
      const initial = await inspect();
      assert(initial.hit && initial.inside, JSON.stringify({ width, category, initial }));
      await page.locator(".tool-library-grid").evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
      const after = await inspect();
      assert(after.hit && Math.abs(after.top - initial.top) < 1, "Search must remain visible during grid scrolling");
      await input.fill("xxxx-no-such-tool");
      assert(await page.locator(".tool-library-empty").isVisible());
      await input.fill("");
      if (category === "edit") await h.capture("more-tools-search.png");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".more-tools").getAttribute("open"), null);
      cases.push({ width, height, zoom, category, lang });
    }
    await page.keyboard.press("Control+F1");
    await page.keyboard.press("Control+Shift+k");
    await input.waitFor();
    assert((await inspect()).hit);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+F1");
    await page.evaluate(async () => (await import("./i18n.mjs")).setLanguage("zh-Hans"));
    const settings = page.locator('[data-action="settings"]');
    const slider = page.locator("#set-corner-radius");
    const radius = () => page.locator(".more-tools summary").evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    const shape = await summary.evaluate(el => getComputedStyle(el).cornerTopLeftShape);
    assert.match(shape, /superellipse\(1\.5849/);
    const gain = (1 - 2 ** (-.5)) / (1 - 2 ** (-1 / 3));
    assert(Math.abs(await radius() - 8 * gain) < .02, "Default 45-degree inset");
    await settings.click();
    await slider.focus(); await page.keyboard.press("Home");
    assert.equal(await radius(), 0);
    await page.locator("#modal-close").click();
    assert(Math.abs(await radius() - 8 * gain) < .02, "Cancel restores committed geometry");
    await settings.click();
    await slider.focus(); await page.keyboard.press("End");
    assert.equal(await slider.inputValue(), "16");
    assert.equal((await page.locator("#corner-radius-value").innerText()).trim(), "16 px");
    await page.locator("#modal-footer .primary").click();
    await page.locator("#modal").waitFor({ state: "hidden" });
    await page.reload(); await settings.waitFor(); await h.frames();
    assert(Math.abs(await radius() - 16 * gain) < .02, "Radius persists after reopening the renderer");
    await settings.click();
    assert.equal(await slider.inputValue(), "16");
    const swatch = page.locator(".cp-swatch").first();
    assert.equal(await swatch.evaluate(el => getComputedStyle(el).cornerTopLeftShape), "round");
    await h.capture("corner-preferences.png");
    assert.deepEqual(h.errors, []);
    fs.writeFileSync(path.resolve("tests/output/corners-tools-286.json"), JSON.stringify({ status: "passed", cases, shape, gain, errors: h.errors }));
    console.log("PASS More Tools hit testing, scroll, localization, zoom, corners and persistence");
  } finally { await h.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

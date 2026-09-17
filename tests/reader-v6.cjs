const { chromium } = require(
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright",
  ),
  fs = require("fs"),
  http = require("http"),
  path = require("path"),
  assert = require("assert/strict");
(async () => {
  const root = path.resolve(__dirname, ".."),
    errors = [],
    checks = [];
  let browser, page;
  const shim = `for(const T of [Map,WeakMap]){T.prototype.getOrInsertComputed??=function(k,fn){if(!this.has(k))this.set(k,fn(k));return this.get(k)};T.prototype.getOrInsert??=function(k,v){if(!this.has(k))this.set(k,v);return this.get(k)}};Uint8Array.prototype.toHex??=function(){return Array.from(this,x=>x.toString(16).padStart(2,'0')).join('')};`;
  const server = http.createServer((req, res) => {
    const f = path.resolve(
      root,
      "." +
        decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"),
    );
    res.setHeader(
      "Content-Type",
      {
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".html": "text/html",
        ".css": "text/css",
        ".ttf": "font/ttf",
        ".wasm": "application/wasm",
      }[path.extname(f)] || "application/octet-stream",
    );
    if (f.endsWith("pdf.worker.mjs"))
      res.end(shim + fs.readFileSync(f, "utf8"));
    else
      fs.createReadStream(f)
        .on("error", () => res.writeHead(404).end())
        .pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    browser = await chromium.launch({
      executablePath: process.env.FOLIO_BROWSER,
      headless: true,
      args: ["--no-sandbox"],
    });
    page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(shim);
    await page.addInitScript(() => {
      window.__copied = "";
      window.desktop = {
        setDirty() {},
        onClose() {},
        copyText: async (s) => {
          window.__copied = s;
        },
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/src/`);
    await page.addStyleTag({
      content:
        "@font-face{font-family:'Folio QA';src:url('/native/fonts/NotoSansSC.ttf')}body{font-family:'Folio QA',sans-serif}",
    });
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#file-input").setInputFiles(process.env.FOLIO_SAMPLE);
    await page.waitForFunction(
      () =>
        document.querySelector("#busy").hidden &&
        document.querySelectorAll('.pdf-page[data-ready="true"]').length > 0,
    );
    // Use actual module exports to navigate instead of depending on translated labels.
    await page.evaluate(async () => {
      const { surface } = await import("/src/app.mjs");
      await surface.go(15);
      await surface.zoom("1.42");
    });
    await page.waitForFunction(
      () => document.querySelector('.pdf-page[data-sharp="true"]') !== null,
    );
    const first = await page.evaluate(async () => {
      const { surface } = await import("/src/app.mjs");
      const e = surface.entries.get(15);
      return {
        ratio: e.ratio,
        basePixels: e.canvas.width * e.canvas.height,
        tiles: e.tiles.size,
      };
    });
    assert(first.basePixels <= 6010000);
    checks.push("High DPI page renders under per-page pixel budget");
    await page.evaluate(() => {
      const h = document.querySelector("#canvas-host");
      h.scrollTop += 450;
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const h = document.querySelector("#canvas-host");
      h.scrollTop -= 450;
    });
    await page.waitForTimeout(400);
    const kept = await page.evaluate(async () => {
      const { surface } = await import("/src/app.mjs");
      const e = surface.entries.get(15);
      return { ready: e?.shell.dataset.ready, tiles: e?.tiles.size };
    });
    assert.equal(kept.ready, "true");
    checks.push("Nearby scroll retains completed page");
    await page.evaluate(async () => {
      const { surface } = await import("/src/app.mjs");
      await surface.zoom("4");
    });
    await page.waitForFunction(async () => {
      const { surface } = await import("/src/app.mjs");
      return [...surface.entries.values()].some((e) =>
        [...e.tiles.values()].some((t) => t.ready),
      );
    });
    const tileKeys = await page.evaluate(async () => {
      const { surface } = await import("/src/app.mjs");
      return [...surface.entries.get(15).tiles.keys()];
    });
    await page.evaluate(
      () => (document.querySelector("#canvas-host").scrollTop += 220),
    );
    await page.waitForTimeout(250);
    await page.evaluate(
      () => (document.querySelector("#canvas-host").scrollTop -= 220),
    );
    await page.waitForTimeout(250);
    const restoredKeys = await page.evaluate(async () => {
      const { surface } = await import("/src/app.mjs");
      return [...surface.entries.get(15).tiles.keys()];
    });
    assert(tileKeys.some((k) => restoredKeys.includes(k)));
    checks.push(
      "400% tiled render retains completed tiles across nearby scroll",
    );
    await page.evaluate(async () => {
      const { surface } = await import("/src/app.mjs");
      await surface.zoom("1");
      await surface.go(11);
    });
    await page.waitForSelector("#page-shell .textLayer span");
    await page
      .locator("#page-shell .textLayer span")
      .first()
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const host = document.querySelector("#page-shell .textLayer"),
        range = document.createRange();
      range.selectNodeContents(host);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(range);
    });
    const selectedBox = await page
      .locator("#page-shell .textLayer span")
      .first()
      .boundingBox();
    await page.mouse.click(selectedBox.x + 2, selectedBox.y + 2, {
      button: "right",
    });
    await page.getByText("复制 Ctrl+C", { exact: true }).click();
    assert((await page.evaluate(() => window.__copied)).length > 30);
    checks.push("Right-click copies preserved text selection");
    await page.locator('[data-action="generate"]').first().click();
    await page.waitForSelector("#multi-current");
    await page.locator("#rule-default").click();
    await page.locator("#multi-current").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#multi-preview [data-preview]").length > 0,
    );
    const titles = await page.locator("#multi-preview").innerText();
    assert(titles.includes("农、林、牧、渔业"));
    assert(titles.includes("农作物种植业"));
    checks.push("Actual rules dialog generates complete industry names");
    await page.screenshot({ path: "tests/output/v6-rules-ui.png" });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "tests/output/v6-reader-report.json",
      JSON.stringify({ checks, errors, first, kept }, null, 2),
    );
    console.log("PASS", checks);
  } catch (e) {
    await page
      ?.screenshot({ path: "tests/output/v6-reader-failure.png" })
      .catch(() => {});
    throw e;
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

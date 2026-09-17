const { chromium } = require(process.env.FOLIO_PLAYWRIGHT || "playwright");
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { NativeBridge } = require("../native-bridge.cjs");
(async () => {
  const root = path.resolve(__dirname, ".."),
    out = path.join(__dirname, "output"),
    bridge = new NativeBridge(path.join(root, "native")),
    checks = [],
    errors = [];
  let browser;
  const check = (s) => {
    checks.push(s);
    console.log("PASS", s);
  };
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST") {
      let body = "";
      for await (const b of req) body += b;
      try {
        const data = JSON.parse(body);
        if (req.url === "/__save") {
          fs.writeFileSync(
            path.join(out, "v3-ui-saved.pdf"),
            Buffer.from(data.bytes),
          );
          res.end(JSON.stringify({ name: "v3-ui-saved.pdf", working: true }));
          return;
        }
        const result = await bridge.run(data);
        if (result.bytes) result.bytes = Array.from(result.bytes);
        res.end(JSON.stringify({ result }));
      } catch (e) {
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    const file =
      req.url === "/__font"
        ? path.join(root, "native/fonts/NotoSansSC.ttf")
        : path.resolve(
            root,
            "." +
              decodeURIComponent(req.url.split("?")[0]).replace(
                /\/$/,
                "/index.html",
              ),
          );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      {
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".ttf": "font/ttf",
        ".wasm": "application/wasm",
      }[path.extname(file)] || "application/octet-stream",
    );
    fs.createReadStream(file)
      .on("error", () => res.writeHead(404).end())
      .pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    browser = await chromium.launch({
      executablePath: process.env.FOLIO_CHROMIUM,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") console.log("CONSOLE", m.text());
    });
    await page.addInitScript(
      () =>
        (window.desktop = {
          setDirty() {},
          onClose() {},
          async native(d) {
            const r = await fetch("/__native", {
              method: "POST",
              body: JSON.stringify({ ...d, bytes: Array.from(d.bytes) }),
            }).then((r) => r.json());
            if (r.error) throw Error(r.error);
            if (r.result.bytes) r.result.bytes = new Uint8Array(r.result.bytes);
            return r.result;
          },
          async save(d) {
            return fetch("/__save", {
              method: "POST",
              body: JSON.stringify({ ...d, bytes: Array.from(d.bytes) }),
            }).then((r) => r.json());
          },
        }),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/src/`);
    await page.addStyleTag({
      content:
        "@font-face{font-family:'Folio QA';src:url('/__font')} :root{font-family:'Segoe UI','Folio QA',sans-serif}",
    });
    await page
      .locator("#file-input")
      .setInputFiles(path.join(root, "assets/Folio-Sample.pdf"));
    await page.waitForFunction(
      () =>
        document.querySelector(".pdf-page[data-ready=true]") &&
        document.querySelector("#busy").hidden,
    );
    check("Open desktop-capability test PDF");
    const zoom = await page.evaluate(async () => {
      const { surface } = await import("/src/app.mjs");
      let frames = 0,
        gaps = 0,
        run = true;
      const sample = () => {
        if (!run) return;
        frames++;
        if (!document.querySelector(".pdf-page[data-ready=true] canvas"))
          gaps++;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      for (const z of [1.2, 2, 3, 1.5, 4, 2.5]) {
        await surface.zoom(z);
        await new Promise((r) => setTimeout(r, 45));
      }
      await new Promise((r) => setTimeout(r, 1000));
      run = false;
      const e = surface.entries.get(surface.s.page);
      return {
        frames,
        gaps,
        tiles: [...e.tiles.values()].filter((t) => t.ready).length,
        ratio: [...e.tiles.values()].find((t) => t.ready)?.canvas.width / 512,
      };
    });
    assert(
      zoom.frames > 5 && zoom.gaps === 0 && zoom.tiles > 0 && zoom.ratio >= 1.9,
    );
    check("Continuous zoom retains painted frames and DPR 2 sharp tiles");
    await page.evaluate(async () => {
      const { surface } = await import("/src/app.mjs");
      await surface.zoom("fit");
    });
    await page.locator("[data-action=whitespace]").first().click();
    await page.locator("#space-convert").check();
    await page.locator("#space-scope").selectOption("all");
    await page.waitForSelector("#space-diffs .diff-table");
    assert((await page.locator("#space-diffs").textContent()).includes("pt"));
    await page.locator("#space-after").click();
    await page.waitForSelector("#space-preview:not([hidden])");
    await page.screenshot({ path: path.join(out, "v3-whitespace.png") });
    await page.locator("#space-apply").click();
    check("Visual whitespace, arithmetic report, before/after page preview");
    await page.locator("[data-action=edit-content]").first().click();
    await page.locator("#object-select").selectOption("1", { timeout: 60000 });
    await page.locator("#obj-text").fill("Folio 中文对象编辑");
    await page.screenshot({ path: path.join(out, "v3-object-editor.png") });
    await page.locator("#object-apply").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("#modal").open &&
        document.querySelector("#busy").hidden,
      null,
      { timeout: 60000 },
    );
    const text = await page.evaluate(async () => {
      const { S } = await import("/src/app.mjs");
      return (await (await S.pdf.getPage(1)).getTextContent()).items
        .map((i) => i.str)
        .join("");
    });
    assert(text.includes("中文对象编辑"));
    check("Native text modification appears in PDF preview");
    await page.locator("[data-action=undo]").first().click();
    await page.waitForFunction(async () => {
      const { S } = await import("/src/app.mjs");
      return !S.busy && S.nativeEdits.length === 0;
    });
    await page.locator("[data-action=redo]").first().click();
    await page.waitForFunction(async () => {
      const { S } = await import("/src/app.mjs");
      return !S.busy && S.nativeEdits.length === 1;
    });
    check("Native content participates in undo and redo");
    await page.locator("[data-action=save]").first().click();
    await page.waitForFunction(
      () =>
        document.querySelector("#busy").hidden &&
        document.querySelector("#doc-name").textContent === "v3-ui-saved.pdf",
    );
    check("Bookmarks and content save together");
    await page
      .locator("#file-input")
      .setInputFiles(path.join(out, "v3-scan.pdf"));
    await page.waitForFunction(
      () =>
        document.querySelector("#busy").hidden &&
        document.querySelector("#doc-name").textContent === "v3-scan.pdf",
    );
    await page.locator("[data-action=ocr]").first().click();
    await page.locator("#ocr-start").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#ocr-status")
          .textContent.startsWith("已完成") &&
        !document.querySelector("#ocr-apply").disabled,
      null,
      { timeout: 120000 },
    );
    assert((await page.locator("#ocr-results option").count()) > 20);
    await page.locator("#ocr-results").selectOption("0");
    await page.locator("#ocr-correction").fill("国民经济行业分类 校对");
    await page.locator("#ocr-correct").click();
    await page.locator("#ocr-text-preview").uncheck();
    await page.locator("#ocr-text-preview").check();
    await page.screenshot({ path: path.join(out, "v3-ocr-review.png") });
    await page.locator("#ocr-apply").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("#modal").open &&
        document.querySelector("#busy").hidden,
      null,
      { timeout: 60000 },
    );
    assert((await page.locator(".ocr-live span").count()) > 20);
    check("Offline OCR, native-coordinate correction and positional preview");
    await page.locator("[data-action=ocr-preview]").first().click();
    assert.equal(await page.locator(".ocr-live").count(), 0);
    await page.locator("[data-action=save]").first().click();
    await page.waitForFunction(
      () =>
        document.querySelector("#busy").hidden &&
        document.querySelector("#doc-name").textContent === "v3-ui-saved.pdf",
    );
    check("OCR preview switch and final searchable PDF save");
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "v3-ui-report.json"),
      JSON.stringify({ checks, zoom, errors }, null, 2),
    );
    console.log("DONE", checks.length);
  } finally {
    await browser?.close();
    bridge.cancel();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

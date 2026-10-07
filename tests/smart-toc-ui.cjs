// Browser integration using a real synthetic PDF, production extraction,
// matching worker, destination writer and renderer. No native-engine mocks.
const { chromium } = require(
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright"
    : "playwright",
);
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output");
fs.mkdirSync(out, { recursive: true });
let browser, server, page;
const errors = [],
  checks = [];
(async () => {
  server = http.createServer((req, res) => {
    const p = path.resolve(
      root,
      "src",
      "." +
        (decodeURIComponent(req.url.split("?")[0]) === "/"
          ? "/index.html"
          : decodeURIComponent(req.url.split("?")[0])),
    );
    if (!p.startsWith(path.join(root, "src") + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    try {
      let body = fs.readFileSync(p);
      if (path.basename(p) === "app.mjs")
        body = Buffer.concat([
          body,
          Buffer.from(
            "\nwindow.__qa={S,surface,commit,loadPDF,actions,closeModal,generateDialog,rpc};",
          ),
        ]);
      res.setHeader(
        "Content-Type",
        {
          ".mjs": "text/javascript",
          ".js": "text/javascript",
          ".html": "text/html",
          ".css": "text/css",
          ".wasm": "application/wasm",
        }[path.extname(p)] || "application/octet-stream",
      );
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.FOLIO_CHROMIUM || undefined,
    args: ["--no-sandbox"],
  });
  page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.__qa);

  page.setDefaultTimeout(30000);
  await page.evaluate(async () => {
    const { PDFDocument, StandardFonts, degrees } = await import(
      "./vendor/pdf-lib.js"
    );
    const doc = await PDFDocument.create(),
      font = await doc.embedFont(StandardFonts.Helvetica);
    for (let n = 1; n <= 8; n++) {
      const p = doc.addPage([600, 800]);
      const texts =
        n === 1
          ? [
              "Contents",
              "Alpha chapter .......... 2",
              "Beta chapter .......... 3",
              "Gamma chapter .......... 4",
            ]
          : n === 6
            ? ["Alpha chapter"]
            : n === 2
              ? ["Beta chapter"]
              : n === 5
                ? ["Gamma chapter"]
                : [];
      texts.forEach((text, i) =>
        p.drawText(text, { x: 60, y: 690 - i * 40, font, size: 16 }),
      );
    }
    await window.__qa.loadPDF(await doc.save(), "smart-toc-fixture.pdf");
    window.__original = JSON.stringify(window.__qa.S.nodes);
  });
  async function open() {
    await page.evaluate(() => window.__qa.actions["smart-toc"]());
    await page.waitForSelector("#st-range");
  }
  await open();
  await page.locator("#st-detect").click();
  await page.waitForFunction(
    () => !document.querySelector("#st-detect").disabled,
  );
  assert.equal(await page.locator("#st-pages-input").inputValue(), "1");
  await page.locator("#st-extract").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".st-row").length === 3,
  );
  assert(await page.locator("#st-apply").isDisabled());
  await page.locator("#st-resolve").click();
  await page.waitForFunction(
    () => !document.querySelector("#st-resolve").disabled,
  );
  assert.deepEqual(
    await page
      .locator("[data-field=page]")
      .evaluateAll((es) => es.map((e) => +e.value)),
    [6, 2, 5],
  );
  checks.push(
    "Real PDF.js extraction detects TOC and independently resolves incorrect printed numbers to 6,2,5",
  );
  await page.locator("[data-source]").first().click();
  await page.waitForSelector("#st-preview:not([hidden])");
  await page.screenshot({ path: path.join(out, "smart-toc-source.png") });
  await page.locator("[data-target]").first().click();
  await page.screenshot({ path: path.join(out, "smart-toc-target.png") });
  await page.locator("[data-field=title]").first().fill("Revised alpha");
  await page.locator("[data-field=title]").first().blur();
  assert.equal(
    await page.locator("[data-field=page]").first().inputValue(),
    "",
  );
  assert(!(await page.locator("[data-field=selected]").first().isChecked()));
  await page.locator("[data-field=page]").first().fill("6");
  await page.locator("[data-field=page]").first().blur();
  await page.locator("#st-apply").click();
  assert.deepEqual(
    await page.evaluate(() =>
      window.__qa.S.nodes.map((n) => [n.title, n.target.page]),
    ),
    [
      ["Revised alpha", 6],
      ["Beta chapter", 2],
      ["Gamma chapter", 5],
    ],
  );
  checks.push(
    "Editing title invalidates target, manual correction is explicit, selected bookmarks commit atomically",
  );
  await page.evaluate(async () => {
    const q = window.__qa,
      bytes = await q.rpc("save", {
        nodes: q.S.nodes,
        rotations: q.S.rotation,
        annotations: q.S.annotations,
        metadata: q.S.metadata,
      });
    window.__saved = bytes;
    await q.loadPDF(bytes, "saved-smart-toc.pdf");
  });
  assert.deepEqual(
    await page.evaluate(() => window.__qa.S.nodes.map((n) => n.target.page)),
    [6, 2, 5],
  );
  checks.push("Saved PDF reopens with the three exact physical destinations");
  await open();
  await page.locator("#st-add").click();
  await page.locator("[data-field=title]").fill("Manual title");
  await page.locator("[data-field=title]").blur();
  await page.locator("[data-field=page]").fill("999");
  await page.locator("[data-field=page]").blur();
  assert(await page.locator("#st-apply").isDisabled());
  await page.locator("[data-field=page]").fill("3");
  await page.locator("[data-field=page]").blur();
  assert(!(await page.locator("#st-apply").isDisabled()));
  await page.evaluate(() => window.__qa.commit([...window.__qa.S.nodes]));
  await page.locator("#st-apply").click();
  assert.equal(await page.evaluate(() => window.__qa.S.nodes.length), 3);
  await page.locator("#modal-close").click();
  checks.push(
    "Out-of-range manual pages and stale document revisions cannot be applied",
  );
  for (const language of ["en", "zh-Hans", "zh-Hant"]) {
    await page.locator("#language-select").selectOption(language);
    await open();
    await page.evaluate(async () => {
      (await import("./i18n.mjs")).localizeTree(document.body);
    });
    const missing = await page.evaluate(async () =>
      (await import("./i18n.mjs")).untranslatedUI(),
    );
    if (language === "en") assert.deepEqual(missing, [], language);
    assert.equal(
      await page.locator("#modal-title").innerText(),
      {
        en: "Smart table of contents",
        "zh-Hans": "智能目录识别",
        "zh-Hant": "智能目錄識別",
      }[language],
    );
    await page.screenshot({
      path: path.join(out, "smart-toc-" + language + ".png"),
    });
    await page.locator("#modal-close").click();
  }
  checks.push(
    "Smart TOC is translated in English, Simplified Chinese and Traditional Chinese",
  );
  await open();
  await page.evaluate(() => {
    document.querySelector("#st-detect").click();
    document.querySelector("#st-stop").click();
  });
  assert(await page.locator("#st-apply").isDisabled());
  assert.equal(await page.evaluate(() => window.__qa.S.nodes.length), 3);
  checks.push(
    "Cancellation leaves the document and existing bookmarks unchanged",
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(out, "smart-toc-ui-report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
})()
  .catch(async (e) => {
    console.error(e);
    if (page) {
      console.error(
        await page
          .locator("#st-status")
          .textContent()
          .catch(() => ""),
      );
      await page.screenshot({ path: path.join(out, "smart-toc-failure.png") });
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    server?.close();
  });

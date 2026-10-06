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
  await page.evaluate(async () => {
    const { PDFDocument, StandardFonts } = await import("./vendor/pdf-lib.js"),
      { makeNode } = await import("./model.mjs");
    const doc = await PDFDocument.create(),
      font = await doc.embedFont(StandardFonts.Helvetica);
    const texts = {
      1: [
        "Contents",
        "Alpha chapter .......... 2",
        "Beta chapter .......... 3",
        "Gamma chapter .......... 4",
      ],
      2: ["Beta chapter"],
      3: ["See Alpha chapter elsewhere in this volume"],
      5: ["Gamma chapter"],
      6: ["Alpha chapter"],
      7: ["Appendix overview"],
      8: ["Appendix overview"],
    };
    for (let i = 1; i <= 8; i++) {
      const p = doc.addPage([600, 800]);
      for (const [j, text] of (texts[i] || ["Unrelated body text"]).entries())
        p.drawText(text, { x: 50, y: 650 - j * 32, size: 18, font });
      p.drawText(String(i), { x: 300, y: 20, size: 10, font });
    }
    const bytes = await doc.save();
    await window.__qa.loadPDF(bytes, "calibration-fixture.pdf");
    const nodes = [
      makeNode("Alpha chapter", 2),
      makeNode("Beta chapter", 3),
      makeNode("Gamma chapter", 4),
      makeNode("Appendix overview", 1),
      makeNode("Missing chapter", 1),
    ];
    nodes[1].parent = nodes[0].id;
    nodes[1].bold = true;
    window.__qa.commit(nodes);
    window.__before = structuredClone(nodes);
  });
  async function open() {
    await page.evaluate(() => window.__qa.actions["calibrate-pages"]());
    await page.waitForSelector("#pc-range");
    await page.locator("#pc-exclude").fill("1");
  }
  async function scan() {
    await page.locator("#pc-run").click();
    await page.waitForFunction(
      () => !document.querySelector("#pc-high").disabled,
      { timeout: 45000 },
    );
  }
  await open();
  await scan();
  assert.equal(await page.locator(".pc-row").count(), 5);
  assert.equal(
    await page.locator(".pc-confidence[data-status=high]").count(),
    3,
  );
  assert.equal(
    await page.locator(".pc-confidence[data-status=ambiguous]").count(),
    1,
  );
  assert(await page.locator("#pc-apply").isDisabled());
  assert.match(await page.locator("#pc-status").innerText(), /Complete/);
  const alpha = page
    .locator(".pc-row")
    .filter({ hasText: "Alpha chapter" })
    .first();
  await alpha.locator("[data-choice]").selectOption("1");
  assert.equal(
    await alpha.locator(".pc-confidence").getAttribute("data-status"),
    "review",
  );
  await page.locator("#pc-clear").click();
  await page.locator("#pc-high").click();
  assert.equal(
    await page.locator("#pc-selected").innerText(),
    "Selected 3 / 5 entries",
  );
  await page.locator(".pc-row").first().locator("[data-after]").click();
  await page.waitForFunction(
    () => !document.querySelector("#pc-preview").hidden,
  );
  assert.match(await page.locator("#pc-preview-label").innerText(), /page 6/);
  await page.screenshot({
    path: path.join(out, "page-calibration-preview.png"),
  });
  const missing = page
    .locator(".pc-row")
    .filter({ hasText: "Missing chapter" });
  await missing.locator("[data-manual]").fill("7");
  await missing.locator("[data-use-manual]").click();
  await page.waitForFunction(() =>
    document.querySelector("#pc-selected").textContent.includes("4 / 5"),
  );
  await page.locator("#pc-apply").click();
  assert.deepEqual(
    await page.evaluate(() => window.__qa.S.nodes.map((n) => n.target.page)),
    [6, 2, 5, 1, 7],
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__qa.S.nodes[1].parent === window.__qa.S.nodes[0].id &&
        window.__qa.S.nodes[1].bold,
    ),
    true,
  );
  checks.push(
    "Real PDF extraction: offsets +4/-1/+1, ambiguous repeated heading retained, manual unmatched destination, hierarchy and styles preserved",
  );
  const saved = await page.evaluate(async () => {
    const { S, rpc } = window.__qa;
    const bytes = await rpc("save", {
      nodes: S.nodes,
      metadata: S.metadata,
      rotations: S.rotation,
      annotations: S.annotations,
    });
    const { PdfEngine } = await import("./pdf-core.mjs"),
      e = new PdfEngine(),
      info = await e.open(bytes);
    return {
      pages: info.nodes.map((n) => n.target.page),
      bytes: Array.from(bytes),
    };
  });
  assert.deepEqual(saved.pages, [6, 2, 5, 1, 7]);
  fs.writeFileSync(
    path.join(out, "page-calibration-saved.pdf"),
    Buffer.from(saved.bytes),
  );
  await page.evaluate(() => window.__qa.actions.undo());
  assert.deepEqual(
    await page.evaluate(() => window.__qa.S.nodes),
    await page.evaluate(() => window.__before),
  );
  checks.push(
    "Saved PDF reopened with exact destinations; one undo restores every original bookmark",
  );
  await open();
  await scan();
  await page.locator("#pc-high").click();
  await page.locator("#pc-range").fill("2-7");
  assert(await page.locator("#pc-apply").isDisabled());
  assert.equal(await page.locator(".pc-row").count(), 0);
  await scan();
  await page.locator("#pc-high").click();
  await page.evaluate(() => window.__qa.commit([...window.__qa.S.nodes]));
  await page.locator("#pc-apply").click();
  assert.match(
    await page.locator("#modal-error").innerText(),
    /document changed/i,
  );
  await page.locator("#modal-close").click();
  checks.push(
    "Changed settings invalidate preview; changed document rejects stale apply",
  );
  await open();
  // Start and cancel in the same event turn so this tiny cached fixture cannot
  // finish while Playwright waits for the moving dialog to become stable.
  await page.evaluate(() => {
    document.querySelector("#pc-run").click();
    const stop = document.querySelector("#pc-stop");
    if (stop.disabled)
      throw Error("Analysis did not enter a cancellable state");
    stop.click();
  });
  await page.waitForTimeout(250);
  assert(await page.locator("#pc-apply").isDisabled());
  assert.match(await page.locator("#pc-status").innerText(), /stopped/i);
  assert.deepEqual(
    await page.evaluate(() => window.__qa.S.nodes),
    await page.evaluate(() => window.__before),
  );
  await page.locator("#modal-close").click();
  checks.push("Cancel leaves document unchanged and disables apply");
  for (const locale of ["zh-Hans", "zh-Hant", "en"]) {
    await page.evaluate(
      async (l) => (await import("./i18n.mjs")).setLanguage(l),
      locale,
    );
    await open();
    const title = await page.locator("#modal-title").innerText();
    assert.equal(
      title,
      locale === "en"
        ? "Calibrate TOC page numbers"
        : locale === "zh-Hans"
          ? "逐条校准目录页码"
          : "逐條校準目錄頁碼",
    );
    await page.locator("#modal-close").click();
  }
  checks.push(
    "Calibration opens correctly in English, Simplified Chinese and Traditional Chinese",
  );
  // New TOC generation can be calibrated before it is committed.
  await page.evaluate(() => window.__qa.generateDialog());
  await page.locator("#gen-mode").selectOption("toc");
  await page
    .locator("#gen-toc")
    .fill("Alpha chapter ...... 2\nBeta chapter ...... 3");
  await page.locator("#gen-run").click();
  await page.waitForFunction(
    () => !document.querySelector("#gen-calibrate").disabled,
  );
  await page.locator("#gen-calibrate").click();
  await page.locator("#pc-exclude").fill("1");
  await scan();
  await page.locator("#pc-high").click();
  await page.locator("#pc-apply").click();
  assert.deepEqual(
    await page.evaluate(() =>
      window.__qa.S.nodes.slice(-2).map((n) => n.target.page),
    ),
    [6, 2],
  );
  checks.push(
    "TOC generation hands off its uncommitted preview for independent calibration",
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(out, "page-calibration-ui-report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
})()
  .catch(async (e) => {
    console.error(e);
    console.error("page errors", errors);
    if (page) {
      console.error(
        "status",
        await page
          .locator("#pc-status")
          .textContent()
          .catch(() => ""),
      );
      await page
        .screenshot({ path: path.join(out, "page-calibration-failure.png") })
        .catch(() => {});
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    server?.close();
  });

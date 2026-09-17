// Historical v0.1 UI regression. Current release uses tests/ui-v2.cjs.
// Optional end-to-end checks: npm i -D playwright && npx playwright install chromium
const { chromium } = require(process.env.FOLIO_PLAYWRIGHT || "playwright");
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const root = path.resolve(__dirname, ".."),
    out = path.join(__dirname, "output");
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    if (req.url === "/__qa-font" && process.env.FOLIO_QA_FONT) {
      res.setHeader("Content-Type", "font/woff2");
      fs.createReadStream(process.env.FOLIO_QA_FONT).pipe(res);
      return;
    }
    let rel = decodeURIComponent(req.url.split("?")[0]);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(root, "." + rel);
    if (!file.startsWith(root + path.sep)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      {
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".wasm": "application/wasm",
      }[path.extname(file)] || "application/octet-stream",
    );
    fs.createReadStream(file)
      .on("error", () => {
        res.statusCode = 404;
        res.end();
      })
      .pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  const errors = [],
    checks = [];
  try {
    browser = await chromium.launch({
      executablePath: process.env.FOLIO_CHROMIUM || undefined,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({
      viewport: { width: 1500, height: 950 },
      acceptDownloads: true,
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/src/`);
    if (process.env.FOLIO_QA_FONT) {
      await page.addStyleTag({
        content:
          "@font-face{font-family:'Folio QA CJK';src:url('/__qa-font')} :root{font-family:'Segoe UI','Microsoft YaHei UI','Folio QA CJK',sans-serif}",
      });
      await page.evaluate(() => document.fonts.ready);
    }
    await page.screenshot({ path: path.join(out, "welcome.png") });
    await page
      .locator("#file-input")
      .setInputFiles(path.join(root, "assets/Folio-Sample.pdf"));
    await page.waitForFunction(
      () =>
        document.querySelector("#node-count").textContent === "14" &&
        document.querySelector("#busy").hidden,
    );
    checks.push("Open PDF and parse 14 Chinese bookmarks");
    await page.locator("[data-action=expand]").click();
    assert.equal(await page.locator(".tree-row").count(), 14);
    await page.locator(".tree-row").first().click();
    await page.waitForFunction(() =>
      document.querySelector("#render-info").textContent.includes("ms"),
    );
    assert((await page.locator("#text-layer span").count()) > 0);
    checks.push("Canvas rendering and selectable text layer");
    await page.locator("#prop-title").fill("中文测试 · Edited");
    await page.locator("#prop-mode").selectOption("XYZ");
    await page.locator("#prop-page").fill("2");
    await page.locator(".coord").nth(0).fill("0");
    await page.locator(".coord").nth(1).fill("700");
    await page.locator("#properties button[type=submit]").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".tree-row .title").textContent ===
        "中文测试 · Edited",
    );
    checks.push("Edit Unicode title, explicit XYZ coordinates and page");
    await page.locator("[data-action=undo]").click();
    await page.waitForFunction(() =>
      document
        .querySelector(".tree-row .title")
        .textContent.includes("开始使用"),
    );
    await page.locator("[data-action=redo]").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".tree-row .title").textContent ===
        "中文测试 · Edited",
    );
    checks.push("Undo and redo complete edit");
    await page.locator("[data-action=batch]").click();
    await page.locator("#batch-op").selectOption("prefix");
    await page.locator("#b-prefix").fill("TEST ");
    await page.waitForFunction(
      () =>
        document.querySelector("#batch-apply") &&
        !document.querySelector("#batch-apply").disabled,
    );
    await page.screenshot({ path: path.join(out, "batch-preview.png") });
    await page.locator("#batch-apply").click();
    assert(
      (await page.locator(".tree-row .title").first().textContent()).startsWith(
        "TEST ",
      ),
    );
    checks.push("Automatic batch preview and transactional apply");
    await page.locator("[data-action=generate]").click();
    await page.locator("#gen-mode").selectOption("interval");
    await page.locator("#gen-to").fill("8");
    await page.locator("#gen-interval").fill("2");
    await page.locator("#gen-run").click();
    await page.waitForFunction(
      () => !document.querySelector("#gen-apply").disabled,
    );
    await page.locator("#gen-apply").click();
    assert.equal(await page.locator("#node-count").textContent(), "18");
    checks.push("Interval bookmark generation");
    await page.locator("[data-action=generate]").click();
    await page.locator("#gen-mode").selectOption("font");
    await page.locator("#gen-from").fill("1");
    await page.locator("#gen-to").fill("2");
    await page.locator("#gen-run").click();
    await page.waitForFunction(
      () => !document.querySelector("#gen-apply").disabled,
    );
    assert((await page.locator("#gen-preview .preview-item").count()) >= 2);
    await page.screenshot({ path: path.join(out, "generate-preview.png") });
    await page.locator("#modal-close").click();
    checks.push("Font-based headings scanned and previewed");
    await page.locator("[data-action=find]").click();
    await page.locator("#find-text").fill("Thoughtful");
    await page.locator("[data-action=find-run]").click();
    await page.waitForFunction(() =>
      document.querySelector("#find-count").textContent.includes("8 页"),
    );
    await page.locator(".search-mark").first().waitFor({state:"attached"});
    await page.locator("[data-action=find-close]").click();
    checks.push("Full-document text search and highlight");
    await page.locator("[data-action=annotate]").click();
    await page.locator("#anno-text").fill("测试批注");
    await page.locator("#modal-footer button").last().click();
    const box = await page.locator("#draw-layer").boundingBox();
    await page.mouse.move(box.x + 50, box.y + 70);
    await page.mouse.down();
    await page.mouse.move(box.x + 220, box.y + 95);
    await page.mouse.up();
    assert.equal(await page.locator(".annotation-mark").count(), 1);
    checks.push("Draw highlight annotation");
    const downloadPromise = page.waitForEvent("download");
    await page.locator("[data-action=save]").click();
    const download = await downloadPromise;
    await download.saveAs(path.join(out, "ui-saved.pdf"));
    await page.waitForFunction(() => document.querySelector("#busy").hidden);
    assert(
      !(await page
        .locator("#dirty-dot")
        .evaluate((e) => e.classList.contains("changed"))),
    );
    checks.push("Save actual edited PDF");
    await page.screenshot({ path: path.join(out, "workspace.png") });
    await page.locator('#zoom').selectOption('1.5');
    await page.waitForFunction(()=>document.querySelector('#render-info').textContent.startsWith('150%'));
    await page.locator('#canvas-host').evaluate(e=>e.scrollTop=300);
    await page.locator('[data-action=capture]').click();
    const capturedY=Number(await page.locator('.coord').nth(1).inputValue());
    assert(Math.abs(capturedY-(842-(300-28)/1.5))<0.02);
    checks.push('Current-view capture correctly excludes the 28 px page margin');
    await page.locator('#zoom').selectOption('fit');
    await page.waitForFunction(()=>!document.querySelector('#render-info').textContent.startsWith('150%'));
    await page.locator("[data-action=theme]").click();
    await page.screenshot({ path: path.join(out, "dark.png") });
    await page.locator("[data-action=theme]").click();
    checks.push("Light and dark theme switching");
    await page
      .locator("#file-input")
      .setInputFiles(path.join(out, "10000-bookmarks.pdf"));
    await page.waitForFunction(
      () =>
        document.querySelector("#node-count").textContent === "10,000" &&
        document.querySelector("#busy").hidden,
    );
    await page.locator("[data-action=expand]").click();
    const domRows = await page.locator(".tree-row").count();
    assert(domRows < 80);
    await page.locator("#filter").fill("9999");
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".tree-row .title")].some((e) =>
        e.textContent.includes("9999"),
      ),
    );
    checks.push(
      `10,000-bookmark virtual tree: ${domRows} DOM rows; filtering works`,
    );
    await page.locator("#clear-filter").click();
    await page.locator("[data-action=add]").click();
    await page
      .locator("#file-input")
      .setInputFiles(path.join(root, "assets/Folio-Sample.pdf"));
    await page.waitForSelector("#modal[open]");
    await page.locator("#modal-footer button").last().click();
    await page.waitForFunction(
      () => document.querySelector("#node-count").textContent === "14",
    );
    checks.push("Unsaved-change confirmation accepts explicit discard");
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "ui-report.json"),
      JSON.stringify(
        {
          checks,
          errors,
          platform: process.platform,
          browser: await browser.version(),
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2),
    );
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

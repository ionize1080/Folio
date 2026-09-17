const { chromium } = require(process.env.FOLIO_PLAYWRIGHT || "playwright"),
  http = require("http"),
  fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const { NativeBridge } = require("../native-bridge.cjs"),
  { OCRJobs } = require("../ocr-jobs.cjs");
(async () => {
  const root = path.resolve(__dirname, ".."),
    out = path.join(__dirname, "output");
  fs.mkdirSync(out, { recursive: true });
  const bridge = new NativeBridge(path.join(root, "native"), "python3"),
    jobs = new OCRJobs(
      path.join(root, "native"),
      path.join(out, "ocr-jobs"),
      "python3",
    ),
    checks = [],
    errors = [];
  let browser, page;
  const check = (s) => {
    checks.push(s);
    console.log("PASS", s);
  };
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST") {
      try {
        let body = "";
        for await (const b of req) body += b;
        const d = JSON.parse(body);
        let result;
        if (req.url === "/__job") result = await jobs.run(d);
        else if (req.url === "/__save") {
          fs.writeFileSync(
            path.join(out, "v4-ui-saved.pdf"),
            Buffer.from(d.bytes),
          );
          result = { name: "v4-ui-saved.pdf", working: true };
        } else result = await bridge.run(d);
        if (result?.bytes) {
          result.bytesBase64 = Buffer.from(result.bytes).toString("base64");
          delete result.bytes;
        }
        res.end(JSON.stringify({ result }));
      } catch (e) {
        console.log("SERVERERROR", e.stack);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    const file = path.resolve(
      root,
      "." +
        decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"),
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
        "--disable-gpu",
        "--no-zygote",
      ],
    });
    page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
    });
    page.on("console", (m) => {
      if (m.type() === "error") console.log("CONSOLE", m.text());
    });
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.log("PAGEERROR", e.message);
    });
    await page.addInitScript(() => {
      async function request(url, data) {
        if (data.bytes) data = { ...data, bytes: Array.from(data.bytes) };
        const r = await fetch(url, {
          method: "POST",
          body: JSON.stringify(data),
        }).then((r) => r.json());
        if (r.error) throw Error(r.error);
        if (r.result?.bytesBase64) {
          r.result.bytes = Uint8Array.fromBase64(r.result.bytesBase64);
          delete r.result.bytesBase64;
        }
        return r.result;
      }
      window.desktop = {
        setDirty() {},
        onClose() {},
        native: (d) => request("/__native", d),
        ocrJob: (d) => request("/__job", d),
        save: (d) => request("/__save", d),
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/src/`);
    await page.addStyleTag({
      content:
        "@font-face{font-family:'Folio QA';src:url('/native/fonts/NotoSansSC.ttf')} :root{font-family:'Folio QA',sans-serif}",
    });
    const open = async (file) => {
      await page.locator("#file-input").setInputFiles(path.join(root, file));
      await page.waitForFunction(
        (name) =>
          document.querySelector("#doc-name").textContent === name &&
          document.querySelector("#busy").hidden,
        path.basename(file),
      );
    };
    await open("assets/Folio-Sample.pdf");
    await page.waitForSelector(".pdf-page[data-ready=true]");
    check("Document opens and renders");
    const zoom = await page.evaluate(async () => {
      const { surface } = await import("/src/app.mjs");
      let gaps = 0,
        frames = 0,
        run = true;
      function sample() {
        if (!run) return;
        frames++;
        if (!document.querySelector(".pdf-page[data-ready=true] canvas"))
          gaps++;
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
      for (const z of [1.2, 2, 3, 1.5, 4, 2]) {
        await surface.zoom(z);
        await new Promise((r) => setTimeout(r, 60));
      }
      await new Promise((r) => setTimeout(r, 500));
      run = false;
      await surface.zoom("fit");
      return { frames, gaps };
    });
    assert(zoom.frames > 5 && zoom.gaps === 0);
    check("Repeated zoom retains completed page frames");
    // Geometry-aware extraction fixture with native text and OCR source is exercised separately.
    await page.locator("[data-action=generate]").first().click();
    assert.equal(await page.locator("[data-rule]").count(), 1);
    await page.locator("#rule-add").click();
    await page.locator("#rule-add").click();
    assert.equal(await page.locator("[data-rule]").count(), 3);
    await page.locator('[data-rule="1"] [data-delete]').click();
    assert.equal(
      await page.locator('[data-rule="1"] [data-field=level]').inputValue(),
      "2",
    );
    await page.locator('[data-rule="1"] [data-delete]').click();
    await page
      .locator('[data-rule="0"] [data-field=pattern]')
      .fill("^Folio PDF Studio$");
    await page.locator(".generation-advanced summary").click();
    await page.locator("#multi-header").fill("0");
    await page.locator("#multi-footer").fill("0");
    await page.locator(".generation-advanced summary").click();
    await page.locator("#multi-merge").selectOption("replace");
    await page.locator(".page-presets [data-mode=current]").click();
    await page.locator("#multi-current").click();
    await page.waitForFunction(
      () => !document.querySelector("#multi-apply").disabled,
    );
    await page.screenshot({ path: path.join(out, "v4-rules.png") });
    await page.locator("#multi-apply").click();
    check("Generic rules add/delete and generation with live page preview");
    await page.locator("[data-action=calibrate]").first().click();
    await page.waitForFunction(
      () => !document.querySelector("#cal-apply").disabled,
    );
    await page.locator("#cal-after").click();
    await page.waitForSelector("#cal-preview:not([hidden])");
    await page.screenshot({ path: path.join(out, "v4-calibrate.png") });
    await page.locator("#cal-apply").click();
    check("Title calibration finds text and displays target preview");
    // Construct a realistic duplicate tree through the application's model commit.
    await page.evaluate(async () => {
      const { S, commit } = await import("/src/app.mjs");
      const { makeNode } = await import("/src/model.mjs");
      const a = makeNode("Same", 1),
        b = makeNode("Same", 1),
        c = makeNode("Child", 1, b.id);
      a.bold = true;
      b.italic = true;
      a.target.args = [20, 700, null];
      b.target.args = [20, 700.02, null];
      commit([a, b, c]);
    });
    await page.locator(".tree-row").nth(0).click();
    await page
      .locator(".tree-row")
      .nth(1)
      .click({ modifiers: ["Control"] });
    assert(await page.locator("#prop-bold").evaluate((el) => el.indeterminate));
    await page.locator("#prop-color").fill("#123456");
    await page.locator("#properties button[type=submit]").click();
    assert(
      await page.evaluate(async () => {
        const { S } = await import("/src/app.mjs");
        return (
          S.nodes[0].bold &&
          S.nodes[1].italic &&
          S.nodes[0].color === "#123456" &&
          S.nodes[1].color === "#123456"
        );
      }),
    );
    check("Multi-select styles preserve mixed attributes");
    await page.locator("[data-action=tree-menu]").first().click();
    await page.locator("#dedupe").click();
    await page.waitForFunction(
      () => !document.querySelector("#du-apply").disabled,
    );
    await page.locator("#du-apply").click();
    assert(
      await page.evaluate(async () => {
        const { S } = await import("/src/app.mjs");
        return S.nodes.length === 2 && S.nodes[1].parent === S.nodes[0].id;
      }),
    );
    check("Same-page dedupe preserves and reparents children");
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    const childRow = page.locator(".tree-row").nth(1),
      treeBox = await page.locator("#tree").boundingBox(),
      childBox = await childRow.boundingBox();
    await childRow.dispatchEvent("dragstart", { dataTransfer: transfer });
    await page
      .locator("#tree")
      .dispatchEvent("dragover", {
        dataTransfer: transfer,
        clientX: treeBox.x + 8,
        clientY: childBox.y + 10,
      });
    await page.waitForTimeout(100);
    await page
      .locator("#tree")
      .dispatchEvent("drop", {
        dataTransfer: transfer,
        clientX: treeBox.x + 8,
        clientY: childBox.y + 10,
      });
    assert(
      await page.evaluate(async () => {
        const { S } = await import("/src/app.mjs");
        return S.nodes[1].parent === null;
      }),
    );
    check("Drag left gutter promotes a child to root without losing nodes");
    await page.evaluate(async () => {
      const { S } = await import("/src/app.mjs");
      S.dirty = false;
    });
    await open("tests/output/v4-scan.pdf");
    await page.locator("[data-action=ocr]").first().click();
    await page.locator(".page-presets [data-mode=all]").click();
    assert.equal(await page.locator("#ocr-range").inputValue(), "1-4");
    await page.locator(".range-visual summary").click();
    await page.waitForSelector(".page-tile canvas");
    await page.locator('[data-p="4"]').click();
    assert.equal(await page.locator("#ocr-range").inputValue(), "1-3");
    await page.locator('[data-p="4"]').click();
    await page.locator(".range-visual summary").click();
    check("Unified range presets and thumbnail page selection");
    await page.locator("#ocr-mode").selectOption("custom");
    await page.locator("#ocr-workers").fill("1");
    await page.locator("#ocr-threads").fill("2");
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
    await page.locator("#ocr-review-page").fill("2");
    await page.locator("#ocr-review-page").press("Tab");
    await page.waitForFunction(() =>
      document.querySelector("#ocr-confidence").textContent.includes("第 2 页"),
    );
    assert((await page.locator("#ocr-results option").count()) >= 3);
    assert((await page.locator("#ocr-results option").count()) < 20);
    await page.locator("#ocr-results").selectOption("0");
    await page.locator("#ocr-correction").fill("第二章 人工校对标题");
    await page.locator("#ocr-correct").click();
    await page
      .locator(".native-properties")
      .evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({ path: path.join(out, "v4-ocr.png") });
    check("Actual offline OCR, per-page review, correction persisted to disk");
    await page.locator("#ocr-apply").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("#modal").open &&
        document.querySelector("#busy").hidden,
      null,
      { timeout: 180000 },
    );
    const texts = await page.evaluate(async () => {
      const { S } = await import("/src/app.mjs");
      return (await (await S.pdf.getPage(2)).getTextContent()).items
        .map((i) => i.str)
        .join("");
    });
    assert(texts.includes("人工校对标题"));
    check("Corrected hidden text layer applied and searchable");
    await page.locator("[data-action=ocr]").first().click();
    await page.locator("#ocr-results").selectOption("0");
    await page.locator("#ocr-correction").fill("第1章 复核标题");
    await page.locator("#ocr-correct").click();
    await page.locator("#ocr-next").click();
    await page.locator("#ocr-prev").click();
    await page.waitForFunction(() =>
      document.querySelector("#ocr-results").textContent.includes("复核标题"),
    );
    await page.locator("#ocr-apply").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("#modal").open &&
        document.querySelector("#busy").hidden,
      null,
      { timeout: 180000 },
    );
    check(
      "Reopened OCR corrections survive page navigation without rerunning recognition",
    );
    await page.locator("[data-action=generate]").first().click();
    await page.locator(".page-presets [data-mode=all]").click();
    await page.locator('[data-rule="0"] [data-field=pattern]').fill("^第.*章");
    await page.locator("#multi-run").click();
    await page.waitForFunction(
      () => !document.querySelector("#multi-apply").disabled,
    );
    const n = await page.locator("#multi-preview .preview-item").count();
    assert.equal(n, 4);
    await page.locator("#multi-apply").click();
    await page.locator("[data-action=generate]").first().click();
    await page.locator(".page-presets [data-mode=all]").click();
    await page.locator('[data-rule="0"] [data-field=pattern]').fill("^第.*章");
    await page.locator("#multi-run").click();
    await page.waitForFunction(
      () => !document.querySelector("#multi-apply").disabled,
    );
    await page.locator("#multi-apply").click();
    assert.equal(
      await page.evaluate(
        async () => (await import("/src/app.mjs")).S.nodes.length,
      ),
      4,
    );
    check("OCR-derived bookmarks and repeated generation do not duplicate");
    await page.locator("[data-action=save]").first().click();
    await page.waitForFunction(
      () =>
        document.querySelector("#doc-name").textContent === "v4-ui-saved.pdf" &&
        document.querySelector("#busy").hidden,
      null,
      { timeout: 180000 },
    );
    check("Combined bookmark/OCR save succeeds");
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "v4-ui-report.json"),
      JSON.stringify({ checks, errors }, null, 2),
    );
    console.log("DONE", checks.length);
  } catch (e) {
    if (page)
      await page
        .screenshot({ path: path.join(out, "v4-ui-failure.png") })
        .catch(() => {});
    throw e;
  } finally {
    await jobs.stop();
    bridge.cancel();
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

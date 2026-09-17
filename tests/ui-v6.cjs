// Browser UI + real Python sidecar. Chromium 131 compatibility shims only in this QA harness.
const { chromium } = require(
  process.env.FOLIO_PLAYWRIGHT ||
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright",
);
const fs = require("fs"),
  http = require("http"),
  path = require("path"),
  assert = require("assert/strict");
const { NativeBridge } = require("../native-bridge.cjs"),
  { makeHTML, measureOverflow } = require("../flow-layout.cjs");
(async () => {
  const root = path.resolve(__dirname, ".."),
    out = path.join(root, "tests/output"),
    bridge = new NativeBridge(path.join(root, "native"), "python3");
  let browser,
    page,
    layoutPage,
    layoutLoaded = false,
    applyCount = 0,
    copy = "";
  const errors = [],
    checks = [];
  const shim = `for(const T of [Map,WeakMap]){T.prototype.getOrInsertComputed??=function(k,fn){if(!this.has(k))this.set(k,fn(k));return this.get(k)};T.prototype.getOrInsert??=function(k,v){if(!this.has(k))this.set(k,v);return this.get(k)}};Uint8Array.prototype.toHex??=function(){return Array.from(this,x=>x.toString(16).padStart(2,'0')).join('')};Uint8Array.fromBase64??=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));`;
  const font = fs
      .readFileSync("native/fonts/NotoSansSC.ttf")
      .toString("base64"),
    fallback = fs
      .readFileSync("native/fonts/DejaVuSans.ttf")
      .toString("base64");
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "POST") {
        let chunks = [];
        for await (const c of req) chunks.push(c);
        const d = JSON.parse(Buffer.concat(chunks));
        let result;
        if (req.url === "/__flow") {
          const start = performance.now();
          if (!layoutLoaded) {
            await layoutPage.setContent(makeHTML(d, font, fallback));
            layoutLoaded = true;
          } else {
            const html = makeHTML(d);
            await layoutPage.evaluate((html) => {
              const doc = new DOMParser().parseFromString(html, "text/html");
              document.querySelector("#flow-style").textContent =
                doc.querySelector("#flow-style").textContent;
              document
                .querySelector("#flow")
                .replaceWith(doc.querySelector("#flow"));
            }, html);
          }
          const stats = await layoutPage.evaluate(measureOverflow);
          result = { ...stats, elapsedMs: performance.now() - start };
          if (!stats.overflow)
            result.bytes = await layoutPage.pdf({
              printBackground: true,
              preferCSSPageSize: true,
              pageRanges: "1",
            });
        } else if (req.url === "/__save") {
          fs.writeFileSync(
            path.join(out, "v6-ui-saved.pdf"),
            Buffer.from(d.bytes),
          );
          result = { name: "v6-ui-saved.pdf", working: true };
        } else if (req.url === "/__copy") {
          copy = d.text;
          result = true;
        } else {
          if (d.command === "apply") applyCount++;
          result = await bridge.run(d);
        }
        if (result?.bytes) {
          result.bytesBase64 = Buffer.from(result.bytes).toString("base64");
          delete result.bytes;
        }
        res.end(JSON.stringify({ result }));
        return;
      }
      const file = path.resolve(
        root,
        "." +
          decodeURIComponent(req.url.split("?")[0]).replace(
            /\/$/,
            "/index.html",
          ),
      );
      if (!file.startsWith(root + path.sep)) throw Error("path");
      res.setHeader(
        "Content-Type",
        {
          ".mjs": "text/javascript",
          ".js": "text/javascript",
          ".html": "text/html",
          ".css": "text/css",
          ".ttf": "font/ttf",
          ".wasm": "application/wasm",
        }[path.extname(file)] || "application/octet-stream",
      );
      if (file.endsWith("pdf.worker.mjs"))
        res.end(shim + fs.readFileSync(file, "utf8"));
      else
        fs.createReadStream(file)
          .on("error", () => res.writeHead(404).end())
          .pipe(res);
    } catch (e) {
      console.log("SERVER", e.message);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    browser = await chromium.launch({
      executablePath: process.env.FOLIO_BROWSER,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    layoutPage = await browser.newPage();
    page = await browser.newPage({
      viewport: { width: 1600, height: 1100 },
      deviceScaleFactor: 1.5,
    });
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.log("UIERROR", e.message);
    });
    await page.addInitScript(shim);
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
        flowLayout: (d) => request("/__flow", d),
        save: (d) => request("/__save", d),
        copyText: (text) => request("/__copy", { text }),
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/src/`);
    await page.addStyleTag({
      content:
        "@font-face{font-family:'Folio QA';src:url('/native/fonts/NotoSansSC.ttf')}body{font-family:'Folio QA',sans-serif}",
    });
    await page
      .locator("#file-input")
      .setInputFiles(path.join(out, "v6-flow-source.pdf"));
    await page.waitForFunction(
      () =>
        document.querySelector("#doc-name").textContent ===
          "v6-flow-source.pdf" && document.querySelector("#busy").hidden,
    );
    await page.locator('[data-action="flow-edit"]').first().click();
    await page.waitForSelector("#flow-candidates option");
    await page.locator("#flow-candidates").selectOption(["0"]);
    await page.locator("#flow-merge").click();
    await page
      .locator("#flow-text")
      .fill(
        "流式编辑中文段落测试，金额 00123.45，利率 3.50%。English words flow across columns. ".repeat(
          11,
        ),
      );
    await page.locator("#flow-width").fill("460");
    await page.locator("#flow-height").fill("360");
    await page.locator("#flow-columns").selectOption("2");
    await page.locator("#flow-preview").click();
    await page.waitForFunction(
      () => !document.querySelector("#flow-apply").disabled,
      null,
      { timeout: 90000 },
    );
    checks.push("UI Chinese paragraph and 2-column preview ready");
    await page.screenshot({ path: path.join(out, "v6-flow-ui.png") });
    await page.locator("#flow-height").fill("15");
    await page.locator("#flow-preview").click();
    await page.waitForFunction(() =>
      document.querySelector("#flow-status").textContent.includes("溢出"),
    );
    assert(await page.locator("#flow-apply").isDisabled());
    checks.push("Overflow prevents applying");
    await page.locator("#flow-height").fill("360");
    await page.locator("#flow-preview").click();
    await page.waitForFunction(
      () => !document.querySelector("#flow-apply").disabled,
    );
    await page.locator("#flow-apply").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("#modal").open &&
        document.querySelector("#busy").hidden,
      null,
      { timeout: 120000 },
    );
    checks.push("Actual paragraph replacement applied");
    const before = applyCount;
    await page.locator('[data-action="save"]').first().click();
    await page.waitForFunction(
      () =>
        document.querySelector("#doc-name").textContent === "v6-ui-saved.pdf" &&
        document.querySelector("#busy").hidden,
      null,
      { timeout: 120000 },
    );
    assert.equal(applyCount, before);
    checks.push("Save reuses applied content without another native apply");
    await page.locator('[data-action="undo"]').first().click();
    await page.waitForFunction(() => document.querySelector("#busy").hidden);
    const undo = await page.evaluate(async () => {
      const { S } = await import("/src/app.mjs");
      return {
        edits: S.nativeEdits.length,
        text: (await (await S.pdf.getPage(1)).getTextContent()).items
          .map((i) => i.str)
          .join(""),
      };
    });
    assert.equal(undo.edits, 0);
    assert(undo.text.includes("OLD FIRST"));
    checks.push("Undo restores original source paragraph");
    await page.locator('[data-action="redo"]').first().click();
    await page.waitForFunction(() => document.querySelector("#busy").hidden);
    await page.locator('[data-action="flow-edit"]').first().click();
    await page.waitForSelector("#flow-existing option:nth-child(2)", {
      state: "attached",
    });
    await page.locator("#flow-existing").selectOption({ index: 1 });
    assert(
      (await page.locator("#flow-text").inputValue()).includes("00123.45"),
    );
    checks.push("Redo and resume preserve source and text model");
    await page.locator("#modal-close").click();
    const projectBytes = await page.evaluate(async () => {
      const { S } = await import("/src/app.mjs");
      const { encodeProject } = await import("/src/project.mjs");
      return Array.from(
        await encodeProject(S.bytes, S.name, {
          nodes: S.nodes,
          nativeEdits: S.nativeEdits,
          ocr: S.ocr,
          annotations: S.annotations,
          rotation: S.rotation,
          metadata: S.metadata,
        }),
      );
    });
    fs.writeFileSync(path.join(out, "v6-ui.folio"), Buffer.from(projectBytes));
    // Clear only the test document's dirty flag so the explicit discard dialog does not block the harness.
    await page.evaluate(async () => {
      const { S } = await import("/src/app.mjs");
      S.dirty = false;
    });
    await page
      .locator("#file-input")
      .setInputFiles(path.join(out, "v6-ui.folio"));
    await page.waitForFunction(
      () =>
        document.querySelector("#toast").textContent.includes("已恢复工作工程"),
      null,
      { timeout: 120000 },
    );
    const model = await page.evaluate(async () => {
      const { S } = await import("/src/app.mjs");
      return S.nativeEdits.find((e) => e.type === "flow")?.model;
    });
    assert(model.text.includes("00123.45"));
    checks.push(
      "Portable project restores original bytes and editable flow model",
    );
    // Synthetic completed OCR blocks exercise the real dialog without costly inference.
    await page.evaluate(async () => {
      const { S } = await import("/src/app.mjs");
      S.ocr = Array.from({ length: 30 }, (_, i) => ({
        id: "qa:" + i,
        page: 1,
        text: "测试 " + i,
        confidence: 0.99,
        quad: [
          [60, 780 - i * 22],
          [260, 780 - i * 22],
          [260, 764 - i * 22],
          [60, 764 - i * 22],
        ],
      }));
    });
    await page.locator('[data-action="ocr"]').first().click();
    await page.waitForFunction(
      () => document.querySelector("#ocr-results")?.options.length === 30,
    );
    await page.locator("#ocr-results").selectOption("29");
    await page.waitForFunction(
      () => document.querySelector("#ocr-canvas").parentElement.scrollTop > 100,
    );
    checks.push("Right OCR result reveals offscreen left target");
    await page.screenshot({ path: path.join(out, "v6-ocr-ui.png") });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "v6-ui-report.json"),
      JSON.stringify(
        { checks, errors, applyCount, browser: await browser.version() },
        null,
        2,
      ),
    );
    console.log("PASS", checks);
  } catch (e) {
    await page
      ?.screenshot({ path: path.join(out, "v6-ui-failure.png") })
      .catch(() => {});
    throw e;
  } finally {
    bridge.cancel();
    await bridge.clearCache();
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

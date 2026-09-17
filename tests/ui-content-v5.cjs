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
  const bridge = new NativeBridge(
      path.join(root, "native"),
      process.env.FOLIO_PYTHON || "python3",
    ),
    jobs = new OCRJobs(
      path.join(root, "native"),
      path.join(out, "ocr-jobs"),
      process.env.FOLIO_PYTHON || "python3",
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
            path.join(out, "v5-content-ui-saved.pdf"),
            Buffer.from(d.bytes),
          );
          result = { name: "v5-content-ui-saved.pdf", working: true };
        } else {
          if (d.ocrReference) {
            d.ocrFile = jobs.resolveReference(d.ocrReference);
            delete d.ocrReference;
            delete d.ocr;
          }
          result = await bridge.run(d);
        }
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
        "--single-process",
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
    await open("tests/output/v5-spacing.pdf");
    await page.locator('[data-action="edit-content"]').first().click();
    await page.waitForFunction(()=>document.querySelector('#object-select') && !document.querySelector('#object-select').disabled);
    await page.locator('#object-select').selectOption('0');
    await page.locator('#obj-text').fill('已修改原文字');
    await page.locator('#object-apply').click();
    await page.waitForFunction(()=>!document.querySelector('#modal').open && document.querySelector('#busy').hidden);
    const positions=[];
    for (let i=0;i<2;i++) {
      await page.locator('[data-action="edit-content"]').first().click();
      await page.waitForFunction(()=>document.querySelector('#object-select') && !document.querySelector('#object-select').disabled);
      await page.locator('#object-new-text').click();
      assert.equal(await page.locator('#obj-text').inputValue(),'新文字');
      positions.push(JSON.parse(await page.locator('#obj-matrix').inputValue())[5]);
      await page.locator('#obj-text').fill('独立新增文字'+i);
      await page.locator('#object-apply').click();
      await page.waitForFunction(()=>!document.querySelector('#modal').open && document.querySelector('#busy').hidden);
    }
    assert.equal(positions[0]-positions[1],28);
    const ids=await page.evaluate(async()=>{const {S}=await import('/src/app.mjs');return S.nativeEdits.filter(e=>e.index===null).map(e=>e.id)});
    assert.equal(new Set(ids).size,2);
    check('Existing text edit plus two independent additions through actual property controls');
    await page.locator('[data-action="save"]').first().click();
    await page.waitForFunction(()=>document.querySelector('#doc-name').textContent==='v5-content-ui-saved.pdf' && document.querySelector('#busy').hidden,null,{timeout:120000});
    check('Combined structural/native save succeeds after repeated additions');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "v5-content-ui-report.json"),
      JSON.stringify({ checks, errors }, null, 2),
    );
    console.log("DONE", checks.length);
  } catch (e) {
    if (page)
      await page
        .screenshot({ path: path.join(out, "v5-content-ui-failure.png") })
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

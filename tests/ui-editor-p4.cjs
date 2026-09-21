// Synthetic narrow table: formatting, row growth and actual PDF save regression.
const assert = require("node:assert/strict");
const python =
  process.env.FOLIO_PYTHON ||
  (process.platform === "win32" ? "python" : "python3");
const { chromium } = require("playwright"),
  fs = require("fs"),
  path = require("path");
const { NativeBridge } = require("../native-bridge.cjs"),
  { FlowLayout } = require("../flow-layout.cjs"),
  { SourceStore } = require("../source-store.cjs");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output/p4"),
  tag = process.env.P4_TAG || "narrow-regression";
fs.mkdirSync(path.join(out, tag), { recursive: true });
const store = new SourceStore(),
  bridge = new NativeBridge(path.join(root, "native"), python, store),
  fonts = new NativeBridge(path.join(root, "native"), python, store),
  background = new NativeBridge(path.join(root, "native"), python, store),
  flow = new FlowLayout(path.join(root, "native"), python);
let browser,
  page,
  current = 0;
const report = { tag, pages: [], errors: [], requests: [] };
(async () => {
  browser = await chromium.launch({
    executablePath: process.env.FOLIO_CHROMIUM,
    headless: true,
    args: [
      "--no-sandbox",
      ...(process.platform === "linux" ? ["--no-zygote", "--single-process"] : []),
      "--disable-gpu",
      "--disable-background-networking",
    ],
  });
  page = await browser.newPage({ viewport: { width: 1536, height: 1100 } });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (u.hostname !== "localhost") return route.abort();
    try {
      let body,
        type = "application/json";
      if (req.method() === "POST") {
        const d = JSON.parse(req.postData());
        let r;
        const t = Date.now();
        if (u.pathname === "/__save") {
          fs.writeFileSync(
            path.join(out, tag, `saved-${current}.pdf`),
            Buffer.from(d.bytes),
          );
          r = { name: d.name, working: true };
        } else if (u.pathname === "/__register")
          r = await store.register(new Uint8Array(d));
        else if (u.pathname === "/__release") r = await store.release(d);
        else if (u.pathname === "/__flow") r = await flow.render(d);
        else
          r = await (
            d.command.startsWith("font-")
              ? fonts
              : d.command === "flow-background"
                ? background
                : bridge
          ).run(d);
        if (r?.bytes) r.bytes = Array.from(r.bytes);
        body = JSON.stringify(r ?? true);
        report.requests.push({
          page: current,
          command: d.command || u.pathname,
          ms: Date.now() - t,
        });
      } else {
        const file = path.resolve(
          root,
          "src",
          "." +
            (u.pathname === "/"
              ? "/index.html"
              : decodeURIComponent(u.pathname)),
        );
        body = fs.readFileSync(file);
        if (path.basename(file) === "app.mjs")
          body = Buffer.concat([
            body,
            Buffer.from(
              "\nwindow.__qa={S,surface,actions,loadPDF,savePDF,closeModal};",
            ),
          ]);
        if (path.basename(file) === "flow-ui.mjs")
          body = Buffer.from(
            body
              .toString()
              .replace(
                "      draft: () =>",
                "      qaState: () => ({model,preview,revision,validRevision,busy,running:!!running,fastReady}),\n      draft: () =>",
              ),
          );
        type =
          {
            ".mjs": "text/javascript",
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
          }[path.extname(file)] || "application/octet-stream";
      }
      await route.fulfill({ status: 200, contentType: type, body });
    } catch (e) {
      report.requests.push({ page: current, error: e.message });
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: e.message }),
      });
    }
  });
  await page.addInitScript(() => {
    const call = async (url, d) => {
      let r = await fetch(url, { method: "POST", body: JSON.stringify(d) }),
        v = await r.json();
      if (v.error) throw Error(v.error);
      if (v.bytes) v.bytes = new Uint8Array(v.bytes);
      return v;
    };
    window.desktop = {
      registerSource: (b) => call("/__register", Array.from(b)),
      releaseSource: (h) => call("/__release", h),
      native: (d) =>
        call("/__native", {
          ...d,
          ...(d.bytes ? { bytes: Array.from(d.bytes) } : {}),
        }),
      flowLayout: (d) => call("/__flow", d),
      setDirty() {},
      onClose() {},
      onNativeProgress() {},
      prepareSave: async () => ({ ticket: "test" }),
      save: (d) => call("/__save", { ...d, bytes: Array.from(d.bytes) }),
      graphics: async () => false,
      copyText: async () => {},
      ocrJob: async () => [],
    };
  });
  await page.goto("http://localhost");
  console.log("APP_LOADED");
  await page.waitForFunction(() => window.__qa);
  const watch = setInterval(async () => {
    console.log(
      "PROGRESS",
      current,
      report.requests.slice(-2),
      await page
        .locator("#pe-status")
        .textContent({ timeout: 500 })
        .catch(() => ""),
    );
  }, 10000);
  watch.unref();
  await page.evaluate(
    (bytes) =>
      window.__qa.loadPDF(new Uint8Array(bytes), "Narrow table fixture.pdf"),
    Array.from(fs.readFileSync(path.join(root, "tests/output/p4-narrow.pdf"))),
  );
  console.log("PDF_LOADED");
  const stable = async () => {
    await page.waitForTimeout(250);
    await page.waitForFunction(
      () => {
        const e = window.__qa.S.flowEdit,
          s = e?.qaState(),
          t = document.querySelector("#pe-status")?.textContent || "";
        return (
          s?.model &&
          !s.busy &&
          !s.running &&
          !/正在|准备|载入|后台排版中/.test(t)
        );
      },
      null,
      { timeout: 30000 },
    );
  };
  const state = () =>
    page.evaluate(() => {
      const s = window.__qa.S.flowEdit?.qaState();
      if (!s) return null;
      const input = document.querySelector(".page-edit-input"),
        caret = document
          .querySelector(".page-edit-caret")
          .getBoundingClientRect(),
        l = document.querySelector(".page-edit-layer").getBoundingClientRect(),
        scale = l.width / s.model.pageWidth;
      return {
        status: document.querySelector("#pe-status").textContent,
        text: s.model.text,
        selection: input.selectionStart,
        frame: s.model.frame,
        cell: s.model.cell,
        valid: s.validRevision === s.revision,
        overflow: s.preview?.overflow,
        glyphs: s.preview?.glyphs?.length,
        originalGlyphs: s.model.originalLayout?.glyphs?.length,
        layer: [l.x, l.y, scale],
        caret: [
          (caret.x - l.x) / scale,
          (caret.y - l.y) / scale,
          caret.width / scale,
          caret.height / scale,
        ],
        resize: !document.querySelector(".page-edit-resize").hidden,
        sizeDisabled: document.querySelector('[data-frame="height"]').disabled,
        warning: document.querySelector(".pe-notice").hidden
          ? ""
          : document.querySelector("#pe-warning").textContent,
      };
    });
  const select = async (m) => {
    const glyph =
      m.originalLayout.glyphs.find(
        (g) => g.text.trim() && g.start >= Math.min(3, m.text.length - 1),
      ) || m.originalLayout.glyphs[0];
    const target = {
      x: glyph.x + glyph.w * 0.25,
      y: glyph.y + glyph.h * 0.5,
      expected: glyph.start,
    };
    const hit = page.locator(`[data-cell-id="${m.cell.id}"]`);
    await hit.scrollIntoViewIfNeeded();
    const box = await hit.boundingBox(),
      b = m.cell.bounds,
      scale = box.width / (b[2] - b[0]);
    let x = box.x + (target.x - b[0]) * scale,
      y = box.y + (target.y - b[1]) * scale;
    if (y < 180 || y > 1000) {
      await page.locator(".page-edit-layer").evaluate((el, p) => {
        el.parentElement.scrollIntoView({ block: "start" });
      }, target);
      const bb = await hit.boundingBox();
      x = bb.x + (target.x - b[0]) * scale;
      y = bb.y + (target.y - b[1]) * scale;
    }
    await page.mouse.click(x, y);
    await stable();
    return { ...target, state: await state() };
  };

  current = 1;
  await page.evaluate(() => window.__qa.actions["flow-edit"]());
  await page.waitForSelector(".table-cell-hit");
  const ms = JSON.parse(
      fs.readFileSync(path.join(root, "tests/output/p4-narrow-models.json")),
    ),
    m = ms.find((m) => m.text.trim() === "A");
  report.activation = await select(m);
  await page.locator(".page-edit-input").evaluate((el) => {
    el.focus();
    el.select();
  });
  await page.locator("#pe-bold").click();
  await stable();
  report.bold = await state();
  await page.locator("#pe-more").click();
  await page.locator(".pe-position>summary").click();
  const height = page.locator('[data-frame="height"]');
  report.heightEnabled = await height.isEnabled();
  if (report.heightEnabled) {
    await height.fill(String(m.frame.height + 24));
    await height.press("Tab");
    await stable();
    report.expanded = await state();
    await page.locator("#pe-close-properties").click();
  } else {
    await page.locator("#pe-close-properties").click();
    const b = await page.locator(".page-edit-resize").boundingBox();
    await page.mouse.move(b.x + 2, b.y + 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 2, b.y + 26);
    await page.mouse.up();
    await stable();
    report.expanded = await state();
  }
  await page.screenshot({ path: path.join(out, tag, "narrow-expanded.png") });
  if (report.expanded.valid) {
    await page.locator("#pe-done").click();
    await page.waitForFunction(() => !window.__qa.S.flowEdit);
    await page.evaluate(() => window.__qa.savePDF(true));
    report.saved = fs.existsSync(path.join(out, tag, "saved-1.pdf"));
  }
  assert.equal(report.heightEnabled, true);
  assert.equal(report.bold.overflow, false);
  assert.equal(report.expanded.frame.width, m.frame.width);
  assert.ok(
    Math.abs(report.expanded.frame.height - m.frame.height - 24) < 0.01,
  );
  assert.equal(report.saved, true);
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report));
})()
  .catch((e) => {
    report.fatal = e.stack;
    process.exitCode = 1;
    console.error(e);
  })
  .finally(async () => {
    fs.writeFileSync(
      path.join(out, tag, "report.json"),
      JSON.stringify(report, null, 2),
    );
    await browser?.close();
    for (const b of [bridge, fonts, background]) b.cancel();
    flow.close();
    await store.close();
  });

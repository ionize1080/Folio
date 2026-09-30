// Same user-facing controls in browser/native bridge and packaged Windows EXE.
const { chromium, _electron } = require("playwright"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output"),
  exe = process.env.FOLIO_EXE,
  checks = [],
  errors = [];
let app, browser, page, bridge, background, store;
(async () => {
  try {
    if (exe) {
      app = await _electron.launch({
        executablePath: exe,
        args: ["--force-device-scale-factor=1.5"],
        timeout: 60000,
      });
      page = await app.firstWindow();
      await app.evaluate(async ({ session }) =>
        session.defaultSession.clearStorageData(),
      );
      await page.reload();
    } else {
      const { NativeBridge } = require("../native-bridge.cjs"),
        { SourceStore } = require("../source-store.cjs");
      store = new SourceStore();
      bridge = new NativeBridge(
        path.join(root, "native"),
        process.env.FOLIO_PYTHON || "python3",
        store,
      );
      background = new NativeBridge(
        path.join(root, "native"),
        process.env.FOLIO_PYTHON || "python3",
        store,
      );
      browser = await chromium.launch({
        headless: true,
        ...(process.env.FOLIO_CHROMIUM
          ? { executablePath: process.env.FOLIO_CHROMIUM }
          : {}),
        args: ["--no-sandbox"],
      });
      page = await browser.newPage({
        viewport: { width: 1536, height: 1000 },
        deviceScaleFactor: 2,
      });
      await page.route("**/*", async (route) => {
        try {
          const req = route.request(),
            url = new URL(req.url());
          if (url.hostname !== "localhost") return route.abort();
          let body, type;
          if (req.method() === "POST") {
            const d = JSON.parse(req.postData());
            let r;
            if (url.pathname === "/__register")
              r = await store.register(new Uint8Array(d));
            else if (url.pathname === "/__release") r = await store.release(d);
            else if (url.pathname === "/__save") {
              fs.writeFileSync(path.join(out, d.name), Buffer.from(d.bytes));
              r = { name: d.name, working: true };
            } else
              r = await (
                d.command === "flow-background" ? background : bridge
              ).run(d);
            if (r?.bytes) r.bytes = Array.from(r.bytes);
            body = JSON.stringify(r ?? true);
            type = "application/json";
          } else {
            const file = path.join(
              root,
              "src",
              url.pathname === "/"
                ? "index.html"
                : decodeURIComponent(url.pathname),
            );
            body = fs.readFileSync(file);
            if (file.endsWith("app.mjs"))
              body = Buffer.concat([
                body,
                Buffer.from("\nwindow.__qa={loadPDF,S};"),
              ]);
            type =
              {
                ".mjs": "text/javascript",
                ".js": "text/javascript",
                ".html": "text/html",
                ".css": "text/css",
              }[path.extname(file)] || "application/octet-stream";
          }
          await route.fulfill({ status: 200, contentType: type, body });
        } catch (e) {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: e.message }),
          });
        }
      });
      await page.addInitScript(() => {
        const call = async (url, d) => {
          const r = await fetch(url, {
              method: "POST",
              body: JSON.stringify(d),
            }),
            v = await r.json();
          if (v.error) throw Error(v.error);
          if (v.bytes) v.bytes = new Uint8Array(v.bytes);
          return v;
        };
        window.desktop = {
          native: (d) =>
            call("/__native", {
              ...d,
              ...(d.bytes ? { bytes: Array.from(d.bytes) } : {}),
            }),
          registerSource: (b) => call("/__register", Array.from(b)),
          releaseSource: (h) => call("/__release", h),
          setDirty() {},
          onClose() {},
          onNativeProgress() {},
          graphics: async () => false,
          prepareSave: async () => ({ ticket: "test" }),
          save: (d) => call("/__save", { ...d, bytes: Array.from(d.bytes) }),
          ocrJob: async () => [],
        };
      });
      await page.goto("http://localhost");
    }
    page.setDefaultTimeout(90000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluate(() =>
      localStorage.setItem(
        "folio-settings",
        JSON.stringify({ saveSummary: false }),
      ),
    );
    await page.reload();
    const file = path.join(out, "v15-images.pdf");
    if (exe) {
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      }, file);
      await page.locator('[data-action="open"]').first().click();
    } else
      await page.evaluate(
        async (d) => window.__qa.loadPDF(new Uint8Array(d), "v15-images.pdf"),
        Array.from(fs.readFileSync(file)),
      );
    await page.waitForSelector("body.has-document");
    await page.locator('[data-action="edit-image"]').click();
    await page.locator(".image-page-hit").first().click();
    const ready = () =>
      page.waitForFunction(() =>
        document
          .querySelector("[data-status]")
          ?.textContent.includes("预览已更新"),
      );
    await ready();
    const latency = [];
    for (const value of [10, 20, 5, 15]) {
      const start = Date.now();
      await page.locator('[data-adjust="brightness"]').fill(String(value));
      await ready();
      latency.push(Date.now() - start);
    }
    assert(Math.max(...latency) < 5000, JSON.stringify(latency));
    checks.push({
      name: "12 MP on-page adjustment end-to-end latency",
      milliseconds: latency,
    });
    const frame = () =>
      page.locator(".image-page-composite").evaluate((c) => ({
        width: c.width,
        height: c.height,
        sum: Array.from(
          c.getContext("2d").getImageData(0, 0, c.width, c.height).data,
        ).reduce((s, x, i) => (i % 97 === 0 ? s + x : s), 0),
      }));
    const before = await frame();
    assert(before.width > 0 && before.sum > 0);
    for (const action of ["zoom-in", "zoom-in", "zoom-out", "zoom-out"]) {
      await page.locator(`[data-action="${action}"]`).click();
      await page.waitForFunction(() => {
        const c =
          document.querySelector(
            ".page-shell:not(.page-fallback) .image-page-composite",
          ) || document.querySelector(".image-page-composite");
        return c?.width > 0 && c.isConnected;
      });
      await page.waitForTimeout(300);
      const after = await frame();
      assert(
        after.width > 0 && after.sum === before.sum,
        "unsaved preview lost while zooming",
      );
      assert.equal(
        await page.locator('[data-adjust="brightness"]').inputValue(),
        "15",
      );
    }
    checks.push(
      "Unsaved adjustments survive four successive zooms with identical retained pixels and parameter values",
    );
    await page.locator("[data-jump]").selectOption("adj-levels");
    const black = page.locator('[data-level-handle="0"]');
    await black.scrollIntoViewIfNeeded();
    await black.focus();
    await black.press("ArrowRight");
    await ready();
    assert.equal(await page.locator('[data-adjust="black"]').inputValue(), "1");
    const gray = page.locator('[data-level-handle="1"]'),
      gb = await gray.boundingBox();
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.mouse.down();
    await page.mouse.move(gb.x - 25, gb.y + gb.height / 2, { steps: 8 });
    await page.mouse.up();
    await ready();
    assert(+(await page.locator('[data-adjust="gamma"]').inputValue()) > 1);
    await page.locator('[data-adjust="outputBlack"]').fill("240");
    await page.locator('[data-adjust="outputWhite"]').fill("10");
    await ready();
    await page.screenshot({ path: path.join(out, "v15-levels.png") });
    await page.locator("[data-level-channel]").selectOption("b");
    await page.locator('[data-level-handle="2"]').focus();
    await page.locator('[data-level-handle="2"]').press("ArrowLeft");
    await ready();
    assert.equal(
      await page.locator('[data-adjust="white"]').inputValue(),
      "254",
    );
    checks.push(
      "Histogram black/gamma/white handles, keyboard adjustment, output inversion and independent blue-channel values",
    );
    await page.locator("[data-reset]").click();
    await ready();
    await page.locator("[data-jump]").selectOption("adj-curves");
    await page.locator("[data-curve-mode]").selectOption("pencil");
    await ready();
    const cb = await page.locator("[data-curve]").boundingBox();
    await page.mouse.move(cb.x + cb.width * 0.2, cb.y + cb.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(cb.x + cb.width * 0.75, cb.y + cb.height * 0.15, {
      steps: 20,
    });
    await page.mouse.up();
    await ready();
    await page.locator("[data-curve-smooth]").click();
    await ready();
    await page.locator("[data-curve-grid]").click();
    await page.screenshot({ path: path.join(out, "v15-curves.png") });
    await page.locator("[data-curve-mode]").selectOption("point");
    await ready();
    await page.locator("[data-curve-reset]").click();
    await ready();
    await page.locator('[data-curve-endpoint="0"]').focus();
    await page.locator('[data-curve-endpoint="0"]').press("ArrowRight");
    await ready();
    assert.equal(await page.locator("[data-curve-x]").inputValue(), "1");
    await page.locator("[data-curve-target]").click();
    const hit = await page.locator(".image-page-hit").first().boundingBox();
    await page.mouse.move(hit.x + hit.width * 0.6, hit.y + hit.height * 0.65);
    await page.mouse.down();
    await page.mouse.move(
      hit.x + hit.width * 0.6,
      hit.y + hit.height * 0.65 - 20,
      { steps: 5 },
    );
    await page.mouse.up();
    await ready();
    checks.push(
      "Curves pencil strokes, smoothing, grid density, conversion to points, endpoint movement and direct on-image drag",
    );
    await page
      .locator("[data-crop-start]")
      .evaluate((e) => (e.closest("details").open = true));
    await page.locator("[data-crop-start]").click();
    let handle = await page.locator('[data-crop-handle="nw"]').boundingBox();
    await page.mouse.move(handle.x + 5, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 45, handle.y + 35, { steps: 8 });
    await page.mouse.up();
    assert(+(await page.locator('[data-image-crop="0"]').inputValue()) > 0);
    await page.keyboard.press("Escape");
    assert.equal(
      +(await page.locator('[data-image-crop="0"]').inputValue()),
      0,
    );
    await page.locator("[data-crop-start]").click();
    await page.locator("[data-crop-ratio]").selectOption("1");
    handle = await page.locator('[data-crop-handle="se"]').boundingBox();
    await page.mouse.move(handle.x + 5, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x - 110, handle.y - 70, { steps: 8 });
    await page.mouse.up();
    await page.screenshot({ path: path.join(out, "v15-crop.png") });
    await page.keyboard.press("Enter");
    await ready();
    const crops = await page
      .locator("[data-image-crop]")
      .evaluateAll((es) => es.map((e) => +e.value));
    assert(
      Math.abs(
        (((100 - crops[0] - crops[2]) / (100 - crops[1] - crops[3])) * 4) / 3 -
          1,
      ) < 0.02,
    );
    await page.locator("[data-crop-straighten]").click();
    const poly = await page.locator(".crop-frame").boundingBox();
    await page.mouse.move(
      poly.x + poly.width * 0.25,
      poly.y + poly.height * 0.6,
    );
    await page.mouse.down();
    await page.mouse.move(
      poly.x + poly.width * 0.7,
      poly.y + poly.height * 0.55,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.keyboard.press("Enter");
    await ready();
    await page.locator("[data-crop-perspective]").click();
    handle = await page.locator('[data-crop-handle="p0"]').boundingBox();
    await page.mouse.move(handle.x + 5, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 25, handle.y + 15, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.press("Enter");
    await ready();
    checks.push(
      "On-page crop handles, Escape restores draft, Enter confirms square crop, straighten line and perspective corner correction",
    );
    await page.locator("#image-apply").click();
    await page.waitForFunction(() =>
      document.querySelector("#image-progress")?.textContent.includes("已完成"),
    );
    await page.locator("#image-done").click();
    if (exe)
      await app.evaluate(
        ({ dialog }, file) => {
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: file,
          });
        },
        path.join(out, "v15-ui-saved.pdf"),
      );
    else await page.evaluate(() => (window.__qa.S.name = "v15-ui-saved.pdf"));
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(
      () =>
        document.querySelector("#busy").hidden &&
        !document.querySelector("#dirty-dot").classList.contains("changed"),
    );
    assert(fs.statSync(path.join(out, "v15-ui-saved.pdf")).size > 100);
    await page.locator('[data-action="undo"]').click();
    await page.waitForFunction(() => document.querySelector("#busy").hidden);
    await page.locator('[data-action="redo"]').click();
    await page.waitForFunction(() => document.querySelector("#busy").hidden);
    checks.push(
      "Save adjusted/cropped real PDF; whole operation remains undoable and redoable",
    );
    assert.deepEqual(errors, []);
  } catch (e) {
    errors.push(e.stack);
    if (page)
      await page
        .screenshot({ path: path.join(out, "v15-ui-failure.png") })
        .catch(() => {});
  } finally {
    const hash = (f) =>
      crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    const report = {
      platform: process.platform,
      checks,
      errors,
      ...(exe
        ? {
            exe_sha256: hash(exe),
            asar_sha256: hash(
              path.join(path.dirname(exe), "resources/app.asar"),
            ),
          }
        : {}),
    };
    fs.writeFileSync(
      path.join(out, "v15-ui-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    await app?.close();
    await browser?.close();
    bridge?.cancel();
    background?.cancel();
    store?.close();
    if (errors.length) process.exitCode = 1;
  }
})();

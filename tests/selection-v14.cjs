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
    const file = path.join(out, "v14-selection.pdf");
    async function openFile(file) {
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
          async (d) =>
            window.__qa.loadPDF(new Uint8Array(d), "v14-selection.pdf"),
          Array.from(fs.readFileSync(file)),
        );
      await page.waitForSelector("body.has-document");
    }
    await openFile(file);
    const ready = () =>
      page.waitForFunction(() =>
        document
          .querySelector("[data-status]")
          ?.textContent.includes("预览已更新"),
      );
    const done = () =>
      page.waitForFunction(
        () =>
          document
            .querySelector("[data-progress]")
            ?.textContent.includes("已完成") &&
          document.querySelector("#busy").hidden,
      );
    await page.locator('[data-select-mode="all"]').click();
    await page.waitForSelector('.selection-object[data-type="text"]');
    async function hit(index, mods = []) {
      const box = await page
        .locator(`.selection-object[data-index="${index}"]`)
        .boundingBox();
      for (const m of mods) await page.keyboard.down(m);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      for (const m of mods) await page.keyboard.up(m);
    }
    const indices = await page
      .locator('.selection-object[data-type="text"]')
      .evaluateAll((es) => es.map((e) => e.dataset.index));
    await hit(indices[0]);
    await hit(indices[1], ["Control"]);
    assert.equal(await page.locator(".selection-object.selected").count(), 2);
    await hit(indices[1], ["Control"]);
    assert.equal(await page.locator(".selection-object.selected").count(), 1);
    await hit(indices[1], ["Shift"]);
    assert.equal(await page.locator(".selection-object.selected").count(), 2);
    await page.locator("[data-size-enable]").check();
    await page.locator("[data-size]").fill("20");
    await page.locator("[data-color-enable]").check();
    await page.locator("[data-color]").fill("#d21b43");
    await page.locator("[data-text]").click();
    await done();
    await page.locator(".object-selection-layer").focus();
    const before = await page
      .locator(".selection-object.selected")
      .first()
      .boundingBox();
    await page.keyboard.press("Shift+ArrowRight");
    await done();
    const after = await page
      .locator(".selection-object.selected")
      .first()
      .boundingBox();
    assert(after.x > before.x + 3);
    checks.push(
      "Ctrl toggle, Shift additive selection, batch text color/size and keyboard nudge",
    );
    await page.locator("[data-clear]").click();
    const layer = await page.locator(".object-selection-layer").boundingBox();
    const textBoxes = await page
      .locator('.selection-object[data-type="text"]')
      .evaluateAll((es) =>
        es.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
    const x0 = Math.min(...textBoxes.slice(0, 2).map((r) => r.x)) - 5,
      y0 = Math.min(...textBoxes.slice(0, 2).map((r) => r.y)) - 5,
      x1 = Math.max(...textBoxes.slice(0, 2).map((r) => r.x + r.w)) + 5,
      y1 = Math.max(...textBoxes.slice(0, 2).map((r) => r.y + r.h)) + 5;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.locator(".selection-object.selected").count(), 2);
    await page.locator('[data-action="undo"]').click();
    await page.waitForFunction(() => document.querySelector("#busy").hidden);
    await page.locator('[data-action="redo"]').click();
    await page.waitForFunction(() => document.querySelector("#busy").hidden);
    checks.push("Rectangle containment selects intended text; batch undo/redo");
    await page.locator('[data-select-mode="image"]').click();
    await page.waitForSelector('.selection-object[data-type="image"]');
    assert.equal(
      await page.locator('.selection-object[data-type="text"]').count(),
      0,
    );
    await page.locator("[data-all]").click();
    assert.equal(await page.locator(".selection-object.selected").count(), 2);
    await page.locator("[data-images]").click();
    await ready();
    assert(
      (await page.locator("#image-selection").textContent()).includes(
        "2 张图片",
      ),
    );
    await page.locator("[data-jump]").selectOption("adj-balance");
    const slider = page.locator('[data-visual-slider="balance-0"]');
    await slider.focus();
    await slider.press("ArrowRight");
    await ready();
    assert.equal(await page.locator('[data-balance="0"]').inputValue(), "1");
    const track = await slider.evaluate((e) =>
      getComputedStyle(e).getPropertyValue("--track"),
    );
    assert(track.includes("linear-gradient"));
    await page.locator("[data-balance-tone]").selectOption("shadows");
    assert.equal(await slider.inputValue(), "0");
    await page.locator("[data-jump]").selectOption("adj-gradient");
    await page.locator("[data-add-stop]").click();
    assert.equal(
      await page.locator("[data-stops] input[type=color]").count(),
      3,
    );
    const status = await page.locator(".task-status").boundingBox();
    assert(status.y + status.height < (await page.evaluate(() => innerHeight)));
    await page.locator(".more-tools summary").click();
    assert(await page.locator(".more-tools-menu").isVisible());
    const covered = await page
      .locator('[data-action="metadata"]')
      .evaluate((e) => {
        const r = e.getBoundingClientRect();
        return e.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      });
    assert(covered, "More tools covered by inspector");
    await page.keyboard.press("Escape");
    await page.locator("[data-jump]").selectOption("adj-hsl");
    await page.locator('[data-adjust="saturation"]').fill("25");
    await ready();
    await page.screenshot({ path: path.join(out, "v14-image-light.png") });
    await page.locator("#image-apply").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#image-progress")
        ?.textContent.includes("已完成 2 张"),
    );
    await page.locator("#image-done").click();
    checks.push(
      "Image-only selection; batch image preview/apply; colored sliders and tone synchronization; persistent status; overflow menu stacking",
    );
    await page.locator('[data-select-mode="all"]').click();
    await page.waitForSelector(".selection-object");
    await page.locator("[data-all]").click();
    await page.screenshot({ path: path.join(out, "v14-selection-light.png") });
    await page.locator('[data-action="theme"]').click();
    await page.screenshot({ path: path.join(out, "v14-selection-dark.png") });
    await page.locator("[data-done]").click();
    await page.locator('[data-select-mode="hand"]').click();
    await page.locator('[data-action="zoom-in"]').click();
    await page.waitForTimeout(600);
    const host = page.locator("#canvas-host"),
      hostBox = await host.boundingBox();
    const oldScroll = await host.evaluate((e) => e.scrollTop);
    await page.mouse.move(
      hostBox.x + hostBox.width / 2,
      hostBox.y + hostBox.height * 0.65,
    );
    await page.mouse.down();
    await page.mouse.move(
      hostBox.x + hostBox.width / 2,
      hostBox.y + hostBox.height * 0.35,
      { steps: 10 },
    );
    await page.mouse.up();
    assert((await host.evaluate((e) => e.scrollTop)) > oldScroll + 5);
    await page.locator('[data-select-mode="read"]').click();
    checks.push(
      "Light/dark workspace and hand-tool drag; return to text reading",
    );
    if (exe)
      await app.evaluate(
        ({ dialog }, file) => {
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: file,
          });
        },
        path.join(out, "v14-ui-saved.pdf"),
      );
    else await page.evaluate(() => (window.__qa.S.name = "v14-ui-saved.pdf"));
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(
      () =>
        document.querySelector("#busy").hidden &&
        !document.querySelector("#dirty-dot").classList.contains("changed"),
    );
    assert(fs.statSync(path.join(out, "v14-ui-saved.pdf")).size > 100);
    checks.push("Mixed batch saves through actual document save pipeline");
    assert.deepEqual(errors, []);
  } catch (e) {
    errors.push(e.stack);
    if (page)
      await page
        .screenshot({ path: path.join(out, "v14-ui-failure.png") })
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
      path.join(out, "v14-ui-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app?.close().catch(() => {});
    await browser?.close();
    bridge?.cancel();
    background?.cancel();
    store?.close();
    if (errors.length) process.exitCode = 1;
  }
})();

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
    const file = path.join(out, "v13-images.pdf");
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
        async (d) => window.__qa.loadPDF(new Uint8Array(d), "v13-images.pdf"),
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
    assert.equal(await page.locator("#modal").evaluate((e) => e.open), false);
    assert(await page.locator(".image-page-composite").isVisible());
    const ratio = await page
      .locator("[data-curve]")
      .evaluate((c) => c.width / c.getBoundingClientRect().width);
    assert(ratio >= (await page.evaluate(() => devicePixelRatio)) - 0.02);
    await page.locator("[data-channel]").selectOption("r");
    await page.locator("[data-curve]").scrollIntoViewIfNeeded();
    const curve = await page.locator("[data-curve]").boundingBox();
    await page.mouse.click(
      curve.x + curve.width * 0.5,
      curve.y + curve.height * 0.3,
    );
    assert((await page.locator("[data-curve-x]").inputValue()) > 0);
    assert((await page.locator("[data-curve-x]").inputValue()) < 255);
    await page.locator("[data-curve-y]").fill("190");
    await page.locator("[data-curve-y]").press("Tab");
    await ready();
    await page.locator("[data-jump]").selectOption("adj-levels");
    await page.locator('[data-adjust="black"]').fill("12");
    await page.locator('[data-adjust="outputWhite"]').fill("240");
    await ready();
    await page.locator('[data-pick="gray"]').click();
    const hit = await page.locator(".image-page-hit").first().boundingBox();
    await page.mouse.click(hit.x + hit.width * 0.2, hit.y + hit.height * 0.2);
    await ready();
    await page.locator('[data-adjust="black"]').fill("254");
    await page.locator('[data-adjust="white"]').fill("200");
    await page.waitForFunction(() =>
      document.querySelector("[data-status]")?.textContent.includes("黑场"),
    );
    assert(await page.locator("#image-apply").isDisabled());
    await page.locator('[data-adjust="black"]').fill("12");
    await page.locator('[data-adjust="white"]').fill("255");
    await ready();

    for (const [id, key, value] of [
      ["exposure", "exposure", ".3"],
      ["color", "vibrance", "15"],
      ["detail", "clarity", "15"],
      ["grain", "grain", "8"],
      ["hsl", "saturation", "15"],
      ["photo", "photoDensity", "10"],
      ["poster", "posterize", "30"],
    ]) {
      await page.locator("[data-jump]").selectOption("adj-" + id);
      await page.locator(`[data-adjust="${key}"]`).fill(value);
      await ready();
    }
    await page.locator("[data-jump]").selectOption("adj-selective");
    await page.locator('[data-selective="0"]').fill("10");
    await ready();
    await page.locator("[data-jump]").selectOption("adj-mixer");
    await page.locator('[data-mixer="0"]').fill("95");
    await ready();
    await page.locator("[data-jump]").selectOption("adj-balance");
    await page.locator('[data-balance="0"]').fill("5");
    await ready();
    await page.locator("[data-jump]").selectOption("adj-lookup");
    await page.locator("[data-lookup]").selectOption("warm");
    await ready();
    await page.locator("[data-jump]").selectOption("adj-bw");
    await page.locator('[data-flag="blackWhite"]').check();
    await ready();
    await page.locator('[data-flag="blackWhite"]').uncheck();
    await ready();
    await page.locator("[data-jump]").selectOption("adj-gradient");
    await page.locator("[data-add-stop]").click();
    assert.equal(
      await page.locator("[data-stops] input[type=color]").count(),
      3,
    );
    await page.locator('[data-flag="gradientEnabled"]').check();
    await ready();
    await page.locator('[data-flag="gradientEnabled"]').uncheck();
    await ready();
    await page.locator("[data-jump]").selectOption("adj-threshold");
    await page.locator('[data-flag="thresholdEnabled"]').check();
    await ready();
    await page.locator('[data-flag="thresholdEnabled"]').uncheck();
    await ready();
    await page.locator("[data-jump]").selectOption("adj-invert");
    await page.locator('[data-flag="invert"]').check();
    await ready();
    await page.locator('[data-flag="invert"]').uncheck();
    await ready();
    await page.locator("[data-original]").check();
    assert(await page.locator(".image-page-composite").isHidden());
    await page.locator("[data-original]").uncheck();
    assert(await page.locator(".image-page-composite").isVisible());
    await page.locator("[data-jump]").selectOption("adj-curves");
    await page.screenshot({ path: path.join(out, "v13-image-light.png") });
    checks.push(
      "Click page image without modal; 18 adjustment groups; RGB curves, levels, all color tools; high-DPI canvas and on-page comparison",
    );
    await page.locator("#image-apply").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#image-apply")?.disabled &&
        document.querySelector("#busy").hidden,
    );
    await page.locator("#image-done").click();
    await page.waitForSelector(".image-page-panel", { state: "detached" });
    if (exe) {
      await app.evaluate(
        ({ dialog }, file) => {
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: file,
          });
        },
        path.join(out, "v13-ui-saved.pdf"),
      );
    } else await page.evaluate(() => (window.__qa.S.name = "v13-ui-saved.pdf"));
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(
      () =>
        document.querySelector("#busy").hidden &&
        !document.querySelector("#dirty-dot").classList.contains("changed"),
    );
    assert(fs.statSync(path.join(out, "v13-ui-saved.pdf")).size > 100);
    await page.locator('[data-action="undo"]').click();
    await page.waitForFunction(() => document.querySelector("#busy").hidden);
    await page.locator('[data-action="redo"]').click();
    await page.waitForFunction(() => document.querySelector("#busy").hidden);
    await page.locator('[data-action="theme"]').click();
    await page.locator('[data-action="edit-image"]').click();
    await page.locator(".image-page-hit").first().click();
    await ready();
    await page.locator('[data-adjust="contrast"]').fill("-15");
    await ready();
    await page.screenshot({ path: path.join(out, "v13-image-dark.png") });
    await page.locator("#image-cancel").click();
    await page.waitForSelector(".image-page-panel", { state: "detached" });
    checks.push(
      "Apply, save PDF, undo/redo, re-edit in dark theme, cancel pending edit",
    );
    if (exe) {
      await page.locator('[data-action="help"]').click();
      await page.getByRole("button", { name: "检查更新", exact: true }).click();
      await page.locator("#update-channel").selectOption("preview");
      await page.locator("#update-proxy").fill("http://127.0.0.1:7890");
      assert(await page.locator("#update-install").isDisabled());
      await page.screenshot({ path: path.join(out, "v13-update.png") });
      checks.push(
        "Packaged About update IPC, channel/proxy controls, install unavailable before verified download",
      );
    }
    assert.deepEqual(errors, []);
  } catch (e) {
    errors.push(e.stack);
    if (page)
      await page
        .screenshot({ path: path.join(out, "v13-ui-failure.png") })
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
      path.join(out, "v13-ui-report.json"),
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

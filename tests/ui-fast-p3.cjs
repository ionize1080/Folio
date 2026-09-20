const { chromium } = require(
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright"
    : "playwright",
);
const { SourceStore } = require("../source-store.cjs");
const sourceStore = new SourceStore();
const { NativeBridge } = require("../native-bridge.cjs"),
  { FlowLayout } = require("../flow-layout.cjs");
const fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output");
const bridge = new NativeBridge(
    path.join(root, "native"),
    process.env.FOLIO_PYTHON || "python",
    sourceStore,
  ),
  flow = new FlowLayout(
    path.join(root, "native"),
    process.env.FOLIO_PYTHON || "python",
  );
let browser, page;
const errors = [],
  checks = [];
(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.FOLIO_CHROMIUM,
    args: ["--no-sandbox", "--disable-gpu", "--disable-background-networking"],
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (u.hostname !== "localhost") return route.abort();
    try {
      let body,
        type = "application/json";
      if (req.method() === "POST") {
        const data = JSON.parse(req.postData());
        const r =
          u.pathname === "/__register"
            ? await sourceStore.register(new Uint8Array(data))
            : u.pathname === "/__release"
              ? await sourceStore.release(data)
              : u.pathname === "/__flow"
                ? await flow.render(data)
                : await bridge.run(data);
        if (r?.bytes) r.bytes = Array.from(r.bytes);
        body = JSON.stringify(r ?? true);
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
              "\nwindow.__qa={S,actions,loadPDF,closeModal,rebuild,commit,confirmDiscard,savePDF,snapshot};",
            ),
          ]);
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
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: e.message }),
      });
    }
  });
  await page.addInitScript(() => {
    const call = async (url, d) => {
      const r = await fetch(url, { method: "POST", body: JSON.stringify(d) }),
        v = await r.json();
      if (v.error) throw Error(v.error);
      if (v.bytes) v.bytes = new Uint8Array(v.bytes);
      return v;
    };
    window.__saved = [];
    window.__calls = [];
    window.desktop = {
      registerSource: (b) => call("/__register", Array.from(b)),
      releaseSource: (h) => call("/__release", h),
      native: (d) => {
        window.__calls.push(d.command);
        if (window.__nativeFailure && d.command === "apply")
          return Promise.reject(Error("injected engine failure"));
        return call("/__native", {
          ...d,
          ...(d.bytes ? { bytes: Array.from(d.bytes) } : {}),
        });
      },
      prepareSave: async () =>
        window.__cancelSave ? null : { ticket: "test" },
      qpdf: (d) =>
        call("/__native", {
          ...d,
          ...(d.bytes ? { bytes: Array.from(d.bytes) } : {}),
        }),
      cancelQpdf() {},
      flowLayout: (d) => {
        window.__flows = (window.__flows || 0) + 1;
        return call("/__flow", d);
      },
      setDirty() {},
      onClose() {},
      onNativeProgress() {},
      graphics: async () => false,
      copyText: async () => {},
      save: async (d) => {
        window.__saved.push({
          name: d.name,
          length: d.bytes.length,
          kind: d.kind,
        });
        return { name: d.name };
      },
      ocrJob: async () => [],
    };
  });
  await page.goto("http://localhost");
  await page.waitForFunction(() => window.__qa);
  await page.evaluate(
    async (bytes) =>
      window.__qa.loadPDF(new Uint8Array(bytes), "Standard CFF.pdf"),
    Array.from(fs.readFileSync(path.join(out, "v9-fixture.pdf"))),
  );
  await page.evaluate(() => window.__qa.actions["flow-edit"]());
  await page.locator('.page-edit-hit[aria-label="Short title"]').click();
  await page.waitForFunction(
    () => /完成/.test(document.querySelector("#pe-status")?.textContent),
    null,
    { timeout: 60000 },
  );
  await page.locator("#pe-done").click();
  await page.waitForFunction(() => !window.__qa.S.flowEdit);
  checks.push(
    "Raw PDF standard CFF face loads through outline-preserving OpenType wrapper",
  );

  await page.evaluate(
    async (bytes) =>
      window.__qa.loadPDF(new Uint8Array(bytes), "Quick edit fixture.pdf"),
    Array.from(fs.readFileSync(path.join(out, "p3-fixture.pdf"))),
  );
  const action = (n) => page.evaluate((n) => window.__qa.actions[n](), n);
  await action("flow-edit");
  await page.locator('.page-edit-hit[aria-label="Quarterly report"]').click();
  await page.waitForFunction(() =>
    /完成/.test(document.querySelector("#pe-status")?.textContent),
  );
  assert.equal(
    await page.locator("#pe-bold").getAttribute("aria-pressed"),
    "true",
  );
  checks.push("Original fill/stroke bold recognized by the formatting toolbar");
  await page
    .locator('.page-edit-hit[aria-label^="Original first line"]')
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".page-edit-input")
        .value.includes("second line") &&
      /完成/.test(document.querySelector("#pe-status").textContent),
  );
  assert(
    (await page.locator(".page-edit-input").inputValue()).includes(
      "first line\nOriginal second line",
    ),
  );
  checks.push("Two original lines remain separated on activation");
  await page
    .locator('.page-edit-hit[aria-label="Selection bold and italic"]')
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".page-edit-input").value ===
        "Selection bold and italic" &&
      /完成/.test(document.querySelector("#pe-status").textContent),
  );
  const select = async (a, b) =>
    page.evaluate(
      ([a, b]) => {
        const i = document.querySelector(".page-edit-input");
        i.focus();
        i.setSelectionRange(a, b);
        i.dispatchEvent(new Event("select"));
      },
      [a, b],
    );
  await select(0, 9);
  await page.locator("#pe-bold").click();
  await page.locator("#pe-italic").click();
  const selection = await page.evaluate(() => {
    const i = document.querySelector(".page-edit-input");
    return [i.selectionStart, i.selectionEnd];
  });
  assert.deepEqual(selection, [0, 9]);
  let draft = await page.evaluate(() => window.__qa.S.flowEdit.draft().model);
  assert(draft.runs[0].bold && draft.runs[0].italic);
  assert(!draft.runs.at(-1).bold);
  assert(await page.locator(".page-edit-fast").isVisible());
  checks.push(
    "Toolbar preserves selection and paints selected bold/italic immediately",
  );
  // Large frame allows both layout choices to fit; format panel fields are public UI.
  await page.locator("#pe-more").click();
  await page.locator(".pe-position>summary").click();
  await page.locator('input[data-frame="width"]').fill("330");
  await page.locator('input[data-frame="width"]').dispatchEvent("change");
  await page.locator('input[data-frame="height"]').fill("110");
  await page.locator('input[data-frame="height"]').dispatchEvent("change");
  await page.locator("#pe-close-properties").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#pe-refine").textContent === "预览精排" &&
      !document.querySelector("#pe-refine").disabled,
    null,
    { timeout: 60000 },
  );
  await page.locator("#pe-refine").click();
  await page.waitForSelector("#pe-keep-fast:not([hidden])");
  assert(await page.locator(".page-edit-input").isDisabled());
  await page.locator("#pe-keep-fast").click();
  assert(await page.locator(".page-edit-input").isEnabled());
  checks.push(
    "Refinement is explicit preview; keep-fast returns to editable text",
  );
  const perf = await page.evaluate(() => {
    const i = document.querySelector(".page-edit-input");
    i.focus();
    const times = [],
      before = window.__flows;
    for (let j = 0; j < 15; j++) {
      const t = performance.now();
      i.dispatchEvent(
        new InputEvent("beforeinput", { inputType: "insertText", data: "A" }),
      );
      i.value += "A";
      i.setSelectionRange(i.value.length, i.value.length);
      i.dispatchEvent(
        new InputEvent("input", { inputType: "insertText", data: "A" }),
      );
      times.push(performance.now() - t);
    }
    return { times, requests: window.__flows - before };
  });
  assert.equal(perf.requests, 0);
  assert(Math.max(...perf.times) < 500);
  checks.push(
    "15 synchronous edits make zero native layout calls; render latency recorded",
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#pe-refine").textContent === "预览精排" &&
      !document.querySelector("#pe-refine").disabled,
    null,
    { timeout: 60000 },
  );
  await page.locator("#pe-refine").click();
  await page.locator("#pe-use-refined").click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".page-edit-input").disabled &&
      /完成/.test(document.querySelector("#pe-status").textContent),
  );
  checks.push(
    "Applying current refinement rebases anchors without losing editable style runs",
  );
  for (const width of [900, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await page.screenshot({ path: path.join(out, `p3-ui-${width}.png`) });
    const b = await page.locator("#pe-done").boundingBox();
    assert(b.x >= 0 && b.x + b.width <= width);
  }
  await page.locator("#pe-done").click();
  await page.waitForFunction(
    () => !window.__qa.S.flowEdit && window.__qa.S.nativeEdits.length === 1,
    null,
    { timeout: 60000 },
  );
  const entry = await page.evaluate(() => window.__qa.S.nativeEdits[0]);
  fs.writeFileSync(
    path.join(out, "p3-ui-fragment.pdf"),
    Buffer.from(entry.fragment, "base64"),
  );
  assert(entry.model.runs[0].bold && entry.model.runs[0].italic);
  checks.push(
    "Fast/precise choice commits actual searchable PDF with retained style runs",
  );
  await action("flow-edit");
  await page.locator('.page-edit-hit[aria-label="ROTATED"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector(".page-edit-input").value === "ROTATED" &&
      /完成/.test(document.querySelector("#pe-status").textContent),
  );
  assert(
    (await page.locator("#pe-direction-badge").innerText()).includes("90"),
  );
  await page.locator("#pe-cancel").click();
  checks.push("Rotated region activates without flattening reading direction");
  console.log(
    "P3_PREVIEW_IMAGE=" +
      fs.readFileSync(path.join(out, "p3-ui-1440.png")).toString("base64"),
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(out, "p3-ui-report.json"),
    JSON.stringify(
      { checks, errors, perf, browser: await browser.version() },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors, perf }));
})()
  .catch(async (e) => {
    console.error(e);
    if (page) {
      console.error("page errors", errors);
      console.error(
        await page
          .locator("body")
          .innerText()
          .catch(() => ""),
      );
      await page.screenshot({ path: path.join(out, "p3-ui-failure.png") });
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    bridge.cancel();
    flow.close();
    await sourceStore.close();
  });

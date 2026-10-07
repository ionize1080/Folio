// Full UI with real native services. No external document uploads.
const { chromium } = require(
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright"
    : "playwright",
);
const { NativeBridge } = require("../native-bridge.cjs");
const { FlowLayout } = require("../flow-layout.cjs");
const fs = require("fs"),
  path = require("path"),
  http = require("http"),
  assert = require("assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output");
const bridge = new NativeBridge(
  path.join(root, "native"),
  process.env.FOLIO_PYTHON || "python",
);
const layout = new FlowLayout(
  path.join(root, "native"),
  process.env.FOLIO_PYTHON || "python",
);
let browser, server, activePage;
const errors = [],
  checks = [];
(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.FOLIO_CHROMIUM,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-domain-reliability",
      "--no-first-run",
    ],
  });
  const page = (activePage = await browser.newPage({
    viewport: { width: 1536, height: 1100 },
  }));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const request = route.request(),
      u = new URL(request.url());
    if (u.hostname !== "localhost") return route.abort();
    try {
      let body,
        type = "application/json";
      if (request.method() === "POST") {
        const data = JSON.parse(request.postData());
        const result =
          u.pathname === "/__flow"
            ? await layout.render(data)
            : await bridge.run(data);
        if (result.bytes) result.bytes = Array.from(result.bytes);
        body = JSON.stringify(result);
      } else {
        const p = path.resolve(
          root,
          "src",
          "." +
            (u.pathname === "/"
              ? "/index.html"
              : decodeURIComponent(u.pathname)),
        );
        if (!p.startsWith(path.join(root, "src") + path.sep))
          throw Error("path");
        body = fs.readFileSync(p);
        if (path.basename(p) === "app.mjs")
          body = Buffer.concat([
            body,
            Buffer.from(
              "\nwindow.__qa={S,surface,loadPDF,savePDF,actions,closeModal,commit,selectNode,renameInline,settings,applySettings,refreshNative,rpc,documentSession,scheduleRecovery};",
            ),
          ]);
        type =
          {
            ".mjs": "text/javascript",
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
            ".wasm": "application/wasm",
          }[path.extname(p)] || "application/octet-stream";
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
    const call = async (url, data) => {
      const r = await fetch(url, {
        method: "POST",
        body: JSON.stringify(data),
      });
      const v = await r.json();
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
      flowLayout: (d) => call("/__flow", d),
      setDirty() {},
      onClose() {},
      onNativeProgress() {},
      graphics: async () => false,
      copyText: async () => {},
      ocrJob: async (d) => (d.action === "history" ? [] : {}),
    };
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem("folio-language")) localStorage.setItem("folio-language", "en");
  });
  await page.goto("http://localhost");
  console.log("app loaded");
  await page.waitForFunction(() => window.__qa);

  const bytes = Array.from(fs.readFileSync(path.join(out, "v172-table.pdf")));
  async function load() {
    await page.evaluate(
      async (b) => window.__qa.loadPDF(new Uint8Array(b), "reliability.pdf"),
      bytes,
    );
  }
  async function close() {
    await page.evaluate(() => window.__qa.closeModal());
  }
  async function action(n) {
    await page.evaluate((n) => window.__qa.actions[n](), n);
  }
  await load();
  // Successful A followed by failed B. Inject only the failure into a real inspection.
  await page.evaluate(() => {
    const original = window.desktop.native;
    window.__native = original;
    window.desktop.native = async (d) => {
      const r = await original(d);
      if (d.command === "inspect" && r.tables?.length)
        r.tables.push({
          ...r.tables[0],
          id: "bad-table",
          cells: [],
          bounds: [0, 0, 10, 10],
          structureSupported: false,
        });
      if (d.command === "table-render" && window.__holdRender)
        await new Promise((resolve) => (window.__releaseRender = resolve));
      return r;
    };
  });
  await action("table-structure");
  await page.waitForFunction(
    () => !document.querySelector("#table-apply").disabled,
  );
  await page.locator("#table-select").selectOption("1");
  assert(await page.locator("#table-apply").isDisabled());
  assert.equal(await page.locator("#table-output").getAttribute("src"), null);
  await page.locator("#table-select").selectOption("0");
  await page.waitForFunction(
    () => !document.querySelector("#table-apply").disabled,
  );
  await page.evaluate(() => (window.__holdRender = true));
  await page.locator("#table-grid textarea").first().fill("Safe edited cell");
  await page.locator("#table-grid textarea").first().press("Tab");
  await page.waitForFunction(() => window.__releaseRender);
  await page.locator("#table-select").selectOption("1");
  await page.evaluate(() => {
    window.__holdRender = false;
    window.__releaseRender();
  });
  await page.waitForTimeout(250);
  assert(await page.locator("#table-apply").isDisabled());
  assert.equal(await page.locator("#table-output").getAttribute("src"), null);
  checks.push(
    "Real table preview: failed target clears prior preview; delayed prior response cannot reactivate Apply",
  );
  await close();
  await page.evaluate(() => (window.desktop.native = window.__native));
  await action("table-structure");
  await page.waitForFunction(
    () => !document.querySelector("#table-apply").disabled,
  );
  await page
    .locator("#table-grid textarea")
    .first()
    .fill("Edited table retained");
  await page.locator("#table-grid textarea").first().press("Tab");
  await page.waitForFunction(
    () => !document.querySelector("#table-apply").disabled,
  );
  await page.locator("#table-apply").click();
  await page.waitForFunction(() => !document.querySelector("#modal").open);
  // Include a real reviewed OCR layer in the shared export base.
  await page.evaluate(async () => {
    const q = window.__qa,
      ocr = [
        {
          page: 1,
          text: "Reviewed OCR retained",
          confidence: 1,
          reviewAccepted: true,
          quad: [
            [45, 70],
            [245, 70],
            [245, 52],
            [45, 52],
          ],
        },
      ];
    await q.refreshNative(q.S.nativeEdits, ocr);
    q.commit(q.S.nodes, { ocr });
  });
  // Append uses the same applied bytes even after a save in this still-open session.
  await page.evaluate(async () => {
    window.__saved = [];
    window.desktop.save = async (d) => {
      window.__saved.push(Array.from(d.bytes));
      return { name: "copy.pdf", working: true, handle: "test" };
    };
    await window.__qa.savePDF(false, true);
    window.desktop.open = async () => ({
      name: "append.pdf",
      bytes: window.__qa.S.bytes.slice(),
    });
  });
  await action("pages");
  await page.locator("#pages-merge").click();
  await page.waitForFunction(
    () => window.__qa.S.info.pageCount === 6 && !window.__qa.S.busy,
  );
  assert.equal(
    (await page.evaluate(() => window.__qa.savePDF(false, true))).status,
    "saved",
  );
  await page.evaluate(async () => {
    const q = window.__qa;
    const b = new Uint8Array(window.__saved.at(-1));
    await q.loadPDF(b, "reopened.pdf");
  });
  assert(
    await page.evaluate(async () => {
      const p = await window.__qa.S.pdf.getPage(1);
      return (await p.getTextContent()).items.some((i) =>
        i.str.includes("Edited table retained"),
      );
    }),
  );
  assert(
    await page.evaluate(async () => {
      const p = await window.__qa.S.pdf.getPage(1);
      return (await p.getTextContent()).items.some((i) =>
        i.str.includes("Reviewed OCR retained"),
      );
    }),
  );
  fs.writeFileSync(
    path.join(out, "v172-table-saved.pdf"),
    Buffer.from(await page.evaluate(() => window.__saved.at(-1))),
  );
  const verified = require("node:child_process").spawnSync(
    process.env.FOLIO_PYTHON || "python",
    ["tests/reliability-v172-saved.py"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(verified.status, 0, verified.stderr + verified.stdout);
  checks.push(
    "Real native table and OCR edits -> same-session save -> append -> save -> cold reopen retain applied content",
  );
  checks.push(
    "Same-color same-width table checkmark is pixel-identical after cell edit, append and PDF reopen",
  );
  // Cross-entry perspective preservation and deliberately delayed file read.
  await page.evaluate(
    async (b) => window.__qa.loadPDF(new Uint8Array(b), "images.pdf"),
    Array.from(fs.readFileSync(path.join(out, "v172-images.pdf"))),
  );
  await page.evaluate(async () => {
    const q = window.__qa,
      r = await window.desktop.native({
        command: "inspect",
        bytes: q.S.bytes,
        page: 1,
      });
    window.__images = r.objects.filter((o) => o.type === "image");
    const edit = {
      ...window.__images[0],
      page: 1,
      perspective: [
        [0.1, 0.05],
        [0.95, 0.1],
        [0.9, 0.95],
        [0.1, 0.9],
      ],
    };
    await q.refreshNative([edit], []);
    q.commit(q.S.nodes, { nativeEdits: [edit] });
    window.__perspective = JSON.stringify(edit.perspective);
  });
  await action("edit-content");
  const imageIds = await page.evaluate(() =>
    window.__images.map((o) => String(o.index)),
  );
  await page.locator("#object-select").selectOption(imageIds[0]);
  await page.locator("#object-apply").click();
  await page.waitForFunction(() => !document.querySelector("#modal").open);
  assert(
    await page.evaluate(
      () =>
        JSON.stringify(window.__qa.S.nativeEdits[0].perspective) ===
        window.__perspective,
    ),
  );
  await action("edit-content");
  await page.locator("#object-select").selectOption(imageIds[0]);
  await page.evaluate(() => {
    window.__fileArrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const bytes = await window.__fileArrayBuffer.call(this);
      await new Promise((r) => (window.__releaseFile = r));
      return bytes;
    };
  });
  await page
    .locator("#obj-image-file")
    .setInputFiles(path.join(out, "v172-replacement.png"));
  await page.waitForFunction(() => window.__releaseFile);
  await page.locator("#object-select").selectOption(imageIds[1]);
  await page.evaluate(() => {
    File.prototype.arrayBuffer = window.__fileArrayBuffer;
    window.__releaseFile();
  });
  await page.waitForTimeout(100);
  await page.locator("#object-apply").click();
  await page.waitForFunction(() => !document.querySelector("#modal").open);
  assert(
    await page.evaluate(
      () =>
        !window.__qa.S.nativeEdits.find(
          (e) => e.index === window.__images[1].index,
        ).imageData,
    ),
  );
  checks.push(
    "Generic object editor preserves perspective from page edits; late replacement for A cannot mutate newly selected B",
  );
  // Keyboard selection has an active end distinct from its fixed anchor.
  await load();
  await page.evaluate(async () => {
    const q = window.__qa,
      { makeNode } = await import("./model.mjs");
    q.commit(Array.from({ length: 8 }, (_, i) => makeNode("Bookmark " + i)));
    q.selectNode(q.S.nodes[0].id);
  });
  await page.locator("#tree").focus();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  assert.equal(await page.evaluate(() => window.__qa.S.selected.size), 3);
  await page.keyboard.press("Shift+ArrowUp");
  assert.equal(await page.evaluate(() => window.__qa.S.selected.size), 2);
  await page.evaluate(() => window.__qa.renameInline());
  await page.locator(".inline-name").evaluate((input) => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
      }),
    );
  });
  assert.equal(await page.locator(".inline-name").count(), 1);
  await page.locator(".inline-name").press("Escape");
  assert(await page.locator("#tree").getAttribute("aria-activedescendant"));
  checks.push(
    "Consecutive Shift arrows extend/shrink from active bookmark; composing Enter does not commit rename",
  );
  // Width preferences remain stable as the effective viewport narrows.
  await page.evaluate(() => {
    const q = window.__qa;
    q.settings.sidebar = 520;
    q.settings.inspectorWidth = 520;
    q.settings.leftMode = q.settings.rightMode = "full";
    q.applySettings(false);
  });
  await page.setViewportSize({ width: 1080, height: 800 });
  await page.waitForTimeout(100);
  assert(
    await page
      .locator(".inspector")
      .evaluate((e) => e.getBoundingClientRect().right <= innerWidth + 1),
  );
  assert.equal(
    await page.evaluate(() => window.__qa.settings.inspectorWidth),
    520,
  );
  await action("settings");
  await page.locator("#modal-footer .primary").click();
  assert.equal(await page.locator("#modal").evaluate((e) => e.open), false);
  await page.locator(".panel-resizer.left").focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.evaluate(() => window.__qa.settings.sidebar), 510);
  checks.push(
    "Joint 1080px sidebar budget, 520px preferences roundtrip and keyboard resize",
  );
  for (const language of ["en", "zh-Hans", "zh-Hant"])
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        async ({ language, theme }) => {
          const { setLanguage } = await import("./i18n.mjs");
          await setLanguage(language);
          window.__qa.settings.theme = theme;
          window.__qa.applySettings(false);
        },
        { language, theme },
      );
      await action("settings");
      assert.equal(
        await page.locator("#modal").getAttribute("aria-labelledby"),
        "modal-title",
      );
      assert(
        await page.locator('[data-action="find"]').getAttribute("aria-label"),
      );
      await page.screenshot({
        path: path.join(out, `v172-${language}-${theme}.png`),
      });
      await close();
    }
  await page.evaluate(() => { window.__qa.S.dirty = false; window.__qa.S.flowDraftDirty = false; });
  await page.reload();
  await page.waitForFunction(() => window.__qa);
  assert.equal(await page.locator("#language-select").inputValue(), "zh-Hant");
  await page.locator("#language-select").selectOption("en");
  await page.evaluate(async () => (await import("./i18n.mjs")).localizeTree(document.body));
  assert((await page.locator('.panel-resizer').evaluateAll(es => es.map(e => e.getAttribute('aria-label')))).every(text => text && !/[\u3400-\u9fff]/.test(text)));
  checks.push(
    "Three languages / two themes and persisted-language reload: named dialogs, searchable controls, translated separators and bounded settings layout",
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(out, "v172-ui-report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }));
})()
  .catch(async (e) => {
    console.error(e);
    if (activePage) {
      console.error("ERRORS", errors);
      console.error(
        "MODAL",
        await activePage
          .locator("#modal-error")
          .textContent()
          .catch(() => ""),
      );
      await activePage.screenshot({ path: path.join(out, "v172-failure.png") });
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    server?.close();
    bridge.cancel();
    layout.close();
  });

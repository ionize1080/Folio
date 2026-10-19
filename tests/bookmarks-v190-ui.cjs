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
  { spawnSync } = require("child_process"),
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
let browser, activePage;
const errors = [],
  checks = [];
checks.push = (...items) => {
  console.log(...items);
  return Array.prototype.push.apply(checks, items);
};
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
    viewport: { width: 1120, height: 768 },
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
        if (path.basename(p) === "flow-ui.mjs")
          body = Buffer.from(
            body
              .toString()
              .replace(
                "      draft: () =>",
                "      qaState: () => ({model,preview,revision,validRevision,busy,running:!!running}),\n      draft: () =>",
              ),
          );
        if (path.basename(p) === "app.mjs")
          body = Buffer.concat([
            body,
            Buffer.from(
              "\nwindow.__qa={S,surface,loadPDF,savePDF,actions,closeModal,commit,selectNode,renameInline,settings,applySettings,refreshNative,rpc,documentSession,scheduleRecovery,makeNode,copyTree,pasteTree,expandSubtree};",
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
    if (!localStorage.getItem("folio-language"))
      localStorage.setItem("folio-language", "zh-Hans");
  });
  await page.goto("http://localhost");
  console.log("app loaded");
  await page.waitForFunction(() => window.__qa);

  page.setDefaultTimeout(15000);
  const action = (n) => page.evaluate((n) => window.__qa.actions[n](), n);
  const nodes = () => page.evaluate(() => structuredClone(window.__qa.S.nodes));
  const close = () => page.evaluate(() => window.__qa.closeModal());
  const load = (file) =>
    page.evaluate(
      (b) =>
        window.__qa.loadPDF(
          Uint8Array.from(atob(b), (c) => c.charCodeAt(0)),
          "中文 report #1.pdf",
        ),
      fs.readFileSync(file).toString("base64"),
    );
  const valid = () =>
    page.waitForFunction(
      () => !document.querySelector("#batch-apply").disabled,
    );
  const row = (id) => page.locator('.tree-row[data-id="' + id + '"]');
  const menuItem = (text) =>
    page
      .locator("#context-menu button")
      .filter({
        hasText: new RegExp(
          "^" + text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
        ),
      });
  const menu = async (id, text) => {
    await row(id).click({ button: "right" });
    await menuItem(text).click();
  };
  const setup = async () => {
    await load(path.join(out, "v190-outline.pdf"));
    return await nodes();
  };
  let original = await setup();
  await page.locator("#filter").fill("Chapter");
  await page.waitForFunction(
    () => !document.querySelector("#filter-batch").disabled,
  );
  await row(original[0].id).click();
  await menu(original[0].id, "更改书签缩放…");
  assert.equal(await page.locator("#batch-scope").inputValue(), "selected");
  await close();
  await page.locator("#filter-batch").click();
  assert.equal(await page.locator("#batch-scope").inputValue(), "filtered");
  await close();
  await page.locator("#clear-filter").click();
  checks.push(
    "Right-click defaults to the selected bookmark; the filter toolbar explicitly scopes to matching bookmarks",
  );

  await action("bookmark-zoom");
  await page.locator("#batch-scope").selectOption("all");
  await page.locator("#b-zoom-mode").selectOption("fixed");
  await page.locator("#b-zoom-percent").fill("150");
  await page.locator("#b-convert").check();
  await valid();
  await page.locator("#batch-name").fill("Saved fixed zoom");
  await page.locator("#batch-favorite").click();
  await page.locator("#b-zoom-mode").selectOption("Fit");
  await page.locator("#batch-history").selectOption("0");
  assert.equal(await page.locator("#b-zoom-mode").inputValue(), "fixed");
  assert(await page.locator("#b-zoom-percent").isVisible());
  assert.equal(await page.locator("#b-zoom-percent").inputValue(), "150");
  await valid();
  await page.locator("#b-zoom-percent").fill("6401");
  await page.waitForFunction(() =>
    document.querySelector("#batch-summary").classList.contains("error"),
  );
  assert(await page.locator("#batch-apply").isDisabled());
  assert(await page.locator("#batch-export-report").isDisabled());
  assert.equal(await page.locator("#batch-preview").innerText(), "");
  assert.deepEqual(await nodes(), original);
  await page.locator("#b-zoom-percent").fill("150");
  await valid();
  await page.locator("#batch-apply").click();
  const zoomed = await nodes();
  assert(zoomed.every((n) => n.target.args[2] === 1.5));
  await action("undo");
  assert.deepEqual(await nodes(), original);
  await action("redo");
  assert.deepEqual(await nodes(), zoomed);
  checks.push(
    "Restored fixed-zoom favorites expose the percentage; invalid previews clear old data and disable both Apply and report export; zoom undo/redo is exact",
  );

  await action("batch");
  await page.locator("#batch-op").selectOption("prefix");
  await page.locator("#batch-scope").selectOption("all");
  await page.locator("#b-prefix").fill("First ");
  await valid();
  await page
    .locator("#b-prefix")
    .evaluate((e) =>
      e.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
      ),
    );
  assert(await page.locator("#batch-apply").isDisabled());
  assert(await page.locator("#batch-export-report").isDisabled());
  await page.locator("#b-prefix").evaluate((e) => {
    e.value = "新 ";
    e.dispatchEvent(
      new InputEvent("input", { bubbles: true, isComposing: true, data: "新" }),
    );
  });
  await page.waitForTimeout(300);
  assert(await page.locator("#batch-apply").isDisabled());
  await page
    .locator("#b-prefix")
    .evaluate((e) =>
      e.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "新" }),
      ),
    );
  await valid();
  await page.locator("#batch-apply").click();
  assert((await nodes()).every((n) => n.title.startsWith("新 ")));
  await action("undo");
  assert.deepEqual(await nodes(), zoomed);
  checks.push(
    "IME composition immediately invalidates the old batch preview and commits only the completed title text",
  );

  await menu(zoomed[0].id, "折叠所选子树");
  assert.equal(await row(zoomed[1].id).count(), 0);
  await menu(zoomed[0].id, "展开所选子树");
  assert.equal(await row(zoomed[1].id).count(), 1);
  assert.deepEqual(await nodes(), zoomed);
  await row(zoomed[0].id).click();
  await page.locator("#tree").focus();
  await page.keyboard.press("Control+c");
  await menu(zoomed[2].id, "粘贴到前面");
  let pasted = await nodes();
  assert.equal(pasted.length, zoomed.length + 2);
  assert.deepEqual(
    pasted.map((n) => n.title),
    [
      zoomed[0].title,
      zoomed[1].title,
      zoomed[0].title,
      zoomed[1].title,
      zoomed[2].title,
      zoomed[3].title,
    ],
  );
  assert.equal(pasted[3].parent, pasted[2].id);
  await action("undo");
  assert.deepEqual(await nodes(), zoomed);
  await action("redo");
  assert.deepEqual(await nodes(), pasted);
  await action("undo");
  await row(zoomed[0].id).click();
  await page.locator("#tree").focus();
  await page.keyboard.press("Control+x");
  await row(zoomed[1].id).click({ button: "right" });
  assert(await menuItem("粘贴为子书签").isDisabled());
  await page.keyboard.press("End");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "底层字典",
  );
  await page.keyboard.press("Home");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "编辑标题 · F2",
  );
  const rect = await page.locator("#context-menu").boundingBox();
  assert(
    rect.x >= 0 &&
      rect.y >= 0 &&
      rect.x + rect.width <= 1120 &&
      rect.y + rect.height <= 768,
  );
  await page.screenshot({
    path: path.join(out, "v190-bookmark-context-compact.png"),
  });
  await page.keyboard.press("Escape");
  await menu(zoomed[2].id, "粘贴到后面");
  const cut = await nodes();
  assert.deepEqual(
    cut.map((n) => n.id),
    [zoomed[2].id, zoomed[3].id, zoomed[0].id, zoomed[1].id],
  );
  await action("undo");
  assert.deepEqual(await nodes(), zoomed);
  await action("redo");
  assert.deepEqual(await nodes(), cut);
  checks.push(
    "Copy and cut preserve whole subtrees and sibling order with undo/redo; cyclic paste is disabled; the compact context menu fits the viewport and supports keyboard navigation",
  );

  await row(cut[0].id).click();
  await page.locator("#tree").focus();
  await page.keyboard.press("Control+x");
  await page.keyboard.press("Delete");
  await page.locator("#modal-footer button.primary").click();
  const afterDelete = await nodes();
  const deletedError = await page.evaluate(() => {
    try {
      window.__qa.pasteTree("after");
      return null;
    } catch (e) {
      return e.message;
    }
  });
  assert(deletedError.includes("剪切的书签已被删除"));
  assert.deepEqual(await nodes(), afterDelete);
  await action("undo");
  assert.deepEqual(await nodes(), cut);
  checks.push(
    "Deleting a cut source cannot silently paste or corrupt the tree; undo restores the source",
  );

  // Eight real PDF destination modes, assigned through the UI and saved by the actual PDF engine.
  const targets = await page.evaluate(() => {
    const modes = [
      "inherit",
      "fixed",
      "Fit",
      "FitH",
      "FitV",
      "FitB",
      "FitBH",
      "FitBV",
    ];
    const ns = modes.map((m, i) => {
      const n = window.__qa.makeNode(m, (i % 4) + 1);
      n.target = {
        kind: "dest",
        page: (i % 4) + 1,
        mode: "FitR",
        args: [10, 20, 300, 700],
      };
      return n;
    });
    window.__qa.commit(ns);
    return ns;
  });
  for (const target of targets) {
    await row(target.id).click();
    await action("bookmark-zoom");
    await page.locator("#b-zoom-mode").selectOption(target.title);
    if (target.title === "fixed")
      await page.locator("#b-zoom-percent").fill("125");
    await valid();
    await page.locator("#batch-apply").click();
  }
  const modesBefore = await nodes();
  await page.evaluate(async () => {
    window.__saved = null;
    window.desktop.save = async (d) => {
      window.__saved = Array.from(d.bytes);
      return { name: "saved-bookmarks.pdf", working: true, handle: "qa" };
    };
    await window.__qa.savePDF(false, true);
  });
  const raw = Buffer.from(await page.evaluate(() => window.__saved));
  fs.writeFileSync(path.join(out, "v190-bookmark-modes.pdf"), raw);
  await page.evaluate(
    (b) =>
      window.__qa.loadPDF(
        Uint8Array.from(atob(b), (c) => c.charCodeAt(0)),
        "saved-bookmarks.pdf",
      ),
    raw.toString("base64"),
  );
  const reopened = await nodes();
  assert.deepEqual(
    reopened.map((n) => [n.title, n.target.page, n.target.mode, n.target.args]),
    modesBefore.map((n) => [
      n.title,
      n.target.page,
      n.target.mode,
      n.target.args,
    ]),
  );
  checks.push(
    "All eight zoom choices survive real PDF save and reopen with exact page, mode, and coordinates",
  );

  await action("exchange");
  await page.evaluate(() => {
    window.__html = null;
    window.desktop.save = async (d) => {
      window.__html = { kind: d.kind, text: new TextDecoder().decode(d.bytes) };
      return { name: d.name };
    };
  });
  await page.locator("#export-html").click();
  await page.waitForFunction(() => window.__html);
  const html = await page.evaluate(() => window.__html);
  const htmlPage = await browser.newPage();
  await htmlPage.setContent(html.text);
  assert.equal(await htmlPage.locator("li").count(), reopened.length);
  assert.equal(await htmlPage.locator("script").count(), 0);
  assert.equal(
    await htmlPage.locator("a").first().getAttribute("href"),
    "./saved-bookmarks.pdf#page=1",
  );
  await htmlPage.close();
  await close();
  checks.push(
    "HTML export contains every bookmark and uses a safe relative PDF link",
  );

  const corpus = process.env.FOLIO_CORPUS;
  if (corpus) {
    const find = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.startsWith("pdf.js__nested_outline"))
          return p;
        if (entry.isDirectory()) {
          const found = find(p);
          if (found) return found;
        }
      }
    };
    const sample = find(corpus);
    assert(sample);
    await load(sample);
    const realOriginal = await nodes();
    assert(realOriginal.length > 2);
    await action("bookmark-case");
    await page.locator("#batch-scope").selectOption("all");
    await page.locator("#b-case-mode").selectOption("upper");
    await valid();
    await page.locator("#batch-apply").click();
    await action("undo");
    assert.deepEqual(await nodes(), realOriginal);
    checks.push(
      "Online Samples nested-outline document: title-case batch preview/apply/undo preserves all original raw destinations",
    );
  }
  await page.locator("#language-select").selectOption("en");
  await action("bookmark-zoom");
  await page.locator("#b-zoom-mode").selectOption("FitBH");
  await page.waitForTimeout(300);
  const text = await page.locator("#modal").innerText();
  assert(text.includes("Fit visible width"));
  assert(!/[\u3400-\u9fff]/u.test(text));
  await page.screenshot({ path: path.join(out, "v190-bookmark-zoom-en.png") });
  checks.push(
    "New zoom controls and validation messages render in English without Chinese UI residue",
  );
  await close();
  await page.setViewportSize({ width: 800, height: 600 });
  await action("settings");
  await page.locator("#set-theme").selectOption("dark");
  await page.locator("#modal-footer button.primary").click();
  const darkNodes = await nodes();
  await row(darkNodes[0].id).click({ button: "right" });
  const darkRect = await page.locator("#context-menu").boundingBox();
  assert(
    darkRect.x >= 0 &&
      darkRect.y >= 0 &&
      darkRect.x + darkRect.width <= 800 &&
      darkRect.y + darkRect.height <= 600,
  );
  assert(
    await page
      .locator("#context-menu")
      .evaluate((e) => e.scrollHeight > e.clientHeight),
  );
  await page.keyboard.press("End");
  assert(
    await page.evaluate(
      () =>
        document.activeElement ===
        [
          ...document.querySelectorAll("#context-menu button:not(:disabled)"),
        ].at(-1),
    ),
  );
  await page.screenshot({
    path: path.join(out, "v190-bookmark-context-dark-narrow.png"),
  });
  await page.keyboard.press("Home");
  assert(
    await page.locator("#context-menu").evaluate((e) => e.scrollTop === 0),
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const ns = structuredClone(window.__qa.S.nodes);
    ns[0].title = "关闭";
    window.__qa.commit(ns);
    window.__qa.selectNode(ns[0].id);
  });
  await action("bookmark-zoom");
  await page.locator("#b-zoom-mode").selectOption("fixed");
  await page.locator("#b-zoom-percent").fill("175");
  await page.locator("#b-convert").check();
  await valid();
  assert.equal(
    await page
      .locator('#batch-preview .change-card summary span[translate="no"]')
      .first()
      .textContent(),
    "关闭",
  );
  checks.push(
    "An 800×600 dark window keeps the context menu inside the viewport with working scroll/keyboard navigation; localized previews preserve bookmark titles",
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(out, "v190-bookmark-completeness-report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }));
})()
  .catch(async (e) => {
    console.error(e);
    console.error(errors);
    if (activePage) {
      console.error(
        await activePage
          .locator("#modal")
          .innerText()
          .catch(() => ""),
      );
      await activePage.screenshot({
        path: path.join(out, "v190-bookmark-completeness-failure.png"),
      });
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    bridge.cancel();
    layout.close();
  });

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
    if (!localStorage.getItem("folio-language"))
      localStorage.setItem("folio-language", "zh-Hans");
  });
  await page.goto("http://localhost");
  console.log("app loaded");
  await page.waitForFunction(() => window.__qa);

  page.setDefaultTimeout(30000);
  const action = (n) => page.evaluate((n) => window.__qa.actions[n](), n);
  const state = () => page.evaluate(() => window.__qa.S.flowEdit?.qaState());
  const stable = async () => {
    await page.waitForTimeout(350);
    await page.waitForFunction(
      () => {
        const q = window.__qa.S.flowEdit?.qaState();
        return q?.model && !q.running && q.validRevision === q.revision;
      },
      null,
      { timeout: 45000 },
    );
  };
  const load = async (file) =>
    page.evaluate(
      (b) => window.__qa.loadPDF(new Uint8Array(b), "sample.pdf"),
      Array.from(fs.readFileSync(file)),
    );
  const save = async (name) => {
    await page.evaluate(async () => {
      window.__saved = [];
      window.desktop.save = async (d) => {
        window.__saved.push(Array.from(d.bytes));
        return { name: "edited.pdf", working: true, handle: "qa" };
      };
      await window.__qa.savePDF(false, true);
    });
    const raw = Buffer.from(await page.evaluate(() => window.__saved.at(-1)));
    fs.writeFileSync(path.join(out, name), raw);
    return raw;
  };
  await load(path.join(out, "v190-editor.pdf"));
  await action("flow-edit");
  await page.locator(".page-edit-hit:not(.unavailable)").first().click();
  await stable();
  const input = page.locator(".page-edit-input");
  await input.fill("abcdefghij\nx\nabcdefghij\n\nend".replaceAll("\\n", "\n"));
  await stable();
  await input.evaluate((e) => {
    e.focus();
    e.setSelectionRange(8, 8);
  });
  await page.keyboard.press("ArrowDown");
  assert.equal(await input.evaluate((e) => e.selectionStart), 12);
  await page.keyboard.press("ArrowDown");
  assert.equal(await input.evaluate((e) => e.selectionStart), 21);
  await page.keyboard.press("ArrowDown");
  assert.equal(await input.evaluate((e) => e.selectionStart), 24);
  await page.keyboard.press("ArrowDown");
  assert.equal(await input.evaluate((e) => e.selectionStart), 28);
  checks.push(
    "Real browser key input retains preferred X and navigates blank lines",
  );
  const before = await input.inputValue();
  await input.evaluate((e) => {
    e.setSelectionRange(0, 0);
    e.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    e.value = "Test" + e.value;
    e.setSelectionRange(4, 4);
    e.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        isComposing: true,
        data: "Test",
      }),
    );
    e.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "Test" }),
    );
    e.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Test" }));
  });
  await stable();
  await input.press("Control+z");
  await stable();
  assert.equal(await input.inputValue(), before);
  checks.push(
    "Simulated composition event order commits one undo step, including duplicate final input",
  );
  await page.screenshot({ path: path.join(out, "v190-editor.png") });
  await page.locator("#pe-done").click();
  await page.waitForSelector(".page-edit-bar", { state: "detached" });
  const edited = await save("v190-edited.pdf");
  await page.evaluate(
    (b) => window.__qa.loadPDF(new Uint8Array(b), "reopened.pdf"),
    Array.from(edited),
  );
  await action("flow-edit");
  await page.locator(".page-edit-hit:not(.unavailable)").first().click();
  await stable();
  assert.equal(await input.inputValue(), before);
  await page.locator("#pe-done").click();
  checks.push(
    "Edited paragraph saves, reopens and remains editable with identical text",
  );

  const corpus = process.env.FOLIO_CORPUS;
  await load(corpus ? path.join(corpus, "08_Navigation_Attachments/pdf.js__nested_outline__8e7862.pdf") : path.join(out,"v190-outline.pdf"));
  const original = await page.evaluate(() =>
    structuredClone(window.__qa.S.nodes),
  );
  assert(original.length > 2);
  await action("bookmark-zoom");
  assert.equal(await page.locator("#batch-op").inputValue(), "zoom");
  await page.locator("#batch-scope").selectOption("all");
  await page.locator("#b-zoom-mode").selectOption("fixed");
  await page.locator("#b-zoom-percent").fill("125");
  await page.locator("#b-convert").check();
  await page.waitForFunction(
    () => !document.querySelector("#batch-apply").disabled,
  );
  await page.locator("#batch-apply").click();
  const zoomed = await page.evaluate(() =>
    structuredClone(window.__qa.S.nodes),
  );
  for (const n of zoomed.filter((n) => n.target.page && !n.target.external))
    assert.equal(n.target.args[2], 1.25);
  await action("undo");
  assert.deepEqual(await page.evaluate(() => window.__qa.S.nodes), original);
  await action("redo");
  await action("bookmark-case");
  await page.locator("#batch-scope").selectOption("all");
  await page.locator("#b-case-mode").selectOption("upper");
  await page.waitForFunction(
    () => !document.querySelector("#batch-apply").disabled,
  );
  await page.locator("#batch-apply").click();
  const upper = await page.evaluate(() => structuredClone(window.__qa.S.nodes));
  assert.deepEqual(
    upper.map((n) => n.title),
    zoomed.map((n) => n.title.toUpperCase()),
  );
  await page.locator(".tree-row").first().click();
  await page.locator("#tree").focus();
  await page.keyboard.press("Control+c");
  const count = upper.length;
  await page.locator(".tree-row").first().click({ button: "right" });
  await page
    .locator("#context-menu button")
    .filter({ hasText: "粘贴到后面" })
    .click();
  const pasted = await page.evaluate(() => window.__qa.S.nodes);
  assert(pasted.length > count);
  assert.equal(
    pasted[0].parent,
    pasted.find((n) => !upper.some((o) => o.id === n.id)).parent,
  );
  await action("undo");
  const bm = await save("v190-bookmarks.pdf");
  await page.evaluate(
    (b) => window.__qa.loadPDF(new Uint8Array(b), "bookmarks-reopened.pdf"),
    Array.from(bm),
  );
  const reopened = await page.evaluate(() => window.__qa.S.nodes);
  assert.deepEqual(
    reopened.map((n) => n.title),
    upper.map((n) => n.title),
  );
  for (const n of reopened.filter((n) => n.target.page && !n.target.external))
    assert.equal(n.target.args[2], 1.25);
  await page.screenshot({ path: path.join(out, "v190-bookmarks.png") });
  checks.push(
    "Nested-outline sample: zoom, uppercase, sibling paste, undo/redo, save and reopen preserve hierarchy and targets",
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
  const exported = await page.evaluate(() => window.__html);
  assert.equal(exported.kind, "html");
  const view = await browser.newPage();
  await view.setContent(exported.text);
  assert.equal(await view.locator("li").count(), reopened.length);
  assert.equal(await view.locator("script").count(), 0);
  assert(
    (await view.locator("a").first().getAttribute("href")).startsWith("./"),
  );
  await view.screenshot({ path: path.join(out, "v190-html.png") });
  await view.close();
  checks.push(
    "HTML export renders the complete nested outline with safe relative page links",
  );
  if (corpus) {
    await page.evaluate(()=>window.__qa.closeModal());
    const dir=path.join(corpus,'14_Papers');const rel=fs.readdirSync(dir,{recursive:true}).find(n=>path.basename(n).startsWith('Self-Building Labs')&&n.endsWith('.pdf'));
    await load(path.join(out,'v190-mixed-font.pdf'));
    await action('flow-edit');
    await page.locator('.page-edit-hit[title^="Figure 1"]').first().click();
    await page.locator('#pe-resolve-font').waitFor({state:'visible'});await page.locator('#pe-resolve-font').click();
    assert.deepEqual(await input.evaluate(e=>[e.selectionStart,e.selectionEnd]),[0,(await input.inputValue()).length]);
    assert.equal(await page.locator('#pe-font-script').inputValue(),'all');
    await page.locator('#pe-font-search').fill('微软雅黑');
    const font=page.locator('#pe-font-list button[title="微软雅黑"]').first();await font.waitFor();await font.click();
    await page.waitForFunction(()=>window.__qa.S.flowEdit.qaState().model.runs.every(r=>r.fontKey&&r.fontResolution==='user-selected'));
    await page.locator('#pe-cancel').click();await page.locator('#pe-done').click();
    checks.push('Real mixed-font paper: replacement action selects the whole paragraph and applies an explicitly chosen system font');
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(out, "v190-ui-report.json"),
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
          .locator("#pe-status")
          .textContent()
          .catch(() => ""),
      );
      await activePage.screenshot({ path: path.join(out, "v190-failure.png") });
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    bridge.cancel();
    layout.close();
  });


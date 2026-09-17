const { chromium } = require(process.env.FOLIO_PLAYWRIGHT || "playwright");
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const root = path.resolve(__dirname, ".."),
    out = path.join(__dirname, "output");
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    let file;
    if (req.url === "/__qa-font") file = process.env.FOLIO_QA_FONT;
    else {
      let rel = decodeURIComponent(req.url.split("?")[0]);
      if (rel.endsWith("/")) rel += "index.html";
      file = path.resolve(root, "." + rel);
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
      }
    }
    res.setHeader(
      "Content-Type",
      {
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".woff2": "font/woff2",
        ".wasm": "application/wasm",
      }[path.extname(file)] || "application/octet-stream",
    );
    fs.createReadStream(file)
      .on("error", () => res.writeHead(404).end())
      .pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser, page;
  const errors = [],
    checks = [];
  const check = (s) => {
    checks.push(s);
    console.log("PASS", s);
  };
  try {
    browser = await chromium.launch({
      executablePath: process.env.FOLIO_CHROMIUM,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      acceptDownloads: true,
    });
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.log("PAGE ERROR", e.message);
    });
    page.on("console", (m) => {
      if (m.type() === "error") console.log("CONSOLE", m.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/src/`);
    if (process.env.FOLIO_QA_FONT)
      await page.addStyleTag({
        content:
          "@font-face{font-family:'Folio QA';src:url('/__qa-font')} :root{font-family:'Segoe UI','Folio QA',sans-serif}",
      });
    const reference =
      process.env.FOLIO_REFERENCE ||
      path.resolve(
        root,
        "../upload/20_WD_2025002892_国民经济行业分类-original.pdf",
      );
    await page.locator("#file-input").setInputFiles(reference);
    await page.waitForFunction(
      () =>
        document.querySelector("#busy").hidden &&
        document.querySelector("#page-total").textContent.includes("258") &&
        document.querySelector(".pdf-page[data-ready=true]"),
      null,
      { timeout: 60000 },
    );
    check("Reference opens: 258 pages; continuous default");
    const state = () =>
      page.evaluate(async () => {
        const { S, surface } = await import("/src/app.mjs");
        return {
          page: S.page,
          scale: S.scale,
          zoom: S.zoom,
          layout: surface.layout,
          nodes: S.nodes,
          dirty: S.dirty,
          past: surface.past.length,
          point: surface.point(),
          entries: surface.entries.size,
        };
      });
    const goto = async (p) => {
      await page.locator("#page-number").fill(String(p));
      await page.locator("#page-number").press("Enter");
      await page.locator("#canvas-host").focus();
      await page.waitForFunction(
        (p) =>
          document.querySelector("#page-number").value === String(p) &&
          document.querySelector(
            `.pdf-page[data-page="${p}"][data-ready=true]`,
          ),
        p,
      );
    };
    await goto(11);
    await page.waitForTimeout(300);
    check("Jump physical page and selectable text");
    const before = await state();
    await page.locator("#canvas-host").hover();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -180);
    await page.keyboard.up("Control");
    await page.waitForTimeout(500);
    assert((await state()).scale > before.scale);
    assert.equal(await page.evaluate(() => innerWidth), 1600);
    check("Ctrl+wheel document zoom");
    const anchor = await page.evaluate(async () =>
      (await import("/src/app.mjs")).surface.capture(),
    );
    await page.locator("#layout").selectOption("two-continuous");
    await page.waitForTimeout(400);
    assert.equal((await state()).page, anchor.page);
    for (const layout of ["single", "two", "horizontal", "continuous"]) {
      await page.locator("#layout").selectOption(layout);
      await page.waitForTimeout(200);
      assert.equal((await state()).layout, layout);
    }
    check("Five layouts and content anchor");
    await goto(11);
    await page.locator("#zoom").selectOption("width");
    await page.waitForTimeout(300);
    await page.locator("[data-action=generate]").click();
    await page.locator("#multi-range").fill("11-13");
    await page.locator("#multi-right").fill("325");
    await page.locator("#multi-run").click();
    await page.waitForFunction(
      () => !document.querySelector("#multi-apply").disabled,
      null,
      { timeout: 60000 },
    );
    const summary = await page.locator("#multi-summary").textContent();
    await page.screenshot({ path: path.join(out, "v2-rules.png") });
    await page.locator("#multi-apply").click();
    await page.waitForTimeout(250);
    assert((await state()).nodes.length > 30);
    check("Multilevel reference generation: " + summary);
    await page.locator(".tree-row").first().click();
    await page.waitForTimeout(200);
    await page.locator("#tree").focus();
    await page.keyboard.press("F2");
    await page.locator(".inline-name").fill("农业 · 中文编码测试");
    await page.locator(".inline-name").press("Enter");
    assert.equal((await state()).nodes[0].title, "农业 · 中文编码测试");
    check("F2 inline rename");
    await page.locator("#tree").focus();
    await page.keyboard.press("Tab");
    assert.notEqual(
      await page.evaluate(() => document.activeElement.id),
      "tree",
    );
    check("Tab focus traversal");
    await page.locator(".tree-row").first().click({ button: "right" });
    await page
      .locator("#context-menu button")
      .filter({ hasText: "底层字典" })
      .click();
    assert(
      (await page.locator("#modal-body").textContent()).includes(
        "农业 · 中文编码测试",
      ),
    );
    await page.locator("#modal-close").click();
    check("Context menu decoded dictionary");
    await page.locator("[data-action=batch]").click();
    await page.locator("#batch-op").selectOption("parameters");
    await page.locator('[data-parameter="1"]').selectOption("relative");
    await page.locator('[data-param-value="1"]').fill("8");
    await page.waitForFunction(
      () => !document.querySelector("#batch-apply").disabled,
    );
    await page.locator("#batch-apply").click();
    check("Relative parameter batch preview");
    await goto(9);
    await page.locator("#canvas-host").focus();
    await page.keyboard.press("Control+ArrowRight");
    await page.waitForFunction(
      () => document.querySelector("#page-number").value === "10",
    );
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForFunction(
      () => document.querySelector("#page-number").value === "9",
    );
    check("Page shortcut and view history");
    await page.locator("#prop-title").fill("ABC");
    await page.locator("#prop-title").press("Home");
    assert.equal((await state()).page, 9);
    await page.locator("#canvas-host").focus();
    const rot = await page.evaluate(async () =>
      JSON.stringify((await import("/src/app.mjs")).S.rotation),
    );
    await page.locator("[data-action=rotate]").click();
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(async () =>
        JSON.stringify((await import("/src/app.mjs")).S.rotation),
      ),
      rot,
    );
    for (let i = 0; i < 3; i++)
      await page.locator("[data-action=rotate]").click();
    await page.waitForTimeout(400);
    check("Native input keys and temporary rotation");
    await goto(9);
    await page.waitForTimeout(300);
    const text = await page.evaluate(() => {
      const el = document.querySelector(
          '.pdf-page[data-page="9"] .textLayer span',
        ),
        r = document.createRange();
      r.selectNodeContents(el);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return s.toString();
    });
    assert(text);
    const count = (await state()).nodes.length;
    await page.keyboard.press("Control+Shift+B");
    await page.waitForTimeout(200);
    assert.equal((await state()).nodes.length, count + 1);
    await page.locator(".inline-name").press("Enter");
    check("Selection-to-bookmark actual page target");
    await page.locator("#canvas-host").focus();
    await page.keyboard.press("Control+F");
    await page.locator("#find-text").fill("谷物");
    await page.locator("[data-action=find-run]").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#find-count").textContent.includes("处匹配"),
      null,
      { timeout: 60000 },
    );
    check("Exact search hits");
    await page.locator("[data-action=find-close]").click();
    const wait = page.waitForEvent("download");
    await page.locator("[data-action=save]").click();
    const download = await wait;
    await download.saveAs(path.join(out, "reference-v2-edited.pdf"));
    await page.waitForFunction(
      () => !document.querySelector("#dirty-dot").classList.contains("changed"),
    );
    check("Save generated PDF");
    await page.locator("[data-action=undo]").click();
    assert((await state()).dirty);
    await page.locator("[data-action=redo]").click();
    assert.equal((await state()).dirty, false);
    check("Undo/redo saved baseline");
    await page.locator("[data-action=settings]").click();
    await page.locator("[data-action=shortcuts]").click();
    assert(
      (await page.locator("#key-conflicts").textContent()).includes("无冲突"),
    );
    await page.locator("#modal-close").click();
    check("Shortcut settings conflict detection");
    await page.locator("[data-action=left-mode]").click();
    assert.equal(
      await page.locator("body").getAttribute("data-left"),
      "narrow",
    );
    await page.locator("[data-action=left-mode]").click();
    await page.locator("[data-action=left-mode]").click();
    check("Sidebar modes");
    await goto(11);
    await page.locator("#zoom").selectOption("width");
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, "v2-workspace.png") });
    assert((await state()).entries <= 8);
    // Real UI recovery path, including document bytes and pending outline edits.
    await page.locator(".tree-row").first().click();
    await page.locator("#tree").focus();
    await page.keyboard.press("F2");
    await page.locator(".inline-name").fill("恢复验证");
    await page.locator(".inline-name").press("Enter");
    await page.waitForTimeout(1100);
    page.on("dialog", (d) => d.accept());
    await page.reload();
    await page.waitForFunction(
      () =>
        document.querySelector("#modal-title").textContent ===
        "发现未保存的编辑",
    );
    await page
      .locator("#modal-footer button")
      .filter({ hasText: "恢复编辑" })
      .click();
    await page.waitForFunction(
      async () => {
        const { S } = await import("/src/app.mjs");
        return (
          S.dirty && S.nodes.some((n) => n.title === "恢复验证") && !S.busy
        );
      },
      null,
      { timeout: 60000 },
    );
    check("Crash recovery restores source bytes and pending edits");
    for (const dpr of [1, 1.5, 2]) {
      const context = await browser.newContext({
          viewport: { width: 1500, height: 950 },
          deviceScaleFactor: dpr,
        }),
        p = await context.newPage();
      await p.goto(`http://127.0.0.1:${server.address().port}/src/`);
      await p.locator("#file-input").setInputFiles(reference);
      await p.waitForFunction(
        () =>
          document.querySelector("#busy").hidden &&
          document.querySelector(".pdf-page[data-ready=true]"),
      );
      await p.evaluate(async () => {
        const { surface } = await import("/src/app.mjs");
        await surface.go(9);
        await surface.zoom("1.25");
      });
      const geometry = await p.evaluate(async () => {
        const { surface } = await import("/src/app.mjs"),
          e = surface.entries.get(9),
          span = e.text.querySelector("span"),
          r = span.getBoundingClientRect(),
          shell = e.shell.getBoundingClientRect(),
          item = e.content.items.find((x) => x.str),
          xy = e.viewport.convertToViewportPoint(
            item.transform[4],
            item.transform[5],
          );
        return {
          dx: Math.abs(r.left - shell.left - xy[0]),
          fill: getComputedStyle(span).webkitTextFillColor,
          spans: e.text.querySelectorAll("span").length,
        };
      });
      assert(geometry.dx < 2, JSON.stringify(geometry));
      assert(geometry.fill.includes("0)") || geometry.fill === "transparent");
      assert(geometry.spans > 20);
      await context.close();
    }
    check("TextLayer alignment and transparent glyphs at DPR 1 / 1.5 / 2");
    assert.equal(errors.length, 0, errors.join("\n"));
    fs.writeFileSync(
      path.join(out, "v2-ui-report.json"),
      JSON.stringify(
        {
          reference: path.basename(reference),
          checks,
          errors,
          platform: "Linux Chromium; native Windows launch not tested",
        },
        null,
        2,
      ),
    );
    console.log("DONE", checks.length);
  } catch (e) {
    console.error(e);
    if (page)
      await page
        .screenshot({ path: path.join(out, "v2-failure.png") })
        .catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server.close();
  }
})();

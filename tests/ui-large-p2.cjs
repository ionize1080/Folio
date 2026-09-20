const { chromium } = require(
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright"
    : "playwright",
);
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
const { LargeFiles } = require("../large-files.cjs");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output");
(async () => {
  await fs.mkdir(out, { recursive: true });
  const input = path.join(out, "large-ui-source.pdf"),
    saved = path.join(out, "large-ui-saved.pdf");
  execFileSync(process.env.FOLIO_PYTHON || "python", [
    "-c",
    "import fitz,sys;d=fitz.open();[(d.new_page().insert_text((40,80),'Chapter '+str(i+1))) for i in range(3)];d.set_toc([[1,'Chapter 1',1],[1,'Chapter 2',2]]);d.save(sys.argv[1])",
    input,
  ]);
  const store = new LargeFiles(
    path.join(root, "native"),
    process.env.FOLIO_PYTHON || "python",
    async () => saved,
  );
  let browser;
  try {
    const file = await store.register(input);
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.FOLIO_CHROMIUM,
      args: ["--no-sandbox", "--disable-gpu"],
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("http://localhost/**", async (route) => {
      try {
        const req = route.request(),
          u = new URL(req.url());
        let body,
          type = "application/json";
        if (req.method() === "POST") {
          const { method, data } = JSON.parse(req.postData());
          const result =
            method === "info"
              ? await store.info(data)
              : method === "page"
                ? await store.page(data)
                : method === "save"
                  ? await store.save(data)
                  : method === "release"
                    ? await store.release(data)
                    : store.cancel();
          body = JSON.stringify(result ?? true);
        } else if (u.pathname === "/test.html") {
          body =
            '<html><head><link rel="stylesheet" href="/style.css"></head><body></body></html>';
          type = "text/html";
        } else {
          const p = path.resolve(root, "src", "." + u.pathname);
          if (!p.startsWith(path.join(root, "src") + path.sep))
            throw Error("path");
          body = await fs.readFile(p);
          type = p.endsWith(".css") ? "text/css" : "text/javascript";
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
    await page.goto("http://localhost/test.html");
    await page.evaluate(async (f) => {
      const request = async (method, data) => {
        const r = await fetch("/api", {
          method: "POST",
          body: JSON.stringify({ method, data }),
        });
        const v = await r.json();
        if (!r.ok) throw Error(v.error);
        return v;
      };
      window.desktop = {
        largeInfo: (d) => request("info", d),
        largePage: (d) => request("page", d),
        largeSave: (d) => request("save", d),
        largeRelease: (d) => request("release", d),
        largeCancel: () => request("cancel"),
        setDirty: (v) => {
          window.dirty = v;
        },
      };
      const { openLargeWorkspace } = await import("/large-workspace.mjs");
      await openLargeWorkspace(f, {
        originalDirty: false,
        confirmDiscard: async () => true,
        onReady: (w) => (window.workspace = w),
        onClose: () => {
          window.closedWorkspace = true;
        },
      });
    }, file);
    await page.waitForFunction(
      () => document.querySelector("[data-image]")?.naturalWidth > 0,
    );
    await page.locator("[data-list]").selectOption("0");
    await page.locator("[data-title]").fill("Edited chapter");
    await page.locator("[data-update]").click();
    assert.equal(await page.evaluate(() => window.dirty), true);
    await page.locator("[data-save]").click();
    await page.waitForFunction(() =>
      /已保存/.test(document.querySelector("[data-status]").textContent),
    );
    assert.equal(await page.evaluate(() => window.dirty), false);
    await page.locator("[data-rules]").fill("^Chapter");
    await page.locator("[data-scan]").click();
    await page.waitForFunction(
      () => !document.querySelector("[data-apply]").disabled,
    );
    assert.match(await page.locator("[data-preview]").textContent(), /共 3 项/);
    for (const width of [1080, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: path.join(out, `large-ui-${width}.png`) });
      const bounds = await page.locator(".large-workspace").boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
    }
    await page.locator("[data-close]").click();
    await page.waitForFunction(() => window.closedWorkspace);
    assert.deepEqual(errors, []);
    const info = await store.bridge.request({
      command: "large-info",
      input: saved,
    });
    assert.equal(info.outlines[0].title, "Edited chapter");
    console.log(
      "PASS large workspace render, bookmark editing, save, regex preview and close",
    );
  } finally {
    if (browser) await browser.close();
    await store.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

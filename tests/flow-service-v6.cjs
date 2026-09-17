// Exercise the production FlowLayout controller with a headless Chromium adapter.
// Electron BrowserWindow/Windows launch remain a separate platform gate.
const { chromium } = require(
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright",
  ),
  Module = require("module"),
  fs = require("fs"),
  assert = require("assert/strict"),
  path = require("path");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.FOLIO_BROWSER,
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  let prints = 0,
    loaded = 0,
    destroyed = false;
  const old = Module._load;
  class BrowserWindow {
    constructor() {
      this.webContents = {
        session: {
          setPermissionRequestHandler() {},
          webRequest: {
            onBeforeRequest(fn) {
              this.filter = fn;
            },
          },
        },
        setWindowOpenHandler() {},
        loadURL: async (u) => {
          loaded++;
          assert(u.startsWith("file:"));
          await page.goto(u);
        },
        executeJavaScript: async (s) => page.evaluate(s),
        printToPDF: async (o) => {
          prints++;
          assert(o.preferCSSPageSize);
          return page.pdf({
            preferCSSPageSize: true,
            printBackground: o.printBackground,
            pageRanges: o.pageRanges,
            margin: o.margins,
          });
        },
      };
    }
    isDestroyed() {
      return destroyed;
    }
    destroy() {
      destroyed = true;
    }
  }
  Module._load = function (name, ...args) {
    return name === "electron"
      ? { BrowserWindow }
      : old.call(this, name, ...args);
  };
  const { FlowLayout } = require("../flow-layout.cjs"),
    engine = new FlowLayout(path.resolve("native"));
  try {
    const model = JSON.parse(
      fs.readFileSync("tests/output/v6-flow-model.json"),
    );
    const first = await engine.render(model);
    assert(!first.overflow && first.bytes.length > 1000);
    const temp = engine.tempDir;
    assert(fs.existsSync(temp));
    const second = await engine.render({
      ...model,
      text: "修改后中文段落，金额 00123.45。".repeat(8),
    });
    assert(!second.overflow);
    assert.equal(loaded, 1);
    assert.equal(prints, 2);
    const bad = await engine.render({
      ...model,
      frame: { ...model.frame, height: 15 },
    });
    assert(bad.overflow);
    assert.equal(prints, 2);
    await assert.rejects(
      engine.render({ ...model, text: "\u{10ffff}" }),
      /字体未覆盖/,
    );
    fs.writeFileSync(
      "tests/output/v6-service-report.json",
      JSON.stringify(
        {
          coldMs: first.elapsedMs,
          warmMs: second.elapsedMs,
          loads: loaded,
          prints,
          overflowBlocked: true,
          unsupportedGlyphBlocked: true,
          adapter: "Chromium 131, production FlowLayout controller",
        },
        null,
        2,
      ),
    );
    engine.close();
    assert(!fs.existsSync(temp));
    console.log(
      "PASS production flow controller",
      first.elapsedMs,
      second.elapsedMs,
      "ms; loaded once, overflow and missing glyph blocked, temp cleaned",
    );
  } finally {
    engine.close();
    Module._load = old;
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

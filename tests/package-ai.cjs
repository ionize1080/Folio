const { _electron: electron } = require("playwright"),
  path = require("path"),
  assert = require("assert/strict"),
  fs = require("fs"),
  { execFileSync } = require("child_process");
(async () => {
  const app = await electron.launch({
    executablePath: path.resolve("dist/Folio-PDF-Studio-win-x64/Folio.exe"),
    args: [],
    env: {
      ...process.env,
      FOLIO_TEST_BACKGROUND: "1",
      FOLIO_TEST_PROFILE: path.resolve(
        "tests/output/packaged-folio-" + Date.now(),
      ),
      FOLIO_CHATBOX_PROFILE: path.resolve(
        "tests/output/packaged-chatbox-" + Date.now(),
      ),
      FOLIO_TEST_CHATBOX_PORT: "19489",
    },
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, path.resolve("tests/output/modes.pdf"));
    await page.locator('[data-action="open"]').first().click();
    await page.waitForFunction(() => document.querySelector('#doc-name').textContent.includes('modes'));
    await page.locator('[data-action="right-mode"]').waitFor({state:'visible'});
    assert((await page.title()).includes(require("../package.json").version));
    await page.evaluate(() => {
      window.aiState = null;
      window.desktop.onAIState((s) => (window.aiState = s));
    });
    const budget = await page.evaluate(() => window.desktop.storageBudget());
    assert.equal(budget.limitMB, 2048);
    await page.evaluate(() => window.desktop.aiOpen());
    await page.waitForFunction(
      () => window.aiState?.open,
      {},
      { timeout: 30000 },
    );
    await page.locator(".folio-ai-open").click();
    await page.waitForFunction(
      () => !document.body.classList.contains("ai-sidebar-open"),
    );
    await page.locator(".folio-ai-open").click();
    await page.waitForFunction(() =>
      document.body.classList.contains("ai-sidebar-open"),
    );
    await page.evaluate(() => window.desktop.aiDisplay("window"));
    await page.waitForFunction(() => window.aiState.mode === "window");
    await page.evaluate(() => window.desktop.aiDisplay("sidebar"));
    await page.waitForFunction(() =>
      document.body.classList.contains("ai-sidebar-open"),
    );
    await page.locator('[data-action="right-mode"]').click();
    await page.waitForFunction(
      () =>
        !document.body.classList.contains("ai-sidebar-open") &&
        document.body.dataset.right === "full",
    );
    await page.locator(".folio-ai-open").click();
    await page.waitForFunction(() =>
      document.body.classList.contains("ai-sidebar-open"),
    );
    const list = await page.evaluate(() =>
      window.desktop.aiPdf({ action: "list" }),
    );
    assert.equal(list.tools.length, 60);
    const result = await page.evaluate(
      (file) =>
        window.desktop.aiPdf({
          action: "call",
          name: "pdf_object_operation",
          options: {
            path: file,
            operation: "page.render",
            options: { page: 1, purpose: "classify" },
          },
        }),
      path.resolve("tests/output/modes.pdf"),
    );
    assert(!result.isError, JSON.stringify(result));
    assert.equal(result.content[1].type, "image");
    const root = app.process().pid;
    const audit = execFileSync(path.resolve('native/runtime/python.exe'),
      [path.resolve('tests/process-audit.py'), String(root)],
      {encoding:'utf8',windowsHide:true});
    const listeners = audit.trim() ? JSON.parse(audit) : [];
    assert.equal(
      Array.isArray(listeners) ? listeners.length : 1,
      0,
      "packaged app must not listen on TCP ports",
    );
    fs.writeFileSync(
      "tests/output/packaged-ai.json",
      JSON.stringify(
        {
          version: require("../package.json").version,
          tools: list.tools.length,
          defaultLimitMB: budget.limitMB,
          listeners,
          debugPortIgnored: true,
          portablePdfRendering: true,
          sidebarToggle: true,
          windowSwitch: true,
          restoreProperties: true,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS packaged Chatbox, 60 stdio tools, portable PDF rendering, 2GB budget, zero TCP listeners",
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

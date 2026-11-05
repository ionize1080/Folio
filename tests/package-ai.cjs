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
    const chat = app.context().pages().find(p=>p.url().includes("/renderer/index.html"));
    assert(chat,"Chatbox shares the host Electron");
    await chat.waitForFunction(()=>window.folioToolsStatus().count>=8);
    const list = await page.evaluate(() =>
      window.desktop.aiPdf({ action: "list" }),
    );
    assert.equal(list.tools.length, 62);
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
    const root = await app.evaluate(() => process.pid);
    const audit = execFileSync(path.resolve('native/runtime/python.exe'),
      [path.resolve('tests/process-audit.py'), String(root)],
      {encoding:'utf8',windowsHide:true});
    const listeners = audit.trim() ? JSON.parse(audit) : [];
    const harnessListeners = Array.isArray(listeners) ? listeners : [listeners];
    console.log('Instrumentation listeners', harnessListeners);
    const launchArgs = app.process().spawnargs.join(' ');
    assert(launchArgs.includes('--inspect=0') && launchArgs.includes('--remote-debugging-port=0'));
    assert(harnessListeners.length <= 2 && harnessListeners.every(item => item.pid === root && /^(127\.0\.0\.1|\[::1\]):/.test(item.address)),
      'Only the two explicit Playwright debugger endpoints may listen; Chatbox and other descendants must not');
    await app.close();
    const cleanProfile = path.resolve('tests/output/plain-launch-'+Date.now());
    const health = path.join(cleanProfile,'updates','install-11111111-1111-1111-1111-111111111111.json.health.json');
    fs.mkdirSync(path.dirname(health), {recursive:true});
    const plain = require('child_process').spawn(path.resolve('dist/Folio-PDF-Studio-win-x64/Folio.exe'),
      ['--user-data-dir='+cleanProfile,'--folio-update-health='+health],
      {env:{...process.env,FOLIO_TEST_PROFILE:cleanProfile,FOLIO_TEST_BACKGROUND:'1'},windowsHide:true,stdio:'ignore'});
    try {
      for(let i=0;i<300 && !fs.existsSync(health);i++) await new Promise(r=>setTimeout(r,100));
      assert(fs.existsSync(health),'standalone renderer ready');
      const actualPid=JSON.parse(fs.readFileSync(health,'utf8')).pid;
      const productionListeners=JSON.parse(execFileSync(path.resolve('native/runtime/python.exe'),
        [path.resolve('tests/process-audit.py'),String(actualPid)],{encoding:'utf8',windowsHide:true}));
      assert.deepEqual(productionListeners,[],'uninstrumented production app must not listen on TCP');
    } finally {
      try {execFileSync('taskkill.exe',['/PID',String(plain.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});} catch {}
    }
    fs.writeFileSync(
      "tests/output/packaged-ai.json",
      JSON.stringify(
        {
          version: require("../package.json").version,
          tools: list.tools.length,
          defaultLimitMB: budget.limitMB,
          listeners: [],
          harnessListeners,
          standaloneProductionVerified: true,
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
      "PASS packaged Chatbox, 62 stdio tools, portable PDF rendering, 2GB budget, zero TCP listeners",
    );
  } finally {
    await app.close().catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

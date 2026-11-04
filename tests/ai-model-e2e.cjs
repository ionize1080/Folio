const { _electron: electron, chromium } = require("playwright"),
  path = require("path"),
  fs = require("fs"),
  assert = require("assert/strict");
(async () => {
  const app = await electron.launch({
    args: [path.resolve(".")],
    env: {
      ...process.env,
      FOLIO_TEST_BACKGROUND: "1",
      FOLIO_TEST_PROFILE: path.resolve("tests/output/folio-e2e-" + Date.now()),
      FOLIO_TEST_CHATBOX_PORT: "19483",
      FOLIO_CHATBOX_PROFILE: path.resolve("tests/output/chatbox-e2e-profile"),
    },
    timeout: 60000,
  });
  let browser;
  try {
    const folio = await app.firstWindow();
    await folio.waitForLoadState("domcontentloaded");
    folio.on("dialog", (d) => d.accept());
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, path.resolve("tests/output/modes.pdf"));
    await folio.locator('[data-action="open"]').first().click();
    await folio.waitForFunction(() =>
      document.querySelector("#doc-name").textContent.includes("modes"),
    );
    await folio.locator('[data-action="settings"]').click();
    await folio.locator("#set-ai-approval").selectOption("auto");
    await folio.locator("#modal-footer .primary").click();
    await folio.evaluate(() => window.desktop.aiOpen());
    for (let i = 0; i < 30; i++) {
      try {
        browser = await chromium.connectOverCDP("http://localhost:19483");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    assert(browser);
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes("/renderer/index.html"));
    console.log(
      "pages",
      browser
        .contexts()[0]
        .pages()
        .map((p) => p.url()),
    );
    assert(page);
    await page.waitForFunction(() => !!window.electronAPI?.invoke, {
      timeout: 20000,
    });
    await page.waitForTimeout(2000);
    const key = fs
      .readFileSync("D:/APP/API/qwen-plan.txt", "utf8")
      .trim()
      .replace(/^\uFEFF/, "");
    await page.evaluate(async (key) => {
      const s = await window.electronAPI.invoke("getSettings");
      s.language = "en";
      s.messageLayout = "left";
      s.providers["folio-qwen"].apiKey = key;
      await window.electronAPI.invoke(
        "setStoreValue",
        "settings",
        JSON.stringify(s),
      );
    }, key);
    await page.reload();
    await page.waitForFunction(() => !!window.electronAPI?.invoke);
    await page.waitForTimeout(3000);
    await page.keyboard.press("Control+n");
    await page.waitForTimeout(900);
    await page
      .locator("textarea[placeholder]")
      .first()
      .fill(
        "Use the Folio MCP tools. First query folio_help. Read the current document revision. Create one bookmark titled AI-E2E-PASS targeting page 2. Then obtain a classify image of page 1 and report the large heading visible in that image. Do not use OCR or page.text; inspect the image itself. Do not ask me questions.",
      );
    await page.locator("textarea[placeholder]").first().press("Enter");
    for (let i = 0; i < 90; i++) {
      const body = await page.locator("body").innerText();
      if (i % 10 === 0) console.log("progress", body.slice(-700));
      if (
        body.includes("Folio test page 1") &&
        (await folio.getByText("AI-E2E-PASS", { exact: true }).count())
      )
        break;
      await page.waitForTimeout(1000);
    }
    const result = await page.locator("body").innerText();
    fs.writeFileSync("tests/output/ai-e2e-result.txt", result);
    assert(
      await folio.getByText("AI-E2E-PASS", { exact: true }).count(),
      "model bookmark creation",
    );
    assert(result.includes("Folio test page 1"), "model image interpretation");
    console.log("PASS real model + MCP + bookmark + image");
    await page.screenshot({ path: "tests/output/chatbox-e2e.png" });
    await folio.evaluate(() => window.desktop.setDirty(false));
  } finally {
    try {
      const w = await app.firstWindow();
      await w.evaluate(() => window.desktop.setDirty(false));
    } catch {}
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

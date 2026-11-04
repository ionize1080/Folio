const { _electron: electron } = require("playwright"),
  path = require("path"),
  assert = require("assert/strict");
(async () => {
  const app = await electron.launch({
    args: [path.resolve(".")],
    env: {
      ...process.env,
      FOLIO_TEST_BACKGROUND: "1",
      FOLIO_TEST_PROFILE: path.resolve(
        "tests/output/integration-" + Date.now(),
      ),
    },
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(700);
    let dialogs = 0,
      acceptDialogs = true;
    page.on("dialog", (d) => {
      dialogs++;
      return acceptDialogs ? d.accept() : d.dismiss();
    });
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, path.resolve("tests/output/modes.pdf"));
    await page.locator('[data-action="open"]').first().click();
    await page.waitForFunction(() =>
      document.querySelector("#doc-name").textContent.includes("modes"),
    );
    await page.waitForTimeout(1000);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("ai-reply");
      ipcMain.handle("ai-reply", (_e, v) => {
        globalThis.aiResult = v;
      });
    });
    let id = 0;
    async function call(name, args) {
      const current = ++id;
      await app.evaluate(
        ({ BrowserWindow }, { current, name, args }) => {
          globalThis.aiResult = null;
          BrowserWindow.getAllWindows()[0].webContents.send("ai-request", {
            id: current,
            params: { name, arguments: args },
          });
        },
        { current, name, args },
      );
      let result;
      for (let n = 0; n < 1200; n++) {
        result = await app.evaluate(() => globalThis.aiResult);
        if (result) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert(result, "response timeout");
      return result;
    }
    let d = await call("folio_operation", { operation: "document.describe" });
    assert(!d.error, d.error);
    console.log("describe", d.result);
    acceptDialogs = false;
    let refused = await call("folio_operation", {
      operation: "bookmark.create",
      revision: d.result.revision,
      options: { title: "must not be created", page: 1 },
    });
    assert(refused.error?.includes("拒绝"));
    const unchanged = await call("folio_operation", {
      operation: "document.describe",
    });
    assert.equal(unchanged.result.revision, d.result.revision);
    acceptDialogs = true;
    const beforeApproval = dialogs;
    await page.locator('[data-action="settings"]').click();
    await page.locator("#set-ai-approval").selectOption("auto");
    await page.locator("#modal-footer .primary").click();
    assert.equal(
      dialogs - beforeApproval,
      2,
      "automatic approval must confirm twice",
    );
    assert.equal(
      await page.locator(".folio-ai-open").evaluate((e) => e.style.color),
      "rgb(215, 25, 32)",
    );
    let r = await call("folio_operation", {
      operation: "bookmark.create",
      revision: d.result.revision,
      options: { title: "AI test", page: 1 },
    });
    assert(r.result?.applied, r.error);
    assert.equal(
      dialogs - beforeApproval,
      2,
      "automatic execution must not ask again",
    );
    const revision = r.result.revision;
    console.log("create applied");
    r = await call("folio_operation", {
      operation: "bookmark.create",
      revision: d.result.revision,
      options: { title: "stale", page: 1 },
    });
    assert(r.error?.includes("版本"));
    console.log("stale rejected");
    r = await call("folio_operation", {
      operation: "page.image",
      revision,
      options: { page: 1, purpose: "classify" },
    });
    assert(r.result?.content?.[1]?.type === "image", r.error);
    console.log("image", JSON.parse(r.result.content[0].text));
    r = await call("pdf_help", {});
    assert(!r.error, r.error);
    console.log("upstream tools", r.result.length);
    assert(r.result.length >= 50);
    await page.screenshot({ path: "tests/output/ai-integration.png" });
    await page.evaluate(() => window.desktop.setDirty(false));
  } finally {
    try {
      const w = await app.firstWindow();
      await w.evaluate(() => window.desktop.setDirty(false));
    } catch {}
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

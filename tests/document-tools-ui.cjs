const { _electron } = require("playwright"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
(async () => {
  let app;
  try {
    app = await _electron.launch({
      args: [path.resolve(".")],
      env: {
        ...process.env,
        FOLIO_TEST_BACKGROUND: "1",
        FOLIO_TEST_PROFILE: path.resolve(
          "tests/output/utilities-ui-" + Date.now(),
        ),
      },
      timeout: 60000,
    });
    const p = await app.firstWindow();
    p.setDefaultTimeout(60000);
    await p.waitForSelector("#document-utilities", { state: "attached" });
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, path.resolve("tests/output/utilities-source.pdf"));
    await p.locator('[data-action="open"]').first().click();
    await p.waitForFunction(() =>
      document
        .querySelector("#doc-name")
        .textContent.includes("utilities-source"),
    );
    await p.waitForSelector("#busy", { state: "hidden" });
    await p.locator(".more-tools summary").click();
    await p.locator("#document-utilities").click();
    await p.waitForFunction(
      () => !document.querySelector(".document-tools [data-run]").disabled,
    );
    await p.locator(".document-tools [data-run]").click();
    await p.waitForFunction(
      () =>
        document.querySelector(".document-tools [data-status]").textContent ===
        "读取完成",
    );
    await p
      .locator('.document-tools nav [data-utility-action="metadata"]')
      .click();
    assert.equal(await p.locator('input[data-key="Producer"]').count(), 1);
    const png = await app.evaluate(async ({BrowserWindow}) => {
      const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {stayHidden:true,stayAwake:true});
      if(image.isEmpty()) throw Error('Empty document tools capture');
      return image.toPNG().toString('base64');
    });
    fs.writeFileSync('tests/output/document-tools-ui.png', Buffer.from(png,'base64'));
    for (const width of [800, 1080, 1500]) {
      await app.evaluate(
        ({ BrowserWindow }, w) =>
          BrowserWindow.getAllWindows()[0].setSize(w, 850),
        width,
      );
      assert(
        await p
          .locator(".document-tools")
          .evaluate((e) => e.scrollWidth <= e.clientWidth),
      );
    }
    await p.keyboard.press("Escape");
    assert.equal(await p.locator(".document-tools").count(), 0);
    fs.writeFileSync(
      "tests/output/document-tools-ui.json",
      JSON.stringify({ status: "passed", widths: [800, 1080, 1500] }),
    );
    console.log("PASS native bridge and document tools UI");
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

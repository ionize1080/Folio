const { _electron } = require("playwright"),
  path = require("node:path"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  let app;
  const stamp = Date.now(),
    output = path.resolve("tests/output/live-utilities-" + stamp + ".pdf");
  try {
    app = await _electron.launch({
      args: [path.resolve(".")],
      env: {
        ...process.env,
        FOLIO_TEST_BACKGROUND: "1",
        FOLIO_TEST_PROFILE: path.resolve("tests/output/utility-live-" + stamp),
        FOLIO_CHATBOX_PROFILE: path.resolve(
          "tests/output/utility-chat-" + stamp,
        ),
      },
      timeout: 60000,
    });
    const host = await app.firstWindow();
    host.on("dialog", (d) => d.accept());
    await host.waitForSelector(".folio-ai-open");
    await app.evaluate(
      ({ dialog }, files) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [files.input],
        });
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: files.output,
        });
      },
      { input: path.resolve("tests/output/utilities-source.pdf"), output },
    );
    await host.locator('[data-action="open"]').first().click();
    await host.waitForFunction(() =>
      document
        .querySelector("#doc-name")
        .textContent.includes("utilities-source"),
    );
    await host.evaluate(() => window.desktop.aiApproval(true));
    await host.evaluate(() => window.desktop.aiOpen());
    const chat = app
      .context()
      .pages()
      .find((p) => p.url().includes("/renderer/index.html"));
    await chat.waitForSelector("textarea[placeholder]");
    const model = await require("./ai-live-support.cjs").configure(chat);
    const before = await chat.evaluate(
      () => window.folioProgress.status().completed,
    );
    await chat
      .locator("textarea[placeholder]")
      .first()
      .fill(
        "这是自动化验收样本。请用 folio_document 获取当前 revision，然后通过 folio_document_utilities 的 metadata 操作，将当前 PDF 的 Creator 设置为 Folio live creator、Producer 设置为 Folio live producer、CustomTest 设置为 live-verified。只修改这三个元数据字段并另存一个副本。不要调用其他 PDF 文件工具。保存成功后简短汇报并停止。",
      );
    await chat.locator("textarea[placeholder]").first().press("Enter");
    await chat.waitForFunction(
      (n) => window.folioProgress.status().completed > n,
      before,
      { timeout: 180000 },
    );
    assert(fs.existsSync(output), "Live tool must produce a saved PDF");
    const { execFileSync } = require("node:child_process");
    execFileSync(path.resolve("native/runtime/python.exe"), [
      "-c",
      "import sys,pikepdf; p=pikepdf.open(sys.argv[1]); assert str(p.docinfo['/Creator'])=='Folio live creator'; assert str(p.docinfo['/Producer'])=='Folio live producer'; assert str(p.docinfo['/CustomTest'])=='live-verified'",
      output,
    ]);
    fs.writeFileSync(
      "tests/output/document-live-report.json",
      JSON.stringify(
        {
          status: "passed",
          model,
          output,
          verifiedFields: ["Creator", "Producer", "CustomTest"],
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS real API metadata tool and independently reopened output",
    );
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

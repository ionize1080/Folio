const { _electron: electron } = require("playwright");
const path = require("path"),
  assert = require("assert/strict"),
  fs = require("fs");
(async () => {
  const profile = path.resolve("tests/output/ai-settings-" + Date.now());
  const app = await electron.launch({
    args: [path.resolve(".")],
    env: {
      ...process.env,
      FOLIO_TEST_BACKGROUND: "1",
      FOLIO_TEST_PROFILE: profile,
    },
    timeout: 60000,
  });
  try {
    const p = await app.firstWindow();
    await p.waitForLoadState("domcontentloaded");
    let prompts = 0;
    p.on("dialog", async (d) => {
      prompts++;
      await d.accept();
    });
    assert.equal(await p.locator(".folio-ai-open").count(), 1);
    assert.equal(await p.locator(".folio-ai-approval").count(), 0);
    for (const language of ["en", "zh-Hans", "zh-Hant"])
      for (const width of [1080, 1250]) {
        await p.locator("#language-select").selectOption(language);
        await app.evaluate(
          ({ BrowserWindow }, width) =>
            BrowserWindow.getAllWindows()[0].setSize(width, 800),
          width,
        );
        await p.locator('[data-action="settings"]').click();
        await p.locator("#set-ai-threshold").waitFor();
        assert.equal(await p.locator("#set-ai-threshold").inputValue(), "95");
        assert.equal(await p.locator("#set-disk-budget").inputValue(), "2048");
        await p
          .locator("#set-theme")
          .selectOption(width === 1080 ? "dark" : "light");
        await p.locator("#modal-footer .primary").click();
        const geometry = await p.locator(".folio-ai-open").evaluate((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, right: r.right, width: innerWidth, h: r.height };
        });
        assert(
          geometry.x >= 0 && geometry.right <= geometry.width,
          JSON.stringify(geometry),
        );
      }
    await p.locator('[data-action="settings"]').click();
    await p.locator("#set-ai-threshold").fill("90");
    await p.locator("#set-disk-budget").fill("3072");
    await p.locator("#set-ai-approval").selectOption("auto");
    await p.locator("#modal-footer .primary").click();
    assert.equal(prompts, 2);
    assert.equal(
      await p.locator(".folio-ai-open").evaluate((e) => e.style.color),
      "",
    );
    await p.reload();
    await p.waitForLoadState("domcontentloaded");
    await p.locator('[data-action="settings"]').click();
    assert.equal(await p.locator("#set-ai-threshold").inputValue(), "90");
    assert.equal(await p.locator("#set-disk-budget").inputValue(), "3072");
    assert.equal(await p.locator("#set-ai-approval").inputValue(), "manual");
    fs.writeFileSync(
      "tests/output/ai-settings.json",
      JSON.stringify(
        {
          languages: 3,
          widths: [1080, 1250],
          themes: ["light", "dark"],
          toolbarAIButtons: 1,
          thresholdPersisted: true,
          storagePersisted: true,
          approvalSessionOnly: true,
          doubleConfirmation: prompts,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS compact toolbar, settings, persistence, approvals, three languages and both themes",
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

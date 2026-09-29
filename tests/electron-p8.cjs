// Actual packaged EXE, real input events/native workers/save/reopen; no renderer internals.
const { _electron } = require("playwright"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output"),
  checks = [],
  errors = [];
(async () => {
  assert.equal(process.platform, "win32");
  assert(process.env.FOLIO_EXE);
  const app = await _electron.launch({
    executablePath: process.env.FOLIO_EXE,
    args: [],
    timeout: 60000,
  });
  let page;
  try {
    page = await app.firstWindow();
    // Each EXE suite starts with clean test storage, including recovery drafts.
    await app.evaluate(async ({ session }) => session.defaultSession.clearStorageData());
    await page.reload();

    page.setDefaultTimeout(60000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector('[data-action="open"]');
    await page.evaluate(() =>
      localStorage.setItem(
        "folio-settings",
        JSON.stringify({ saveSummary: false }),
      ),
    );
    await page.reload();
    async function open(file) {
      await page.evaluate(() => window.desktop.setDirty(false));
      await page.reload();
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      }, file);
      await page.locator('[data-action="open"]').first().click();
      await page.waitForSelector("body.has-document");
    }
    async function save(name) {
      const file = path.join(out, name);
      fs.rmSync(file, { force: true });
      await app.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: file,
        });
      }, file);
      await page.locator('[data-action="save"]').click();
      await page.waitForFunction(
        (expected) =>
          document.querySelector("#busy").hidden &&
          document.querySelector("#doc-name").textContent === expected &&
          !document.querySelector("#dirty-dot").classList.contains("changed"),
        name,
      );
      assert(fs.statSync(file).size > 100);
      return file;
    }
    const stable = () =>
      page.waitForFunction(
        () => /完成/.test(document.querySelector("#pe-status")?.textContent),
        null,
        { timeout: 60000 },
      );
    await open(path.join(out, "p7-shared.pdf"));
    await page.locator('[data-action="flow-edit"]').click();
    await page.locator(".page-edit-hit:not(.unavailable)").first().click();
    await stable();
    const position = () =>
      page
        .locator("[data-frame]")
        .evaluateAll((es) =>
          Object.fromEntries(es.map((e) => [e.dataset.frame, +e.value])),
        );
    const move = page.locator(".page-edit-move"),
      initial = await position();
    await move.focus();
    await page.keyboard.press("ArrowRight");
    await stable();
    let pos = await position();
    assert(Math.abs(pos.x - initial.x - 1) < 0.05);
    assert(Math.abs(pos.y - initial.y) < 0.05);
    await move.focus();
    await page.keyboard.press("Shift+ArrowDown");
    await stable();
    pos = await position();
    assert(Math.abs(pos.y - initial.y - 10) < 0.05);
    let rect = await move.boundingBox();
    const before = await position();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.keyboard.down("Shift");
    await page.mouse.down();
    await page.mouse.move(
      rect.x + rect.width / 2 + 45,
      rect.y + rect.height / 2 + 8,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await stable();
    pos = await position();
    assert(pos.x > before.x);
    assert(Math.abs(pos.y - before.y) < 0.05);
    const input = page.locator(".page-edit-input");
    await input.focus();
    const beforeTyping = await position();
    await page.keyboard.press("ArrowLeft");
    assert.deepEqual(await position(), beforeTyping);
    await page.screenshot({ path: path.join(out, "p8-movement.png") });
    await page.locator("#pe-done").click();
    await page.waitForFunction(
      () => !document.body.classList.contains("page-edit-mode"),
    );
    const moved = await save("p8-movement-saved.pdf");
    const inspect = async (file, p = 1) =>
      page.evaluate(
        async ({ data, p }) =>
          window.desktop.native({
            command: "inspect",
            bytes: new Uint8Array(data),
            page: p,
          }),
        { data: Array.from(fs.readFileSync(file)), p },
      );
    assert(
      (await inspect(moved, 2)).objects.some((o) => o.text === "Shared 2026"),
    );
    checks.push(
      "EXE: 1pt nudge, Shift 10pt, axis-constrained drag, typing arrows do not move frame, saved sibling intact",
    );
    await open(path.join(out, "p8-scan.pdf"));
    await page.locator(".more-tools > summary").click();
    await page.locator('[data-action="edit-content"]').click();
    await page.locator("#object-select").selectOption("0");
    await page.waitForFunction(() =>
      /预览已更新/.test(document.querySelector("[data-status]")?.textContent),
    );
    await page.locator("[data-preset]").selectOption("scan-color");
    await page.locator('[data-adjust="contrast"]').fill("22");
    await page.locator('[data-adjust="blur"]').fill("0.5");
    await page.locator('[data-adjust="sharpen"]').fill("80");
    const curve = page.locator("[data-curve]");
    await curve.scrollIntoViewIfNeeded();
    const box = await curve.boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
    await page.locator("[data-curve-y]").fill("160");
    await page.locator("[data-curve-y]").press("Tab");
    await page.waitForTimeout(350);
    await page.waitForFunction(() =>
      /预览已更新/.test(document.querySelector("[data-status]")?.textContent),
    );
    await page.locator("[data-original]").check();
    assert(await page.locator("[data-original]").isChecked());
    await page.locator("[data-original]").uncheck();
    await page.screenshot({ path: path.join(out, "p8-image-light.png") });
    // Theme is tested via the real setting persisted on reload, then reopen editor.
    await page.locator("#object-apply").click();
    await page.waitForFunction(() => !document.querySelector("#modal").open);
    const adjusted = await save("p8-image-saved.pdf");
    const siblingOriginal = await inspect(path.join(out, "p8-scan.pdf"), 2),
      siblingSaved = await inspect(adjusted, 2);
    assert.deepEqual(
      siblingSaved.objects.map((o) => o.signature),
      siblingOriginal.objects.map((o) => o.signature),
    );
    await page.locator('[data-action="undo"]').click();
    await page.waitForFunction(() => document.querySelector("#busy").hidden);
    await page.locator('[data-action="redo"]').click();
    await page.waitForFunction(() => document.querySelector("#busy").hidden);
    await open(adjusted);
    await page.locator('[data-action="theme"]').click();
    await page.locator(".more-tools > summary").click();
    await page.locator('[data-action="edit-content"]').click();
    await page.locator("#object-select").selectOption("0");
    await page.waitForFunction(() =>
      /预览已更新/.test(document.querySelector("[data-status]")?.textContent),
    );
    await page.screenshot({ path: path.join(out, "p8-image-dark.png") });
    await page.locator("[data-reset]").click();
    await page.locator('[data-adjust="contrast"]').fill("-10");
    await page.locator("#object-apply").click();
    await page.waitForFunction(() => !document.querySelector("#modal").open);
    await save("p8-image-reedited.pdf");
    checks.push(
      "EXE: image selection, scan preset, contrast/blur/sharpen/curve, original comparison, apply/undo/redo, save/reopen/re-edit, light/dark screenshots",
    );
    assert.deepEqual(errors, []);
    const exe = await app.evaluate(() => process.execPath),
      hash = (p) =>
        crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    fs.writeFileSync(
      path.join(out, "p8-electron-report.json"),
      JSON.stringify(
        {
          platform: process.platform,
          checks,
          errors,
          exe_sha256: hash(exe),
          asar_sha256: hash(path.join(path.dirname(exe), "resources/app.asar")),
        },
        null,
        2,
      ),
    );
    console.log(checks);
  } catch (e) {
    await page
      ?.screenshot({ path: path.join(out, "p8-electron-failure.png") })
      .catch(() => {});
    console.error(
      await page
        ?.locator("body")
        .innerText()
        .catch(() => ""),
    );
    throw e;
  } finally {
    await page?.evaluate(() => window.desktop?.setDirty(false)).catch(() => {});
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

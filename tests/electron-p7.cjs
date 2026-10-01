// Acceptance uses the packaged Windows EXE, its real native workers and dialogs.
const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output");
const checks = [],
  errors = [],
  fontResults = [];
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
    await page.evaluate(() => localStorage.setItem("folio-language", "zh-Hans"));
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
    const stable = () =>
      page.waitForFunction(
        () => /完成/.test(document.querySelector("#pe-status")?.textContent),
        null,
        { timeout: 60000 },
      );
    const open = async (file, label) => {
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
      await page.locator('[data-action="flow-edit"]').click();
      const hits = page.locator(".page-edit-hit:not(.unavailable)");
      await hits.first().waitFor();
      const labels = await hits.evaluateAll((es) =>
        es.map((e) => e.getAttribute("aria-label") || ""),
      );
      const index = label
        ? labels.findIndex((t) => t.includes(label))
        : labels.findIndex((t) => t.length > 40);
      assert(index >= 0, "editable target missing " + label);
      await hits.nth(index).click();
      await stable();
    };
    const save = async (name) => {
      const file = path.join(out, name);
      fs.rmSync(file, { force: true });
      await app.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: file,
        });
      }, file);
      await page.locator("#pe-done").click();
      await page.waitForFunction(
        () => !document.body.classList.contains("page-edit-mode"),
      );
      await page.locator('[data-action="save"]').click();
      await page.waitForFunction(
        (expected) =>
          document.querySelector("#busy").hidden &&
          document.querySelector("#doc-name").textContent === expected &&
          !document.querySelector("#dirty-dot").classList.contains("changed"),
        path.basename(file),
      );
      assert(fs.statSync(file).size > 100);
      return file;
    };
    await open(path.join(out, "p7-shared.pdf"), "Shared 2026");
    const input = page.locator(".page-edit-input");
    assert.equal((await input.inputValue()).trim(), "Shared 2026");
    await input.evaluate((e) => e.setSelectionRange(10, 11));
    await page.keyboard.insertText("5");
    await stable();
    assert.equal((await input.inputValue()).trim(), "Shared 2025");
    await input.press("Control+z");
    await stable();
    assert.equal((await input.inputValue()).trim(), "Shared 2026");
    await input.evaluate((e) => e.setSelectionRange(10, 11));
    await page.keyboard.insertText("5");
    await stable();
    await page.screenshot({path: path.join(out, "p7-electron-shared.png")});
    const file = await save("p7-electron-shared-saved.pdf");
    await open(file, "Shared 2025");
    assert.equal((await input.inputValue()).trim(), "Shared 2025");
    const inspected = await page.evaluate(async(bytes) => window.desktop.native({
      command:"inspect",bytes:new Uint8Array(bytes),page:1
    }),Array.from(fs.readFileSync(file)));
    // Inspect carries explicit nonpainting spaces on the preceding painted
    // object as well. Raw object concatenation would double-count that space;
    // verify the reopened paragraph model and independent PDF text engines.
    const {pageCandidates}=await import(require('node:url').pathToFileURL(path.join(root,'src/flow-page-model.mjs')).href);
    assert.deepEqual(pageCandidates(inspected.objects,...inspected.size,[],inspected.tables)
      .map(c=>c.model.text).sort(),['Shared 2025','Shared 2026']);
    require('node:child_process').execFileSync(process.env.FOLIO_PYTHON || 'python', ['-c',
      "import sys,fitz,pypdfium2 as p; f=sys.argv[1]; a=fitz.open(f); b=p.PdfDocument(f); texts=[[x.get_text() for x in a],[x.get_textpage().get_text_range() for x in b]]; assert all(t[0].count('Shared 2025')==1 and t[0].count('Shared 2026')==1 and t[1].strip()=='Shared 2026' for t in texts), texts", file], {stdio:'pipe'});
    const untouched = await page.evaluate(async(bytes) => window.desktop.native({
      command:"inspect",bytes:new Uint8Array(bytes),page:2
    }),Array.from(fs.readFileSync(file)));
    assert(untouched.objects.some(o=>o.text==='Shared 2026'));
    checks.push('Packaged Windows EXE opens shared Form text, accepts a digit edit, undoes, saves and reopens; sibling and second-page text remain unchanged');
    assert.deepEqual(errors, []);
    const exe = await app.evaluate(() => process.execPath),
      hash = (p) =>
        crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    const report = {
      platform: process.platform,
      checks,
      errors,
      fontResults,
      exe_sha256: hash(exe),
      asar_sha256: hash(path.join(path.dirname(exe), "resources/app.asar")),
    };
    fs.writeFileSync(
      path.join(out, "p7-electron-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } catch (e) {
    if (page) {
      console.error(
        await page
          .locator("body")
          .innerText()
          .catch(() => ""),
      );
      await page
        .screenshot({ path: path.join(out, "p7-electron-failure.png") })
        .catch(() => {});
    }
    throw e;
  } finally {
    await page?.evaluate(() => window.desktop?.setDirty(false)).catch(() => {});
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

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
    const inventory = JSON.parse(
      fs.readFileSync(path.join(out, "p6/inventory.json"), "utf8"),
    );
    const seen = new Set();
    for (const doc of inventory) {
      for (let pn = 1; pn <= 5; pn++) {
        const inspected = JSON.parse(
          fs.readFileSync(
            path.join(out, `p6/${doc.id}-${pn}-inspect.json`),
            "utf8",
          ),
        );
        for (const font of Object.values(inspected.fonts)) {
          if (!font.fontKey || seen.has(font.fontKey)) continue;
          seen.add(font.fontKey);
          console.log('Checking font', doc.id, pn, font.fontName, font.fontKey);
          // Font keys are content-addressed and shared by the inspect/layout workers.
          const result = await page.evaluate(async (key) => {
            const f = await window.desktop.native({
              command: "font-fast",
              fontKey: key,
            });
            const face = await new FontFace(
              "P6_" + key,
              Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)),
            ).load();
            return {
              key,
              name: f.name,
              status: face.status,
              advances: Object.keys(f.advances || {}).length,
            };
          }, font.fontKey);
          assert.equal(result.status, "loaded");
          assert(result.advances > 0);
          fontResults.push(result);
        }
      }
    }
    checks.push(
      `Chromium loads ${fontResults.length} restored embedded faces from all 50 public pages, including raw CID CFF, truncated Type1, MingLiU and missing-name TrueType`,
    );
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
    await open(path.join(out, "p6-overflow.pdf"), "Keep editing");
    const input = page.locator(".page-edit-input"),
      original = await input.inputValue();
    const barHeight = await page
      .locator(".page-edit-bar")
      .evaluate((e) => e.getBoundingClientRect().height);
    const long = original + "\n" + "Editing note 2026. ".repeat(70);
    await app.evaluate(
      ({ clipboard }, text) => clipboard.writeText(text),
      long,
    );
    await input.press("Control+a");
    await input.press("Control+v");
    await stable();
    await page.waitForFunction(
      () =>
        !document.querySelector("#pe-warning-summary").hidden &&
        /页外/.test(document.querySelector("#pe-warning-summary").textContent),
    );
    assert(await input.isEnabled());
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(
      await page
        .locator(".page-edit-bar")
        .evaluate((e) => e.getBoundingClientRect().height),
      barHeight,
    );
    assert.equal(
      await page
        .locator(".page-edit-layer")
        .evaluate((e) => getComputedStyle(e.parentElement).overflow),
      "visible",
    );
    await input.press("Control+End");
    await page.keyboard.insertText("TAIL42");
    await stable();
    assert.equal(await input.inputValue(), long + "TAIL42");
    assert.equal(await page.locator("#page-number").inputValue(), "1");
    assert.equal(
      await page.locator(".page-edit-caret").evaluate((e) => e.hidden),
      false,
    );
    await page.screenshot({ path: path.join(out, "p6-electron-overflow.png") });
    const saved = await save("p6-electron-overflow-saved.pdf");
    assert(await page.locator("#document-preflight").isVisible());
    const inspected = await page.evaluate(
      async (bytes) =>
        window.desktop.native({
          command: "inspect",
          bytes: new Uint8Array(bytes),
          page: 1,
        }),
      Array.from(fs.readFileSync(saved)),
    );
    const text = inspected.objects
      .filter((o) => o.type === "text")
      .map((o) => o.text)
      .join("");
    assert(text.includes("TAIL42"), "overset text was truncated during export");
    checks.push(
      "Overflow/collision status never opens a blocking dialog, shifts toolbar, disables input or loses caret; continued typing and save preserve the final outside-page text",
    );
    await open(path.join(out, "p6-crop.pdf"), "Crop 2026 test");
    assert.equal((await input.inputValue()).trim(), "Crop 2026 test");
    await input.evaluate((e) => e.setSelectionRange(5, 6));
    await page.keyboard.insertText("9");
    await stable();
    const cropped = await save("p6-electron-crop-saved.pdf");
    await open(cropped, "Crop 9026 test");
    checks.push(
      "Nonzero CropBox hit testing, one-character edit, save and reopen retain the correct text",
    );
    for (const id of ["hsbc-en", "hsbc-zh"]) {
      const doc = inventory.find((x) => x.id === id);
      await open(doc.path);
      const before = await input.inputValue();
      await input.evaluate((e) => e.setSelectionRange(0, 1));
      await page.keyboard.insertText("9");
      await stable();
      const final = "9" + before.slice(1);
      assert.equal(await input.inputValue(), final);
      const file = await save(`p6-electron-${id}-saved.pdf`);
      await open(file, final.slice(0, 20));
      // PDF readers may omit a trailing space at a physical line boundary.
      // Preserve every other character, internal space and line break exactly.
      const lineText = (s) => s.replace(/[ \t]+(?=\r?\n|$)/g, "");
      assert.equal(lineText(await input.inputValue()), lineText(final));
    }
    checks.push(
      "English and Chinese annual reports accept ordinary edits and preserve editable text after actual file save/reopen",
    );
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
      path.join(out, "p6-electron-report.json"),
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
        .screenshot({ path: path.join(out, "p6-electron-failure.png") })
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

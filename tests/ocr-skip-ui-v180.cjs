const { _electron } = require("playwright");
const fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output/ocr-skip-v180");
fs.mkdirSync(out, { recursive: true });
let app, page;
const errors = [],
  checks = [];
(async () => {
  try {
    app = await _electron.launch({
      executablePath: process.env.FOLIO_EXE,
      args: [
        ...(process.env.FOLIO_EXE ? [] : [root]),
        "--user-data-dir=" + path.join(out, "profile-" + Date.now()),
      ],
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(180000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector("#language-select");
    await page.locator("#language-select").selectOption("zh-Hans");
    const bytes = await page.evaluate(async () => {
      const { PDFDocument } = await import("./vendor/pdf-lib.js");
      const d = await PDFDocument.create();
      d.addPage([600, 800]);
      return Array.from(await d.save());
    });
    const input = path.join(out, "input.pdf"),
      saved = path.join(out, "saved.pdf");
    fs.writeFileSync(input, Buffer.from(bytes));
    async function open(file) {
      await app.evaluate(({ dialog }, f) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [f],
        });
      }, file);
      await page.locator("[data-action=open]").first().click();
      await page.waitForFunction(
        (n) =>
          document.querySelector("#doc-name").textContent === n &&
          document.querySelector("#busy").hidden,
        path.basename(file),
      );
    }
    await open(input);
    await page.evaluate(async () => {
      window.__S = (await import("./app.mjs")).S;
      window.__S.ocr = Array.from({ length: 12 }, (_, i) => ({
        id: "skip-" + i,
        page: 1,
        text: "Review line " + i,
        confidence: 0.4,
        needsReview: true,
        quad: [
          [40, 740 - i * 30],
          [240, 740 - i * 30],
          [240, 720 - i * 30],
          [40, 720 - i * 30],
        ],
      }));
    });
    await page.locator("[data-action=ocr]").first().click();
    await page.waitForSelector("#ocr-skip-review");
    await page.locator("#ocr-apply").click();
    await page.waitForFunction(
      () => !document.querySelector("#ocr-apply").disabled,
    );
    assert(await page.locator("#modal").evaluate((e) => e.open));
    await page.screenshot({ path: path.join(out, "review.png") });
    await page.locator("#ocr-skip-review").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("#modal").open &&
        document.querySelector("#busy").hidden,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__S.ocr.filter((b) => b.reviewSkipped && !b.reviewAccepted)
            .length,
      ),
      12,
    );
    checks.push(
      "Explicit skip retains 12 unaccepted OCR suggestions and applies the real native text layer",
    );
    await app.evaluate(({ dialog }, f) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
    }, saved);
    await page.locator("[data-action=save]").first().click();
    await page.waitForFunction(
      (n) =>
        document.querySelector("#doc-name").textContent === n &&
        document.querySelector("#busy").hidden,
      path.basename(saved),
    );
    await open(input);
    await open(saved);
    const text = await page.evaluate(async () => {
      const p = await window.__S.pdf.getPage(1);
      return (await p.getTextContent()).items.map((x) => x.str).join(" ");
    });
    assert(
      text.includes("Review line 0") && text.includes("Review line 11"),
      text,
    );
    checks.push("Save and reopen retain searchable first and last OCR lines");
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify({ checks, errors }, null, 2),
    );
    console.log("PASS", checks);
  } catch (e) {
    if (page)
      await page
        .screenshot({ path: path.join(out, "failure.png") })
        .catch(() => {});
    throw e;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
});

// Packaged Windows application and real local OCR; no recognition mocks.
const { _electron } = require("playwright"),
  fs = require("fs"),
  path = require("path"),
  assert = require("node:assert/strict"),
  crypto = require("crypto");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "tests/output");
fs.mkdirSync(out, { recursive: true });
const checks = [],
  errors = [];
let app, page;
(async () => {
  assert(process.env.FOLIO_EXE);
  app = await _electron.launch({
    executablePath: process.env.FOLIO_EXE,
    args: ["--user-data-dir=" + path.join(out, "smart-toc-profile")],
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector("#language-select");
  await page.locator("#language-select").selectOption("en");
  const bytes = await page.evaluate(async () => {
    const { PDFDocument } = await import("./vendor/pdf-lib.js");
    const d = await PDFDocument.create();
    const content = [
      [
        "Contents",
        "Alpha chapter     9",
        "Beta chapter     3",
        "Gamma chapter     1",
      ],
      ["Beta chapter"],
      ["Nothing relevant"],
      ["Gamma chapter"],
      ["Alpha chapter"],
    ];
    for (const lines of content) {
      const c = document.createElement("canvas");
      c.width = 900;
      c.height = 1200;
      const x = c.getContext("2d");
      x.fillStyle = "white";
      x.fillRect(0, 0, 900, 1200);
      x.fillStyle = "black";
      x.font = "30px Arial";
      lines.forEach((s, i) => x.fillText(s, 90, 180 + i * 70));
      const image = await d.embedPng(c.toDataURL());
      d.addPage([600, 800]).drawImage(image, {
        x: 0,
        y: 0,
        width: 600,
        height: 800,
      });
    }
    return Array.from(await d.save());
  });
  const file = path.join(out, "smart-toc-scanned-fixture.pdf");
  fs.writeFileSync(file, Buffer.from(bytes));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await page.locator("[data-action=open]").first().click();
  await page.waitForFunction(() =>
    document.querySelector("#page-total").textContent.includes("5"),
  );
  await page.waitForFunction(() => document.querySelector("#busy").hidden);
  await page.evaluate(() =>
    document.querySelector('[data-action="smart-toc"]').click(),
  );
  await page.locator("#st-settings summary").click();
  await page.locator("#st-ocr").check();
  await page.locator("#st-range").fill("1");
  await page.locator("#st-range").blur();
  await page.locator("#st-detect").click();
  await page.waitForFunction(
    () => !document.querySelector("#st-detect").disabled,
    null,
    { timeout: 180000 },
  );
  assert.equal(await page.locator("#st-pages-input").inputValue(), "1");
  await page.locator("#st-extract").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".st-row").length === 3,
  );
  checks.push(
    "Packaged native OCR detects and extracts all three entries from an image-only contents page",
  );
  await page.locator("#st-resolve").click();
  await page.waitForFunction(
    () => !document.querySelector("#st-resolve").disabled,
    null,
    { timeout: 240000 },
  );
  assert.deepEqual(
    await page
      .locator("[data-field=page]")
      .evaluateAll((es) => es.map((e) => +e.value)),
    [5, 2, 4],
  );
  await page.screenshot({ path: path.join(out, "smart-toc-packaged-ocr.png") });
  await page.locator("#st-apply").click();
  assert.deepEqual(
    await page.evaluate(async () => {
      const { S } = await import("./app.mjs");
      return S.nodes.map((n) => n.target.page);
    }),
    [5, 2, 4],
  );
  checks.push(
    "Offline OCR of body headings independently corrects wrong printed labels to physical pages 5,2,4",
  );
  await page.evaluate(() =>
    document.querySelector("[data-action=undo]").click(),
  );
  assert.equal(
    await page.evaluate(async () => {
      const { S } = await import("./app.mjs");
      return S.nodes.length;
    }),
    0,
  );
  checks.push(
    "One undo restores the original empty bookmark tree after OCR generation",
  );
  assert.deepEqual(errors, []);
  const digest = (p) =>
    crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  fs.writeFileSync(
    path.join(out, "smart-toc-electron-report.json"),
    JSON.stringify(
      {
        checks,
        errors,
        exe_sha256: digest(process.env.FOLIO_EXE),
        asar_sha256: digest(
          path.join(path.dirname(process.env.FOLIO_EXE), "resources/app.asar"),
        ),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
})()
  .catch(async (e) => {
    console.error(e);
    if (page) {
      console.error(
        await page
          .locator("#st-status")
          .textContent()
          .catch(() => ""),
      );
      await page.screenshot({
        path: path.join(out, "smart-toc-electron-failure.png"),
      });
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await app?.close();
  });

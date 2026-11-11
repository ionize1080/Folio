const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const { PDFDocument, rgb, StandardFonts } = await import(
      "../src/vendor/pdf-lib.js"
    ),
    fixture = await PDFDocument.create(),
    font = await fixture.embedFont(StandardFonts.Helvetica);
  const colors = [
    [0.9, 0.15, 0.15],
    [0.15, 0.7, 0.25],
    [0.2, 0.3, 0.9],
    [0.9, 0.6, 0.1],
    [0.6, 0.2, 0.8],
    [0.1, 0.7, 0.75],
    [0.8, 0.35, 0.1],
    [0.4, 0.4, 0.4],
  ];
  for (let i = 0; i < 8; i++) {
    const p = fixture.addPage([300, 400]);
    p.drawRectangle({
      x: 0,
      y: 0,
      width: 300,
      height: 400,
      color: rgb(...colors[i]),
    });
    p.drawText("Page " + (i + 1), {
      x: 24,
      y: 350,
      size: 32,
      font,
      color: rgb(0, 0, 0),
    });
    p.drawRectangle({
      x: 25,
      y: 25,
      width: 250,
      height: 12,
      color: rgb(1, 1, 1),
    });
  }
  const source = path.resolve("tests/output/printing-270-source.pdf");
  fs.writeFileSync(source, await fixture.save());
  const { app, page } = await require("./creative-harness.cjs")(),
    checks = [];
  try {
    await page.evaluate(async () =>
      (await import("./i18n.mjs")).setLanguage("zh-Hans"),
    );
    await app.evaluate(
      ({ dialog }, source) =>
        (dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [source],
        })),
      source,
    );
    await page.locator("[data-action=open]").first().click();
    await page.waitForFunction(() =>
      document.querySelector("#doc-name").textContent.includes("printing-270"),
    );
    await page.locator("#busy").waitFor({ state: "hidden" });
    const output = path.resolve("tests/output/printing-270.pdf");
    await app.evaluate(
      async ({ app }, { output }) => {
        const fs = process.getBuiltinModule("fs");
        app.on("web-contents-created", (_, wc) => {
          wc.print = async (options, done) => {
            try {
              globalThis.folioPrintOptions = options;
              const data = await wc.printToPDF({
                printBackground: true,
                preferCSSPageSize: true,
              });
              fs.writeFileSync(output, data);
              done(true);
            } catch (e) {
              done(false, e.message);
            }
          };
        });
      },
      { output },
    );
    const d = page.locator(".print-dialog"),
      ready = () =>
        page.waitForFunction(
          () => !document.querySelector(".print-dialog [data-print]").disabled,
        ),
      open = async () => {
        await page.keyboard.press("Control+p");
        await d.waitFor();
        await ready();
        await d.locator("[data-quality]").selectOption("150");
        await ready();
      };
    const finished = async () => {
      await page.waitForFunction(
        () =>
          !document.querySelector(".print-dialog") ||
          !document.querySelector(".print-dialog [data-print]").disabled,
        null,
        { timeout: 90000 },
      );
      if (await d.isVisible())
        throw Error(await d.locator("[data-status]").innerText());
    };
    const savePDF = async (name) => {
      await ready();
      await app.evaluate(
        ({ dialog }, file) =>
          (dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: file,
          })),
        path.resolve("tests/output/" + name),
      );
      await d.locator("[data-pdf]").click();
      await finished();
    };
    await open();
    await d.locator("[data-scope=current]").click();
    assert.equal(await d.locator("[data-range]").inputValue(), "1");
    await d.locator("[data-scope=selected]").click();
    await d.locator('[data-page="3"]').click();
    assert.equal(await d.locator("[data-range]").inputValue(), "1,3");
    await d.locator("[data-subset]").selectOption("even");
    assert(await d.locator("[data-print]").isDisabled());
    await d.locator("[data-subset]").selectOption("all");
    await d.locator("[data-color]").selectOption("gray");
    await d.locator("[data-duplex]").selectOption("longEdge");
    await d.locator("[data-copies]").fill("2");
    await d.locator("[data-collate]").uncheck();
    await ready();
    await require("./native-capture.cjs")(
      app,
      page,
      "tests/output/printing-dialog-270.png",
    );
    const box = await d.locator(".print-paper").boundingBox();
    assert(
      Math.abs(box.width / box.height - 0.75) < 0.01,
      "Preview must preserve page aspect ratio",
    );
    await d.locator("[data-printer]").selectOption("");
    await ready();
    await d.locator("[data-print]").click();
    await finished();
    let pdf = await PDFDocument.load(fs.readFileSync(output));
    assert.equal(pdf.getPageCount(), 2);
    assert.equal(Math.round(pdf.getPage(0).getWidth()), 300);
    assert.equal(Math.round(pdf.getPage(0).getHeight()), 400);
    const native = await app.evaluate(() => globalThis.folioPrintOptions);
    assert.equal(native.silent, false);
    assert.equal(native.color, false);
    assert.equal(native.duplexMode, "longEdge");
    assert.equal(native.copies, 2);
    assert.equal(native.collate, false);
    assert.equal(native.pagesPerSheet, 1);
    checks.push(
      "Thumbnail range, parity, grayscale, copies, collation and long-edge duplex reach native print options; original paper size is retained",
    );
    await open();
    await d.locator("[data-range]").fill("0");
    assert(await d.locator("[data-print]").isDisabled());
    assert((await d.locator("[data-count]").innerText()).length);
    await d.locator("[data-cancel]").click();
    checks.push("Invalid ranges cannot print and preparation is cancellable");
    await open();
    await d.locator("[data-mode=nup]").click();
    await d.locator("[data-order]").selectOption("row-reverse");
    await d.locator("[data-color]").selectOption("gray");
    await d.locator("[data-border]").check();
    await d.locator(".print-spacing summary").click();
    await d.locator("[data-margin]").fill("12");
    await d.locator("[data-gap-x]").fill("5");
    await d.locator("[data-gap-y]").fill("7");
    await d.locator("[data-sub-width]").fill("80");
    await d.locator("[data-sub-height]").fill("120");
    await ready();
    let slot = await d.locator('[data-slot="1"]').boundingBox();
    await page.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      slot.x + slot.width / 2 + 15,
      slot.y + slot.height / 2 + 8,
      { steps: 4 },
    );
    await page.mouse.up();
    await ready();
    assert(
      Number(await d.locator("[data-offset-x]").inputValue()) > 0,
      "Dragging changes the physical offset",
    );
    const handle = await d.locator("[data-handle=scale]").boundingBox();
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.width / 2 - 12,
      handle.y + handle.height / 2 - 16,
      { steps: 4 },
    );
    await page.mouse.up();
    await ready();
    assert(
      Number(await d.locator("[data-item-scale]").inputValue()) < 100,
      "Corner handle changes uniform scale",
    );
    await d.locator("[data-reset]").click();
    await ready();
    assert.equal(await d.locator("[data-offset-x]").inputValue(), "0.0");
    await d.locator("[data-item-scale]").fill("85");
    await ready();
    await require("./native-capture.cjs")(
      app,
      page,
      "tests/output/printing-handout-270.png",
    );
    await savePDF("printing-handout-270.pdf");
    pdf = await PDFDocument.load(
      fs.readFileSync("tests/output/printing-handout-270.pdf"),
    );
    assert.equal(pdf.getPageCount(), 2);
    assert(Math.abs(pdf.getPage(0).getWidth() - 595.28) < 1);
    checks.push(
      "Four-up handouts use explicit subpage sizes, spacing, border and reversed horizontal order; drag and corner resize update the shared output model",
    );
    await open();
    await d.locator("[data-mode=booklet]").click();
    await ready();
    assert.equal(await d.locator("[data-duplex]").inputValue(), "shortEdge");
    assert((await d.locator("[data-count]").innerText()).includes("4"));
    await require("./native-capture.cjs")(
      app,
      page,
      "tests/output/printing-booklet-270.png",
    );
    await savePDF("printing-booklet-270.pdf");
    pdf = await PDFDocument.load(
      fs.readFileSync("tests/output/printing-booklet-270.pdf"),
    );
    assert.equal(pdf.getPageCount(), 4);
    assert(pdf.getPage(0).getWidth() > pdf.getPage(0).getHeight());
    checks.push(
      "Booklet uses landscape sheets and short-edge duplex by default, with four output faces for eight source pages",
    );
    await open();
    await d.locator("[data-range]").fill("1-5");
    await d.locator("[data-mode=booklet]").click();
    await d.locator("[data-binding]").selectOption("right");
    await d.locator("[data-sides]").selectOption("back");
    await d.locator("[data-reverse-sheets]").check();
    await ready();
    assert.equal(await d.locator("[data-duplex]").inputValue(), "simplex");
    await savePDF("printing-booklet-backs-270.pdf");
    checks.push(
      "Manual duplex backs, right binding, reversed sheets and padded blanks are exported as a separate two-face PDF",
    );
    const python =
        process.env.FOLIO_PYTHON || path.resolve("native/runtime/python.exe"),
      verify = require("node:child_process").spawnSync(
        python,
        ["tests/printing-270-verify.py"],
        { encoding: "utf8" },
      );
    assert.equal(verify.status, 0, verify.stdout + "\n" + verify.stderr);
    checks.push(
      "Independent MuPDF pixel checks confirm output content, grayscale, paper size and booklet page positions",
    );
    fs.writeFileSync(
      "tests/output/printing-270.json",
      JSON.stringify({ status: "passed", checks, nativeOptions: native }),
    );
    console.log("PASS", checks);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

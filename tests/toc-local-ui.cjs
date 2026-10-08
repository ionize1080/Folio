// Opt-in private corpus test. PDFs and screenshots are never distributed.
const { _electron } = require("playwright");
const fs = require("fs"),
  path = require("path"),
  assert = require("node:assert/strict"),
  crypto = require("crypto");
const samples = process.env.FOLIO_SAMPLES,
  out = path.resolve(process.argv[2] || "../corpus-ui");
assert(samples && process.env.FOLIO_EXE, "Set FOLIO_SAMPLES and FOLIO_EXE");
fs.mkdirSync(out, { recursive: true });
const files = fs
  .readdirSync(samples)
  .filter(
    (n) =>
      /教科书|acrobat|PitStop|城市统计|能源统计|贸易外经/.test(n) &&
      n.endsWith(".pdf") &&
      !n.includes("-test"),
  );
const checks = [],
  errors = [];
let app, page;
const flat = (nodes) =>
  nodes.map((n) => [
    n.title,
    n.target?.page,
    nodes.findIndex((p) => p.id === n.parent),
  ]);
(async () => {
  app = await _electron.launch({
    executablePath: process.env.FOLIO_EXE,
    args: ["--user-data-dir=" + path.join(out, "profile-" + Date.now())],
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(180000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector("#language-select");
  await page.locator("#language-select").selectOption("zh-Hans");
  await page.evaluate(async () => {
    window.__S = (await import("./app.mjs")).S;
  });
  for (const name of files) {
    if (process.env.FOLIO_FILTER && !name.includes(process.env.FOLIO_FILTER))
      continue;
    const file = path.join(samples, name),
      scan = /城市统计|能源统计|贸易外经/.test(name);
    const t = Date.now();
    const open = async (file) => {
      await page.evaluate(() => {
        window.__previousPDF = window.__S.pdf;
      });
      await app.evaluate(({ dialog }, f) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [f],
        });
      }, file);
      await page.locator("[data-action=open]").first().click();
      await page.waitForFunction(
        (n) =>
          window.__S.pdf &&
          window.__S.pdf !== window.__previousPDF &&
          window.__S.name === n &&
          document.querySelector("#busy").hidden,
        path.basename(file),
      );
    };
    await open(file);
    await page.locator("[data-action=smart-toc]").click();
    if (scan) {
      await page.locator("#st-ocr").check();
      await page.locator("#st-settings summary").click();
      await page.locator("#st-body-ocr").check();
      await page
        .locator("#st-body")
        .fill(
          /城市/.test(name) ? "11-14" : /能源/.test(name) ? "16-19" : "19-22",
        );
      await page.locator("#st-body").blur();
      await page
        .locator("#st-range")
        .fill(/城市/.test(name) ? "8-10" : /能源/.test(name) ? "8-15" : "8-17");
      await page.locator("#st-range").blur();
      await page.locator("#st-detect").click();
      await page.waitForFunction(
        () => !document.querySelector("#st-detect").disabled,
        null,
        { timeout: 600000 },
      );
      await page.locator("#st-extract").click();
      await page.waitForFunction(
        () => !document.querySelector("#st-extract").disabled,
        null,
        { timeout: 600000 },
      );
      await page.locator("#st-resolve").click();
      await page.waitForFunction(
        () => !document.querySelector("#st-resolve").disabled,
        null,
        { timeout: 600000 },
      );
    } else {
      await page.locator("#st-start").click();
      await page.waitForFunction(
        () => !document.querySelector("#st-start").disabled,
        null,
        { timeout: 600000 },
      );
    }
    const entries = [];
    do {
      entries.push(
        ...(await page
          .locator(".st-row")
          .evaluateAll((rows) =>
            rows.map((r) =>
              Object.fromEntries(
                [...r.querySelectorAll("[data-field]")]
                  .filter((e) => e.tagName === "INPUT")
                  .map((e) => [
                    e.dataset.field,
                    e.type === "checkbox" ? e.checked : e.value,
                  ]),
              ),
            ),
          )),
      );
      if (await page.locator("#st-next").isDisabled()) break;
      await page.locator("#st-next").click();
    } while (true);
    assert(entries.length > 0, name);
    while (!(await page.locator("#st-prev").isDisabled()))
      await page.locator("#st-prev").click();
    await page.locator("#st-start").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, name + ".png") });
    const report = {
      name,
      seconds: (Date.now() - t) / 1000,
      contentsPages: await page.locator("#st-pages-input").inputValue(),
      summary: await page.locator("#st-summary").textContent(),
      bodyRange: await page.locator("#st-body").inputValue(),
      entries,
    };
    if (!scan) {
      const selected = entries.filter((e) => e.selected);
      assert(selected.length > 0, name);
      await page.locator("#st-merge").selectOption("replace");
      await page.locator("#st-apply").click();
      const before = await page.evaluate(() => window.__S.nodes);
      assert.equal(before.length, selected.length);
      const saved = path.join(out, "saved-" + name);
      await app.evaluate(({ dialog }, f) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
      }, saved);
      await page.keyboard.press("Control+Shift+S");
      await page.waitForFunction(
        () => !window.__S.dirty && document.querySelector("#busy").hidden,
        null,
        { timeout: 180000 },
      );
      assert(fs.existsSync(saved));
      await open(saved);
      const reopened = await page.evaluate(() => window.__S.nodes);
      assert.deepEqual(flat(reopened), flat(before));
      report.savedBookmarks = reopened.length;
      report.saveReopen = true;
    } else await page.locator("#modal-close").click();
    fs.writeFileSync(
      path.join(out, name + ".json"),
      JSON.stringify(report, null, 2),
    );
    checks.push({
      name,
      entries: entries.length,
      selected: entries.filter((e) => e.selected).length,
      seconds: report.seconds,
      saveReopen: !!report.saveReopen,
    });
    console.log(JSON.stringify(checks.at(-1)));
  }
  assert.deepEqual(errors, []);
  const hash = (p) =>
    crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        checks,
        errors,
        exe_sha256: hash(process.env.FOLIO_EXE),
        asar_sha256: hash(
          path.join(path.dirname(process.env.FOLIO_EXE), "resources/app.asar"),
        ),
      },
      null,
      2,
    ),
  );
})()
  .catch(async (e) => {
    console.error(e);
    console.error(
      await page
        ?.locator("#st-status")
        .textContent({ timeout: 1000 })
        .catch(() => ""),
    );
    await page
      ?.screenshot({ path: path.join(out, "failure.png") })
      .catch(() => {});
    process.exitCode = 1;
  })
  .finally(async () => {
    await app?.close();
  });

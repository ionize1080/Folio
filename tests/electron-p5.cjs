// Release gate: actual Windows EXE, Chromium FontFace, native worker and saved PDF.
const { _electron } = require("playwright");
const fs = require("node:fs"),
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
    page.setDefaultTimeout(45000);
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
    const open = async (fixture) => {
      await page.evaluate(() => window.desktop?.setDirty(false));
      await page.reload();
      await page.waitForSelector('[data-action="open"]');
      await app.evaluate(({ dialog }, fixture) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [fixture],
        });
      }, fixture);
      await page.locator('[data-action="open"]').first().click();
      await page.waitForSelector("body.has-document");
      await page.locator('[data-action="flow-edit"]').click();
      await page.locator(".page-edit-hit:not(.unavailable)").first().click();
      await stable();
    };
    const publicFonts = [];
    for (const name of [
      "p5-cid.pdf",
      "tracemonkey.pdf",
      "ArabicCIDTrueType.pdf",
      "XiaoBiaoSong.pdf",
    ]) {
      const result = await page.evaluate(
        async (bytes) => {
          const { nativeRequest, releaseSource } = await import(
            "./native-source.mjs"
          );
          const data = new Uint8Array(bytes),
            loaded = [];
          try {
            const r = await nativeRequest({
              command: "inspect",
              bytes: data,
              page: 1,
            });
            for (const key of new Set(
              Object.values(r.fonts)
                .map((f) => f.fontKey)
                .filter(Boolean),
            )) {
              const f = await nativeRequest({
                command: "font-fast",
                fontKey: key,
              });
              const face = await new FontFace(
                "P5Public" + key,
                Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)),
              ).load();
              loaded.push({ name: f.name, status: face.status });
            }
            return {
              loaded,
              fonts: Object.values(r.fonts).map((f) => ({
                name: f.fontName,
                embedded: f.fontEmbedded,
                resolution: f.fontResolution,
                reason: f.fontFallback,
              })),
            };
          } finally {
            await releaseSource(data);
          }
        },
        Array.from(
          fs.readFileSync(
            path.join(out, name === "p5-cid.pdf" ? "" : "public-corpus", name),
          ),
        ),
      );
      if (name === "XiaoBiaoSong.pdf" && !result.loaded.length)
        assert(
          result.fonts.length > 0 && result.fonts.every((f) => !f.embedded),
          JSON.stringify(result),
        );
      else
        assert(result.loaded.length > 0, name + " " + JSON.stringify(result));
      assert(result.loaded.every((f) => f.status === "loaded"));
      console.log("FontFace checked", name, JSON.stringify(result));
      publicFonts.push({ file: name, fonts: result });
    }
    checks.push(
      "Public English Type1 and Chinese/Arabic embedded fonts pass actual Chromium FontFace loading",
    );
    await open(path.join(out, "p5-missing-post.pdf"));
    assert((await page.title()).includes("RC1-P5"));
    const font = JSON.parse(
      fs.readFileSync(path.join(out, "p5-font.json"), "utf8"),
    );
    const loaded = await page.evaluate(async (f) => {
      const b = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      const face = await new FontFace("P5ActualSubset", b).load();
      document.fonts.add(face);
      return {
        status: face.status,
        check: document.fonts.check("12px P5ActualSubset", "字体测试"),
      };
    }, font);
    assert.equal(loaded.status, "loaded");
    assert(loaded.check);
    assert(
      (await page.locator(".page-edit-input").inputValue()).includes(
        "字体测试",
      ),
    );
    checks.push(
      "Real Chromium accepts reconstructed cmap/post subset font and activates Chinese paragraph",
    );
    for (let i = 0; i < 3; i++) {
      const saved = path.join(out, `p5-electron-roundtrip-${i}.pdf`);
      fs.rmSync(saved, { force: true });
      await app.evaluate(({ dialog }, saved) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: saved,
        });
      }, saved);
      await page.locator(".page-edit-input").evaluate((e) => {
        e.focus();
        e.select();
      });
      await page.locator("#pe-color").evaluate((e, color) => {
        e.value = color;
        e.dispatchEvent(new Event("input", { bubbles: true }));
        e.dispatchEvent(new Event("change", { bubbles: true }));
      }, ["#173ea8", "#7d2450", "#245930"][i]);
      await stable();
      await page.locator("#pe-done").click();
      await page.waitForFunction(
        () => !document.body.classList.contains("page-edit-mode"),
      );
      await page.locator('[data-action="save"]').click();
      await page.waitForFunction(
        async () => {
          const { S } = await import("./app.mjs");
          return (
            !S.busy &&
            !document.querySelector("#dirty-dot").classList.contains("changed")
          );
        },
        null,
        { timeout: 60000 },
      );
      assert(fs.statSync(saved).size > 100);
      await open(saved);
      assert(
        (await page.locator(".page-edit-input").inputValue()).includes(
          "字体测试",
        ),
      );
    }
    await page.screenshot({ path: path.join(out, "p5-electron-chinese.png") });
    checks.push(
      "Packaged editor saves and reopens editable Chinese text three consecutive times",
    );
    await open(path.join(out, "p5-rotated.pdf"));
    assert.equal(
      (await page.locator(".page-edit-input").inputValue()).trim(),
      "Rotate test",
    );
    const transform = await page
      .locator(".page-edit-layer")
      .evaluate((e) => getComputedStyle(e).transform);
    assert.notEqual(transform, "none");
    await page.screenshot({ path: path.join(out, "p5-electron-rotated.png") });
    checks.push(
      "Rotated 90-degree page hit target activates correct text with transformed editor layer",
    );
    await open(path.join(out, "p5-sparse.pdf"));
    assert.equal(await page.locator(".table-cell-hit").count(), 12);
    await page.locator("#pe-more").click();
    await page.locator(".pe-position>summary").click();
    assert(await page.locator('[data-frame="height"]').isDisabled());
    checks.push(
      "Inferred sparse table exposes 12 editable cells and disables unsafe border resizing",
    );
    assert.deepEqual(errors, []);
    const exe = await app.evaluate(() => process.execPath),
      hash = (p) =>
        crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    const report = {
      platform: process.platform,
      publicFonts,
      checks,
      errors,
      exe_sha256: hash(exe),
      asar_sha256: hash(path.join(path.dirname(exe), "resources/app.asar")),
    };
    fs.writeFileSync(
      path.join(out, "p5-electron-report.json"),
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
        .screenshot({ path: path.join(out, "p5-electron-failure.png") })
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

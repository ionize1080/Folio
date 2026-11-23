const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);

(async () => {
  const h = await require("./ui-audit-support.cjs")("window-frame");
  const { app, page } = h;
  const report = { moves: {}, resize: {}, controls: [] };
  try {
    const frame = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const area = screen.getDisplayMatching(win.getBounds()).workArea;
      const [minWidth, minHeight] = win.getMinimumSize();
      const width = Math.max(minWidth, Math.min(960, area.width - 100));
      const height = Math.max(minHeight, Math.min(660, area.height - 100));
      const bounds = { x: area.x + Math.floor((area.width - width) / 2),
        y: area.y + Math.floor((area.height - height) / 2), width, height };
      win.setAlwaysOnTop(true);
      win.setBounds(bounds);
      win.show(); win.focus();
      return { hwnd: win.getNativeWindowHandle().readBigUInt64LE().toString(), bounds };
    });
    const native = async (gesture, point = [0, 0], dx = 0, dy = 0) => {
      const args = [path.join(__dirname, "window-frame-input.py"), frame.hwnd, gesture, ...point, dx, dy];
      const { stdout } = await run(process.env.FOLIO_PYTHON || "python", args.map(String),
        { windowsHide: true, timeout: 12000 });
      return JSON.parse(stdout);
    };
    const point = (target, selector, gutter = false) => target.locator(selector).evaluate((el, gutter) => {
      const rect = el.getBoundingClientRect();
      const x = gutter ? rect.right + 18 : rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || (gutter ? hit.closest("button,input,select,details,.document-tab") : !el.contains(hit))) {
        throw Error("Caption or control has a different hit target: " + hit?.outerHTML.slice(0, 120));
      }
      return [x / innerWidth, y / innerHeight];
    }, gutter);
    const state = () => app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { maximized: win.isMaximized(), minimized: win.isMinimized(), bounds: win.getBounds() };
    });
    const waitState = async (predicate, label) => {
      let value;
      for (let n = 0; n < 60; n++) {
        value = await state();
        if (predicate(value)) return value;
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      throw Error(label + " " + JSON.stringify(value));
    };
    const clickControl = async (target, action) =>
      native("click", await point(target, '[data-window="' + action + '"]'));
    const drag = async (target, selector, name, gutter = false) => {
      const result = await native("drag", await point(target, selector, gutter), 26, 16);
      const delta = result.after.map((v, i) => v - result.before[i]);
      assert(delta.every((v, i) => Math.abs(v - [26, 16, 26, 16][i]) <= 3),
        name + " " + JSON.stringify(result));
      report.moves[name] = delta;
    };
    await page.locator(".custom-titlebar .doc-tab").waitFor();
    await h.frames();
    await drag(page, ".doc-tab", "emptyDocument");

    await clickControl(page, "maximize");
    await waitState(v => v.maximized, "Maximize button");
    await clickControl(page, "maximize");
    const restored = await waitState(v => !v.maximized, "Restore button");
    assert.equal(restored.bounds.width, frame.bounds.width);
    assert.equal(restored.bounds.height, frame.bounds.height);
    report.controls.push("maximize", "restore");
    await clickControl(page, "maximize");
    await waitState(v => v.maximized, "Maximize before caption drag");
    const detached = await native("drag", await point(page, ".doc-tab"), 48, 76);
    await waitState(v => !v.maximized && v.bounds.width === frame.bounds.width, "Drag from maximized");
    report.moves.fromMaximized = detached.after;
    await clickControl(page, "minimize");
    await waitState(v => v.minimized, "Minimize button");
    report.controls.push("minimize");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    await waitState(v => !v.minimized, "Restore after minimize");

    const resetBounds = () => app.evaluate(({ BrowserWindow }, bounds) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setBounds(bounds); win.show(); win.focus();
    }, frame.bounds);
    for (const edge of ["left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"]) {
      await resetBounds();
      const dx = edge.includes("left") ? -16 : edge.includes("right") ? 16 : 0;
      const dy = edge.includes("top") ? -16 : edge.includes("bottom") ? 16 : 0;
      const result = await native(edge, [0, 0], dx, dy);
      const delta = result.after.map((v, i) => v - result.before[i]);
      const expected = [Math.min(dx, 0), Math.min(dy, 0), Math.max(dx, 0), Math.max(dy, 0)];
      assert(delta.every((v, i) => Math.abs(v - expected[i]) <= 3), edge + " " + JSON.stringify(result));
      report.resize[edge] = delta;
    }

    await resetBounds();
    const source = path.resolve("tests/output/save-281/fixture.pdf");
    await h.openPDF(source);
    await drag(page, ".document-tabs", "oneDocument", true);
    const second = path.join(h.out, "second.pdf");
    fs.copyFileSync(source, second);
    const next = app.context().waitForEvent("page", { predicate: p => p !== page, timeout: 30000 });
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, second);
    const [other] = await Promise.all([next, page.evaluate(() => window.desktop.openDocuments())]);
    await other.locator(".custom-titlebar .document-tab.active").waitFor();
    await other.evaluate(async () => (await import("./i18n.mjs")).setLanguage("zh-Hans"));
    await drag(other, ".document-tabs", "secondDocument", true);
    await other.evaluate(async () => {
      const { S } = await import("./app.mjs");
      S.dirty = true; await window.desktop.setDirty(true);
    });
    await clickControl(other, "close");
    await other.locator("#modal-footer button").filter({ hasText: "取消" }).click();
    assert(await other.evaluate(async () => (await import("./app.mjs")).S.dirty));
    report.controls.push("close-cancel");
    await clickControl(other, "close");
    const closed = app.waitForEvent("close", { timeout: 30000 });
    await other.locator("#modal-footer button").filter({ hasText: "放弃并继续" }).click();
    await closed;
    report.controls.push("close");
    assert.deepEqual(h.errors, []);
    fs.writeFileSync("tests/output/window-frame-286.json", JSON.stringify({ status: "passed", ...report }));
    console.log("PASS native Windows title-bar movement, eight resize handles, window buttons and unsaved close", JSON.stringify(report));
  } finally {
    await h.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });


// Exercise the shipped renderer and native MCP operations on unmodified real PDFs.
const { _electron: electron } = require("playwright");
const fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict"),
  crypto = require("crypto");
const root = process.env.FOLIO_PDF_SAMPLES || "D:/APP/PDF Samples";
const picks = [
  ["五年级", 4],
  ["六年级", 4],
  ["银行营业", 2],
  ["High-tech", 2],
  ["Economist (", 2],
  ["acrobat-sdk", 3],
  ["恒隆", 3],
  ["Newsweek", 3, true],
  ["中国能源统计年鉴2024.pdf", 8, true],
  ["金砖", 6, true],
];
const output = path.resolve("tests/output/ai-corpus");
fs.mkdirSync(output, { recursive: true });
(async () => {
  const app = await electron.launch({
    args: [path.resolve(".")],
    env: {
      ...process.env,
      FOLIO_TEST_BACKGROUND: "1",
      FOLIO_TEST_PROFILE: path.join(output, "profile-" + Date.now()),
    },
    timeout: 60000,
  });
  const report = [];
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    let approval = "accept",
      dialogs = 0;
    page.on("dialog", async (d) => {
      dialogs++;
      await (approval === "accept" ? d.accept() : d.dismiss());
    });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("ai-reply");
      ipcMain.handle("ai-reply", (_e, v) => {
        globalThis.aiResult = v;
      });
    });
    let id = 0;
    async function call(operation, options = {}, revision) {
      const current = ++id;
      await app.evaluate(
        ({ BrowserWindow }, params) => {
          globalThis.aiResult = null;
          BrowserWindow.getAllWindows()[0].webContents.send(
            "ai-request",
            params,
          );
        },
        {
          id: current,
          params: {
            name: "folio_operation",
            arguments: { operation, options, revision },
          },
        },
      );
      let result;
      for (let n = 0; n < 1800; n++) {
        result = await app.evaluate(() => globalThis.aiResult);
        if (result?.id === current) break;
        await page.waitForTimeout(100);
      }
      assert(result?.id === current, "MCP timeout: " + operation);
      return result;
    }
    const ok = (r) => {
      assert(!r.error, r.error);
      return r.result;
    };
    for (const [match, toc, ocr] of picks.filter(
      (p) =>
        !process.env.FOLIO_CORPUS_MATCH ||
        p[0] === process.env.FOLIO_CORPUS_MATCH,
    )) {
      const name = fs.readdirSync(root).find((n) => n.includes(match));
      assert(name, match);
      const file = path.join(root, name),
        before = crypto
          .createHash("sha256")
          .update(fs.readFileSync(file))
          .digest("hex"),
        start = Date.now();
      await page.evaluate(() => window.desktop.setDirty(false));
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      }, file);
      await page.locator('[data-action="open"]').first().click();
      await page.waitForFunction(
        (name) =>
          document.querySelector("#doc-name")?.textContent.includes(name),
        name,
        { timeout: 90000 },
      );
      let d = ok(await call("document.describe"));
      for (let wait = 0; d.busy && wait < 900; wait++) {
        await page.waitForTimeout(100);
        d = ok(await call("document.describe"));
      }
      assert(!d.busy, "document load timeout");
      const row = { name, pages: d.pageCount, bookmarks: d.bookmarkCount };
      if (!report.length) {
        approval = "reject";
        assert(
          (
            await call(
              "bookmark.create",
              { title: "REJECTED", page: 1 },
              d.revision,
            )
          ).error?.includes("拒绝"),
        );
        approval = "accept";
        const n = dialogs;
        await page.locator('[data-action="settings"]').click();
        await page.locator("#set-ai-approval").selectOption("auto");
        await page.locator("#modal-footer .primary").click();
        assert.equal(dialogs - n, 2);
        assert.notEqual(
          await page
            .locator(".folio-ai-open")
            .evaluate((e) => getComputedStyle(e).color),
          "rgb(215, 25, 32)",
        );
        row.approval =
          "manual rejection and double-confirmed automatic mode passed";
      }
      const full = ok(
        await call(
          "page.image",
          { page: toc, purpose: "classify" },
          d.revision,
        ),
      );
      const meta = JSON.parse(full.content[0].text);
      assert(Math.max(meta.width, meta.height) <= 961);
      fs.writeFileSync(
        path.join(
          output,
          match.replace(/[^\p{L}\p{N}-]/gu, "_") + "-classify.png",
        ),
        Buffer.from(full.content[1].data, "base64"),
      );
      row.classify = meta;
      const crop = ok(
        await call(
          "page.image",
          { page: toc, purpose: "locate", region: [0.1, 0.1, 0.8, 0.4] },
          d.revision,
        ),
      );
      const cropMeta = JSON.parse(crop.content[0].text);
      assert(cropMeta.imageToPdf.every(Number.isFinite));
      row.crop = cropMeta;
      row.textLines = ok(
        await call("page.text", { pages: [toc] }),
      ).lines.length;
      let created = ok(
        await call(
          "bookmark.create",
          { title: "Corpus verification", page: toc },
          d.revision,
        ),
      );
      const parent = created.id;
      created = ok(
        await call(
          "bookmark.create",
          { title: "Child verification", page: toc, parent },
          created.revision,
        ),
      );
      let updated = ok(
        await call(
          "bookmark.update",
          {
            id: created.id,
            patch: {
              title: "Verified child",
              target: {
                kind: "dest",
                page: toc,
                mode: "XYZ",
                args: [20, 300, null],
              },
            },
          },
          created.revision,
        ),
      );
      updated = ok(
        await call(
          "bookmark.whitespace",
          { ids: [created.id], amount: 5, unit: "mm" },
          updated.revision,
        ),
      );
      updated = ok(
        await call("bookmark.delete", { ids: [parent] }, updated.revision),
      );
      updated = ok(await call("history.undo", {}, updated.revision));
      let tree = ok(
        await call("bookmark.read", {
          offset: Math.max(0, d.bookmarkCount - 1),
          limit: 100,
        }),
      );
      assert(tree.nodes.some((n) => n.title === "Verified child"));
      ok(await call("history.redo", {}, updated.revision));
      row.tree =
        "create, child hierarchy, target, whitespace, delete, undo, redo passed";
      if (ocr) {
        const result = ok(
          await call("ocr.local", { page: toc, threshold: 0.95, detail: "full" }),
        );
        assert(result.blocks.length > 0);
        assert.equal(result.threshold, 0.95);
        assert(
          result.lowConfidence.every(
            (b) => (b.confidence ?? b.score ?? 0) < 0.95,
          ),
        );
        row.ocr = {
          blocks: result.blocks.length,
          lowConfidence: result.lowConfidence.length,
          preview: result.blocks.slice(0, 5).map((b) => b.text),
        };
      }
      assert.equal(
        crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        before,
        "source modified",
      );
      row.seconds = (Date.now() - start) / 1000;
      report.push(row);
      fs.writeFileSync(
        path.join(
          output,
          "operations-" + match.replace(/[^\p{L}\p{N}-]/gu, "_") + ".json",
        ),
        JSON.stringify(report, null, 2),
      );
      console.log("PASS", name, row.seconds + "s", row.ocr || "");
    }
  } finally {
    try {
      await (
        await app.firstWindow()
      ).evaluate(() => window.desktop.setDirty(false));
    } catch {}
    await app.close();
  }
  console.log("PASS real document operations", report.length);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

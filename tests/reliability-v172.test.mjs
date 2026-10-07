import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { buildExportSnapshot } from "../src/export-snapshot.mjs";
import { DocumentSession } from "../src/session-state.mjs";
import { boundedCanvasScale } from "../src/canvas-budget.mjs";
import { isTableGridPath, hasTableGridSegment } from "../src/table-paths.mjs";
import {
  resolveTocEntries,
  splitTocText,
  recognizeTocPage,
} from "../src/smart-toc.mjs";
import { extractTocPage } from "../src/smart-toc-extract.mjs";
import { PDFDocument, StandardFonts } from "../src/vendor/pdf-lib.js";
import { PdfEngine } from "../src/pdf-core.mjs";
const { FileStore } = createRequire(import.meta.url)("../file-store.cjs");

test("applied content survives structural save, same-session save then append and reopen", async () => {
  async function pdf(text) {
    const d = await PDFDocument.create(),
      p = d.addPage();
    p.drawText(text, { font: await d.embedFont(StandardFonts.Helvetica) });
    return d.save();
  }
  const original = await pdf("original"),
    applied = await pdf("edited plus OCR layer"),
    added = await pdf("appended");
  const engine = new PdfEngine();
  await engine.open(original);
  const S = {
    pdf: { getData: async () => applied },
    nativeEdits: [{}],
    ocr: [],
    nodes: [],
    rotation: {},
    annotations: [],
    metadata: {},
  };
  const session = new DocumentSession();
  const first = await engine.save(await buildExportSnapshot(S, {}, session));
  assert(first.length);
  const merge = new PdfEngine();
  await merge.open(
    await engine.save(await buildExportSnapshot(S, {}, session)),
  );
  const output = await merge.merge(added),
    reread = await PDFDocument.load(output);
  assert.equal(reread.getPageCount(), 2);
  // Compare exact first-page content streams with the applied document, not only page count.
  const before = await PDFDocument.load(applied);
  const streams = (p) =>
    p.node
      .Contents()
      .asArray()
      .map((r) => p.doc.context.lookup(r).getContents());
  assert.deepEqual(streams(reread.getPage(0)), streams(before.getPage(0)));
});
test("export snapshot rejects late document changes and freezes structural input", async () => {
  const session = new DocumentSession();
  let done;
  const S = {
    pdf: { getData: () => new Promise((r) => (done = r)) },
    nativeEdits: [{}],
    ocr: [],
    nodes: [{ title: "A" }],
    rotation: {},
    annotations: [],
    metadata: {},
  };
  const pending = buildExportSnapshot(S, {}, session);
  session.replace();
  done(new Uint8Array([1]));
  await assert.rejects(pending, /文档已变化/);
  S.pdf = { getData: async () => new Uint8Array([2]) };
  const snapshot = await buildExportSnapshot(S, {}, session);
  S.nodes[0].title = "B";
  assert.equal(snapshot.nodes[0].title, "A");
});
test("save detects external replacement, deletion, same-size same-time mutation, and ticket race", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-conflicts-"));
  try {
    for (const mode of [
      "changed",
      "deleted",
      "replaced",
      "same-time",
      "ticket",
      "stream",
    ]) {
      const file = path.join(dir, mode + ".pdf");
      await fs.writeFile(file, "aaaa");
      const store = new FileStore(async () => file),
        handle = store.grant(file, Buffer.from("aaaa"));
      const options = {
        name: "x.pdf",
        kind: "pdf",
        handle,
        working: true,
        bytes: Buffer.from("mine"),
      };
      const stamp = await fs.stat(file);
      let ticket, id;
      if (mode === "ticket" || mode === "stream")
        ticket = await store.prepare(options);
      if (mode === "stream") {
        id = await store.beginStream({ ticket, kind: "pdf", total: 4 });
        await store.appendStream({ id, offset: 0, bytes: options.bytes });
      }
      if (mode === "deleted") await fs.unlink(file);
      else if (mode === "replaced") {
        await fs.writeFile(file + ".other", "bbbb");
        await fs.rename(file + ".other", file);
      } else {
        await fs.writeFile(file, "bbbb");
        if (mode === "same-time")
          await fs.utimes(file, stamp.atime, stamp.mtime);
      }
      await assert.rejects(
        mode === "stream"
          ? store.finishStream(id)
          : store.save({ ...options, ticket }),
        /其他程序/,
      );
      if (mode !== "deleted")
        assert.equal(await fs.readFile(file, "utf8"), "bbbb");
      assert(!(await fs.readdir(dir)).some((n) => n.endsWith(".tmp")));
      await store.close();
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("edit background stays bounded for A4/A3/long pages at all zooms and DPRs", () => {
  for (const [w, h] of [
    [595, 842],
    [842, 1191],
    [1000, 30000],
  ])
    for (const zoom of [1, 4, 8, 12])
      for (const dpr of [1, 1.25, 1.5, 2, 3]) {
        const s = boundedCanvasScale(w, h, zoom * dpr),
          x = Math.floor(w * s),
          y = Math.floor(h * s);
        assert(x * y <= 6_000_000);
        assert(x <= 8192 && y <= 8192);
        assert(s <= zoom * dpr);
      }
  assert.throws(() => boundedCanvasScale(0, 100, 1));
});
test("only grid paths are replaced: matching-style checkmarks/arrows survive", () => {
  const cells = [0, 1].flatMap((row) =>
    [0, 1].map((col) => ({
      bounds: [col * 100, row * 100, (col + 1) * 100, (row + 1) * 100],
    })),
  );
  const pathFor = (points) => ({
    type: "path",
    matrix: [1, 0, 0, 1, 0, 0],
    segments: points.map(([x, y], i) => ({
      x,
      y: 300 - y,
      type: i ? 0 : 2,
      close: false,
    })),
  });
  assert(
    isTableGridPath(
      pathFor([
        [0, 100],
        [200, 100],
      ]),
      { cells },
      300,
    ),
  );
  assert(
    !isTableGridPath(
      pathFor([
        [20, 30],
        [30, 40],
        [50, 15],
      ]),
      { cells },
      300,
    ),
  );
  assert(
    !isTableGridPath(
      pathFor([
        [20, 25],
        [60, 25],
      ]),
      { cells },
      300,
    ),
  );
  const mixed = pathFor([
    [0, 100],
    [200, 100],
    [180, 80],
  ]);
  assert(!isTableGridPath(mixed, { cells }, 300));
  assert(hasTableGridSegment(mixed, { cells }, 300));
});
const line = (text, page, top = 100) => ({
  text,
  page,
  x: 50,
  y: 800 - top,
  top,
  bottom: top + 16,
  height: 800,
  upX: 0,
  upY: 1,
});
test("links never bypass ambiguous, repeated-margin, short-title or OCR review gates", () => {
  const e = {
    ...splitTocText("Alpha chapter .... 2"),
    level: 1,
    linkedTarget: { kind: "dest", page: 3, mode: "Fit", args: [] },
  };
  for (const pages of [
    { 2: [line("Alpha chapter", 2)], 3: [line("Alpha chapter", 3)] },
    {
      2: [line("Alpha chapter", 2, 10)],
      3: [line("Alpha chapter", 3, 10)],
      4: [line("Alpha chapter", 4, 10)],
    },
  ])
    assert(!resolveTocEntries([e], pages, 5)[0].selected);
  for (const entry of [
    { ...e, confidence: 50 },
    { ...e, ocrEvidence: [{ confidence: 0.99, needsReview: true }] },
    { ...e, ocrEvidence: [{ confidence: 0.3 }] },
    { ...e, title: "AB" },
  ])
    assert(
      !resolveTocEntries([entry], { 3: [line(entry.title, 3)] }, 5)[0].selected,
    );
  assert(
    resolveTocEntries([e], { 3: [line("Alpha chapter", 3)] }, 5)[0].selected,
  );
});
test("auxiliary OCR review evidence survives extraction and entry recognition", async () => {
  const vp = {
    width: 600,
    height: 800,
    convertToViewportPoint: (x, y) => [x, 800 - y],
  };
  const pdf = {
    getPage: async () => ({
      getViewport: () => vp,
      getTextContent: async () => ({ items: [], styles: {} }),
      getAnnotations: async () => [],
    }),
  };
  const page = await extractTocPage(pdf, 1, 0, [
    {
      page: 1,
      text: "Alpha chapter .... 2",
      confidence: 0.4,
      needsReview: true,
      diagnostic: "orientation",
      reviewAccepted: true,
      quad: [
        [50, 650],
        [400, 650],
        [400, 630],
        [50, 630],
      ],
    },
  ]);
  const entry = recognizeTocPage(page).entries[0];
  assert(entry.ocrEvidence[0].needsReview);
  assert(entry.ocrEvidence[0].reviewed);
  assert.equal(entry.ocrEvidence[0].confidence, 0.4);
});

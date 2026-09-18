import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PdfEngine } from "../src/pdf-core.mjs";
import { PDFDocument, PDFName, PDFString } from "../src/vendor/pdf-lib.js";
import { makeNode } from "../src/model.mjs";
import { generateRules, industryRules } from "../src/generation.mjs";
import { extractLines } from "../src/text-lines.mjs";
import { paragraphCandidates } from "../src/flow-model.mjs";
const require = createRequire(import.meta.url),
  { validateModel, makeHTML } = require("../flow-layout-legacy.cjs");
const vp = {
  width: 595,
  height: 842,
  convertToViewportPoint: (x, y) => [x, 842 - y],
  convertToPdfPoint: (x, y) => [x, 842 - y],
};
const item = (str, x, y, w) => ({
  str,
  width: w,
  height: 12,
  transform: [12, 0, 0, 12, x, y],
});
const pdf = {
  getPage: async () => ({
    getViewport: () => vp,
    getTextContent: async () => ({
      items: [
        item("A", 50, 700, 7),
        item("农、林、牧、渔业", 165, 700, 110),
        item("本门类包括", 330, 700, 85),
        item("01", 60, 675, 14),
        item("农作物种植业", 165, 675, 80),
      ],
    }),
  }),
};
test("same-height words survive large gaps and required captures reject code-only titles", async () => {
  const lines = await extractLines(pdf, 1, 0, { visualRows: true });
  assert.equal(lines[0].text, "A  农、林、牧、渔业  本门类包括");
  assert.equal(lines[0].segments.length, 3);
  const r = generateRules({ lines, rules: industryRules, pageCount: 1 });
  assert.equal(r.nodes[0].title, "A 农、林、牧、渔业");
  assert.equal(r.nodes[1].title, "01 农作物种植业");
  const q = generateRules({
    lines: [{ ...lines[0], text: "A" }],
    rules: [
      { ...industryRules[0], pattern: "^([A-Z])(.*)", template: "$1 $2" },
    ],
    pageCount: 1,
  });
  assert.equal(q.nodes.length, 0);
  assert.match(q.diagnostics[0].reason, /第 2 组/);
  const columns = await extractLines(pdf, 1, 0, { visualRows: false });
  assert.equal(columns[0].text, "A");
});
test("reused native PDF retains original action identities after xref renumbering and latest bookmarks", async () => {
  const d = await PDFDocument.create();
  d.addPage();
  const first = new PdfEngine();
  await first.open(await d.save());
  const n = makeNode("Original", 1);
  const original = await first.save({ nodes: [n] });
  const engine = new PdfEngine();
  const info = await engine.open(original);
  // Real pypdf clone renumbers objects, tested with native integration as well.
  const contentDoc = await PDFDocument.load(original);
  contentDoc.getPage(0).drawText("Already applied");
  const contentBytes = await contentDoc.save();
  const saved = await engine.save({
    contentBytes,
    nodes: info.nodes.map((n) => ({ ...n, title: "Latest title" })),
  });
  const check = new PdfEngine();
  const out = await check.open(saved);
  assert.equal(out.nodes[0].title, "Latest title");
  assert.equal(out.nodes[0].target.page, 1);
});
const model = {
  pageWidth: 595,
  pageHeight: 842,
  frame: { x: 50, y: 50, width: 400, height: 300 },
  text: "中文 <script>alert(1)</script> 00123.45",
  size: 12,
  lineHeight: 1.4,
  columns: 2,
  gap: 20,
  align: "left",
  color: "#123456",
  font: "sans",
};
test("flow layout permits deliberate page overflow but rejects invalid dimensions and executable input", () => {
  assert.equal(validateModel(model).columns, 2);
  assert.equal(
    validateModel({ ...model, frame: { ...model.frame, width: 600 } }).frame
      .width,
    600,
  );
  assert.throws(() =>
    validateModel({ ...model, frame: { ...model.frame, width: NaN } }),
  );
  assert.throws(() => validateModel({ ...model, color: "red;display:none" }));
  assert.throws(() => validateModel({ ...model, paragraphGap: NaN }));
  const html = makeHTML(model, "");
  assert(!html.includes("<script>"));
  assert(html.includes("&lt;script&gt;"));
  assert(html.includes("00123.45"));
  assert(html.includes("column-fill:auto"));
});
test("paragraph grouping retains leading zeros and separates distant independent columns", () => {
  const o = (index, text, x, y) => ({
    index,
    text,
    type: "text",
    flowEditable: true,
    signature: String(index),
    size: 12,
    matrix: [1, 0, 0, 1, x, y],
    bounds: [x, y - 2, x + 100, y + 12],
  });
  const p = paragraphCandidates(
    [
      o(0, "00123.45", 50, 700),
      o(1, "正文续行", 50, 684),
      o(2, "另一篇文章", 330, 700),
    ],
    842,
  );
  assert.equal(p.length, 2);
  assert(p.some((p) => p.text === "00123.45正文续行"));
  assert(p.some((p) => p.text === "另一篇文章"));
});

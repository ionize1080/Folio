import test from "node:test";
import assert from "node:assert/strict";
import { connectedParagraphs, textDirection } from "../src/flow-regions.mjs";
import { fastLayout, canFast } from "../src/fast-layout.mjs";
import { sourceStyles, rangeStyle, editStyles } from "../src/flow-style.mjs";
import { hitOffset } from "../src/flow-page-model.mjs";
const o = (i, text, x, y, w = 80, extra = {}) => ({
  index: i,
  signature: "" + i,
  type: "text",
  flowEditable: true,
  text,
  size: 12,
  fontName: "宋体",
  matrix: [1, 0, 0, 1, x, 800 - y],
  bounds: [x, 800 - y - 3, x + w, 800 - y + 10],
  ...extra,
});
const model = (text, extra = {}) => ({
  text,
  pageWidth: 600,
  pageHeight: 800,
  frame: { x: 40, y: 50, width: 120, height: 120 },
  size: 12,
  lineHeight: 1.4,
  align: "left",
  color: "#000000",
  font: "sans",
  sources: [],
  ...extra,
});
const measure = (c, s) => ({
  width: /[\u3000-\uffff]/u.test(c) ? s.size : s.size * 0.5,
  fontKey: "a".repeat(32),
});
test("same row fragmented by mixed fonts joins, checkbox remains a separate paragraph", () => {
  const r = connectedParagraphs(
    [
      o(0, "（二） ", 40, 100, 30),
      o(1, "标题", 85, 100, 90, { bold: true }),
      o(2, "□适用 √不适用", 40, 120, 90),
    ],
    800,
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].text, "（二） 标题");
});
test("explicit original line break retained, no column bridge", () => {
  const r = connectedParagraphs(
    [
      o(0, "左栏一", 40, 100),
      o(1, "左栏二", 40, 118),
      o(2, "右栏一", 300, 100),
      o(3, "右栏二", 300, 118),
    ],
    800,
  );
  assert.equal(r.length, 2);
  assert(r.some((p) => p.text === "左栏一\n左栏二"));
  assert(r.every((p) => !p.text.includes("左栏二右")));
});
test("direction classification handles upright vertical, rotated and RTL independently", () => {
  assert.equal(
    textDirection(
      o(0, "天地", 50, 50, 12, {
        glyphs: [
          { text: "天", originX: 50, baseline: 50 },
          { text: "地", originX: 50, baseline: 62 },
        ],
      }),
    ).writingMode,
    "vertical-rl",
  );
  assert.equal(
    textDirection(o(1, "AB", 50, 50, 12, { matrix: [0, -1, 1, 0, 50, 750] }))
      .rotation,
    90,
  );
  assert.equal(textDirection(o(2, "مرحبا", 50, 50)).direction, "rtl");
  assert(!canFast(model("مرحبا")));
});
test("fixed frame: hard breaks, empty line, CJK punctuation, astral UTF16 and mixed styles", () => {
  const m = model("甲乙\n\nAB😀。", {
    runs: [
      { start: 0, end: 2, size: 14, bold: true },
      { start: 4, end: 9, size: 10, italic: true },
    ],
  });
  const r = fastLayout(m, measure);
  assert.equal(r.glyphs.map((g) => g.text).join(""), m.text);
  assert.equal(
    r.glyphs.find((g) => g.text === "😀").end -
      r.glyphs.find((g) => g.text === "😀").start,
    2,
  );
  assert(r.glyphs[0].bold);
  assert(r.glyphs.find((g) => g.text === "A").italic);
  assert(r.glyphs.find((g) => g.text === "A").y > r.glyphs[0].y + 24);
});
test("vertical columns advance left, and hit test follows top-to-bottom", () => {
  const r = fastLayout(
    model("天地玄黄宇宙洪荒", {
      writingMode: "vertical-rl",
      frame: { x: 40, y: 50, width: 100, height: 36 },
    }),
    measure,
  );
  assert(r.glyphs[1].y > r.glyphs[0].y);
  assert(r.glyphs[3].x < r.glyphs[0].x);
  const g = r.glyphs[0];
  assert.equal(hitOffset(r.glyphs, g.x + g.w / 2, g.y + g.h * 0.8), g.end);
});
test("rotated flow transforms anchors and ink together", () => {
  const r = fastLayout(model("ABC", { rotation: 90 }), measure);
  assert.equal(r.glyphs[0].rotation, 90);
  assert(r.glyphs[1].baseline > r.glyphs[0].baseline);
});
test("mixed selection formatting preserves neighbours and survives insertion", () => {
  const m = model("ABCD", {
    runs: [
      {
        start: 0,
        end: 4,
        fontKey: "a".repeat(32),
        size: 12,
        bold: false,
        italic: false,
      },
    ],
  });
  rangeStyle(m, 1, 3, { bold: true });
  assert.deepEqual(
    m.runs.map((r) => [r.start, r.end, r.bold]),
    [
      [0, 1, false],
      [1, 3, true],
      [3, 4, false],
    ],
  );
  m.runs = editStyles(m.runs, m.text, "ABXCD", m);
  assert(m.runs.find((r) => r.start <= 2 && r.end > 2).bold);
});
test("dense page bounded neighbour scan and long paragraph budget", () => {
  const a = Array.from({ length: 10000 }, (_, i) =>
    o(i, "段" + i, 40 + (i % 10) * 50, 20 + Math.floor(i / 10) * 15, 35),
  );
  const t = performance.now();
  connectedParagraphs(a, 16000);
  const ms = performance.now() - t;
  assert(ms < 4000, `geometry ${ms}ms`);
  const m = model("中文ABC ".repeat(2000), {
      frame: { x: 40, y: 50, width: 500, height: 14000 },
    }),
    t2 = performance.now();
  fastLayout(m, measure);
  const layoutMs = performance.now() - t2;
  assert(layoutMs < 2000, `layout ${layoutMs}ms`);
  console.log(
    JSON.stringify({
      objects: 10000,
      geometryMs: ms,
      chars: m.text.length,
      layoutMs,
    }),
  );
});
test("nonpainting source spaces retain surrounding original glyph anchors and bold", () => {
  const m = model("AB CD", { sources: [{ index: 0 }, { index: 1 }] }),
    g = (text, x) => ({
      text,
      originX: x,
      baseline: 80,
      x,
      y: 70,
      w: 6,
      h: 12,
    });
  const a = o(0, "AB ", 40, 80, 20, {
    renderMode: 2,
    fill: [0, 0, 0, 255],
    fontKey: "a".repeat(32),
    glyphs: [g("A", 40), g("B", 47)],
  });
  const b = o(1, "CD", 65, 80, 20, {
    renderMode: 2,
    fill: [0, 0, 0, 255],
    fontKey: "a".repeat(32),
    glyphs: [g("C", 65), g("D", 72)],
  });
  sourceStyles(m, [a, b]);
  assert(m.originalLayout);
  assert.equal(m.originalLayout.glyphs.map((g) => g.text).join(""), "AB CD");
  assert.equal(m.originalLayout.glyphs[3].originX, 65);
  assert(m.runs.every((r) => r.bold));
});
test("moving a text frame moves its baseline rather than reporting stale-page overflow", () => {
  const m = model("AB", { originalBaseline: 61, baselineOffset: 11 });
  const before = fastLayout(m, measure);
  m.frame = { ...m.frame, x: 140, y: 150 };
  const after = fastLayout(m, measure);
  assert.equal(after.glyphs[0].originX - before.glyphs[0].originX, 100);
  assert.equal(after.glyphs[0].baseline - before.glyphs[0].baseline, 100);
  assert(!after.overflow);
});

test("trailing side bearings do not falsely overflow a tight source frame", () => {
  const m = model("N", {
    frame: { x: 40, y: 40, width: 8, height: 20 },
    baselineOffset: 12,
  });
  const r = fastLayout(m, () => ({
    width: 9.5,
    inkLeft: -1,
    inkWidth: 7,
    ascent: 9,
    inkHeight: 9,
    fontKey: "test",
  }));
  assert.equal(r.glyphs[0].advance, 9.5);
  assert.equal(r.glyphs[0].x, 41);
  assert.equal(r.glyphs[0].w, 7);
  assert.equal(r.overflow, false);
});

test("same-slot correction retains untouched PDF ink despite rounded browser metrics", () => {
  const m = model("ABN", {
    frame: { x: 40, y: 50, width: 18, height: 30 },
    sources: [{ index: 0 }],
  });
  const glyphs = [...m.text].map((text, i) => ({
    text,
    originX: 40 + i * 6,
    baseline: 62,
    x: 40 + i * 6,
    y: 53,
    w: 5,
    h: 9,
  }));
  sourceStyles(m, [
    o(0, "ABN", 40, 62, 18, { fontKey: "a".repeat(32), glyphs }),
  ]);
  m.text = "AAN";
  const r = fastLayout(m, () => ({
    width: 6,
    inkLeft: 2,
    inkWidth: 9,
    ascent: 9,
    inkHeight: 9,
    fontKey: m.fontKey,
  }));
  assert.equal(r.layoutMode, "原始字位");
  assert.equal(r.overflow, false);
  assert.equal(r.glyphs[0].x, 40);
  assert.equal(r.glyphs[2].w, 5);
});

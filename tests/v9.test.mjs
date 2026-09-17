import test from "node:test";
import assert from "node:assert/strict";
import { rangeStyle, editStyles } from "../src/flow-style.mjs";
import {
  suggestGrowth,
  horizontalLimit,
  flowConflicts,
} from "../src/flow-page-model.mjs";
const base = () => ({
  text: "AB中文CD",
  fontKey: "original",
  size: 12,
  color: "#000000",
  runs: [
    { start: 0, end: 2, fontKey: "latin", size: 10 },
    { start: 2, end: 4, fontKey: "cjk", size: 12 },
    { start: 4, end: 6, fontKey: "latin", size: 10 },
  ],
});
test("changing selected font preserves adjacent runs and selected size", () => {
  const m = base();
  rangeStyle(m, 1, 5, { fontKey: "new" });
  assert.equal(m.runs[0].fontKey, "latin");
  assert.equal(m.runs.at(-1).fontKey, "latin");
  assert(
    m.runs
      .filter((r) => r.start >= 1 && r.end <= 5)
      .every((r) => r.fontKey === "new"),
  );
  assert.equal(m.runs.find((r) => r.start === 2).size, 12);
});
test("collapsed style affects subsequent input without changing paragraph defaults", () => {
  const m = base(),
    before = structuredClone(m);
  rangeStyle(m, 2, 2, { size: 20 });
  assert.deepEqual(m.runs, before.runs);
  assert.equal(m.size, 12);
  assert.equal(m.typingStyle.size, 20);
});
test("replacement inherits first replaced run at a mixed-style boundary", () => {
  const m = base();
  const runs = editStyles(m.runs, m.text, "AB替换CD", m);
  assert.equal(runs.find((r) => r.start === 2).fontKey, "cjk");
});
test("selecting all-script font clears separate script overrides", () => {
  const m = base();
  rangeStyle(m, 0, 6, { latinFontKey: "other" });
  rangeStyle(m, 0, 6, { fontKey: "new", latinFontKey: null });
  assert(m.runs.every((r) => r.fontKey === "new" && r.latinFontKey === null));
});
const model = {
  pageWidth: 600,
  pageHeight: 800,
  text: "Short title",
  size: 12,
  lineHeight: 1.4,
  columns: 1,
  align: "left",
  frame: { x: 40, y: 40, width: 90, height: 20 },
  sources: [],
};
test("growth chooses right for short title, down for paragraph, fixed for aligned figures", () => {
  assert.equal(suggestGrowth(model, [], [], [], 1, "a").direction, "right");
  assert.equal(
    suggestGrowth({ ...model, text: "Paragraph\ntext" }, [], [], [], 1, "a")
      .direction,
    "down",
  );
  assert.equal(
    suggestGrowth({ ...model, align: "right" }, [], [], [], 1, "a").direction,
    "fixed",
  );
  assert.equal(
    suggestGrowth({ ...model, cell: {} }, [], [], [], 1, "a").direction,
    "down",
  );
});
test("right growth stops before adjacent column without stretching glyphs", () => {
  const obstacle = {
    index: 1,
    type: "text",
    text: "next",
    bounds: [180, 740, 260, 760],
  };
  assert.equal(horizontalLimit(model, [obstacle], [], 1, "a"), 138);
});
test("overlap reporting returns geometry and does not prevent a user decision", () => {
  const obstacles = [
    { index: 1, type: "text", text: "next", bounds: [40, 740, 130, 760] },
  ];
  const c = flowConflicts(model, obstacles, [], 1, "a", [
    { x: 50, y: 45, w: 20, h: 10 },
  ]);
  assert.equal(c[0].kind, "text");
  assert.equal(
    flowConflicts(model, obstacles, [], 1, "a", [
      { x: 400, y: 45, w: 20, h: 10 },
    ]).length,
    0,
  );
});

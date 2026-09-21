import test from "node:test";
import assert from "node:assert/strict";
import { pageCandidates } from "../src/flow-page-model.mjs";
import {
  editStyles,
  editSoftBreaks,
  sourceStyles,
  rangeStyle,
} from "../src/flow-style.mjs";
import { fastLayout, FastFonts } from "../src/fast-layout.mjs";
import { displayToPage, pageTransform } from "../src/page-coordinates.mjs";
const object = (index, text, x, y, width = 100, bold = false) => ({
  index,
  type: "text",
  flowEditable: true,
  editable: true,
  text,
  size: 10,
  bounds: [x, y - 2, x + width, y + 8],
  matrix: [1, 0, 0, 1, x, y],
  fontKey: bold ? "b" : "a",
  fontName: bold ? "Bold" : "Regular",
  bold,
  signature: String(index),
});

test("mixed style rows remain one paragraph; true columns remain separate", () => {
  const os = [];
  for (let line = 0; line < 5; line++)
    for (let part = 0; part < 4; part++)
      os.push(
        object(
          os.length,
          "text" + part,
          40 + part * 100,
          700 - line * 15,
          98,
          part === 2,
        ),
      );
  const cs = pageCandidates(os, 600, 800);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].model.sources.length, 20);
  assert.equal(cs[0].model.softBreaks.length, 4);
  const columns = [];
  for (let line = 0; line < 5; line++)
    for (let col = 0; col < 3; col++)
      columns.push(
        object(
          columns.length,
          "column" + col,
          40 + col * 175,
          700 - line * 15,
          140,
        ),
      );
  const ms = pageCandidates(columns, 600, 800);
  assert.equal(ms.length, 3);
  for (const c of ms) assert.equal(c.model.sources.length, 5);
});
test("narrow newspaper gutters stay separate even on identical baselines", () => {
  const os = [];
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 3; col++)
      os.push(
        object(
          os.length,
          "中文正文栏" + col,
          50 + col * 165,
          700 - row * 15,
          147,
        ),
      );
  const cs = pageCandidates(os, 600, 800);
  assert.equal(cs.length, 3);
  for (const c of cs) {
    assert.equal(c.model.sources.length, 8);
    assert(c.model.frame.width < 160);
  }
});
test("dominant body font is counted across fragments, instead of selecting one long heading", () => {
  const os = [
    object(0, "heading!", 40, 700, 100, true),
    ...Array.from({ length: 5 }, (_, i) =>
      object(i + 1, "body", 40, 680 - i * 15, 100),
    ),
  ];
  const m = {
    sources: os.map((o) => ({ index: o.index })),
    text: os.map((o) => o.text).join("\n"),
    frame: { x: 40, y: 90, width: 300, height: 150 },
  };
  sourceStyles(m, os);
  assert.equal(m.fontName, "Regular");
  assert.equal(m.runs[0].bold, true);
});
test("emoji replacement never divides a surrogate pair between styles", () => {
  const runs = [
    { start: 0, end: 2, fontKey: "emoji" },
    { start: 2, end: 3, fontKey: "body" },
  ];
  const updated = editStyles(runs, "😀a", "😁a");
  assert.deepEqual(
    updated.map((r) => [r.start, r.end, r.fontKey]),
    [
      [0, 2, "emoji"],
      [2, 3, "body"],
    ],
  );
});
test("soft extraction wraps reflow, while typed newlines keep their paragraph boundary", () => {
  const m = {
    text: "ab\ncd\nef",
    softBreaks: [2],
    frame: { x: 20, y: 30, width: 180, height: 100 },
    size: 10,
    lineHeight: 1.4,
    color: "#000000",
    align: "left",
    layoutMode: "reflow",
  };
  const r = fastLayout(m, () => ({ width: 6, fontKey: "test" }));
  assert.equal(r.glyphs[0].baseline, r.glyphs[3].baseline);
  assert(r.glyphs[6].baseline > r.glyphs[3].baseline);
  assert.deepEqual(editSoftBreaks([2], "ab\ncd", "x\nab\ncd"), [4]);
  assert.deepEqual(editSoftBreaks([2], "ab\ncd", "abcd"), []);
});
test("page/view rotations use one invertible coordinate transform", () => {
  for (const angle of [0, 90, 180, 270, -90, 450])
    for (const p of [
      [0, 0],
      [612, 792],
      [235, 408],
    ]) {
      const [a, b, c, d, e, f] = pageTransform(612, 792, angle);
      assert.deepEqual(
        displayToPage(
          a * p[0] + c * p[1] + e,
          b * p[0] + d * p[1] + f,
          612,
          792,
          angle,
        ),
        { x: p[0], y: p[1] },
      );
    }
});

test("typing style cannot cut a surrogate pair after an emoji replacement", () => {
  const m = { text: "😁a", runs: [{ start: 0, end: 3, color: "#000000" }] };
  rangeStyle(m, 1, 2, { color: "#173ea8" });
  assert.deepEqual(
    m.runs.map((r) => [r.start, r.end, r.color]),
    [
      [0, 2, "#173ea8"],
      [2, 3, "#000000"],
    ],
  );
});

test("embedded coverage wins over same-name system fonts, with lazy missing-glyph fallback", async () => {
  const previous = globalThis.document;
  const context = {
    measureText() {
      return {
        width: this.font.includes("Embedded") ? 12 : 20,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: 10,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 2,
      };
    },
  };
  globalThis.document = {
    createElement: () => ({ getContext: () => context }),
  };
  try {
    const f = new FastFonts(() => {}),
      loaded = [];
    const definitions = {
      embedded: {
        key: "embedded",
        family: "Embedded",
        name: "Same Family",
        coverage: new Set([0x4e2d]),
        systemKey: "system",
      },
      system: {
        key: "system",
        family: "System",
        name: "Same Family",
        coverage: new Set([0x4e2d, 0x65b0]),
      },
      "builtin-cjk": {
        key: "builtin-cjk",
        family: "Builtin",
        coverage: new Set([0x7f3a]),
      },
    };
    f.load = async (key) => {
      loaded.push(key);
      f.fonts.set(key, definitions[key]);
      return definitions[key];
    };
    const m = { text: "中", fontKey: "embedded", size: 12 };
    await f.prepare(m);
    assert.deepEqual(loaded, ["embedded"]);
    assert.equal(f.measure("中", m).fontKey, "embedded");
    assert.equal(f.measure("中", m).width, 12);
    assert.equal(f.measure("中", m).fallback, false);
    loaded.length = 0;
    m.text = "新缺";
    await f.prepare(m);
    assert.deepEqual(loaded, ["embedded", "system", "builtin-cjk"]);
    assert.equal(f.measure("新", m).fontKey, "system");
    assert.equal(f.measure("缺", m).fontKey, "builtin-cjk");
  } finally {
    globalThis.document = previous;
  }
});

test("coloring a multi-line paragraph preserves anchors across newly styled newline runs", () => {
  const text = "abcdefgh",
    objects = [];
  for (let line = 0; line < 3; line++) {
    const o = object(line, text, 40, 700 - line * 15, 80);
    o.glyphs = Array.from(text, (ch, i) => ({
      text: ch,
      originX: 40 + i * 10,
      baseline: 100 + line * 15,
      x: 40 + i * 10,
      y: 92 + line * 15,
      w: 9,
      h: 10,
    }));
    objects.push(o);
  }
  const m = pageCandidates(objects, 600, 800)[0].model;
  const measure = () => ({ width: 10, fontKey: "a" }),
    before = fastLayout(m, measure);
  rangeStyle(m, 0, m.text.length, { color: "#173ea8" });
  const after = fastLayout(m, measure);
  assert.equal(after.layoutMode, "原始字位");
  assert.equal(after.overflow, false);
  assert.deepEqual(
    after.glyphs
      .filter((g) => g.text !== "\n")
      .map((g) => [g.originX, g.baseline, g.x, g.y, g.w, g.h]),
    before.glyphs
      .filter((g) => g.text !== "\n")
      .map((g) => [g.originX, g.baseline, g.x, g.y, g.w, g.h]),
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { hitOffset } from "../src/flow-page-model.mjs";
import { FastFonts } from "../src/fast-layout.mjs";
const { validateModel } = createRequire(import.meta.url)(
  "../flow-validation.cjs",
);
test("per-character fast anchors preserve horizontal mouse position", () => {
  const gs = Array.from({ length: 10 }, (_, i) => ({
    text: "A",
    start: i,
    end: i + 1,
    x: 40 + i * 10,
    y: 50,
    w: 9,
    h: 12,
  }));
  const as = gs.map((g) => ({ x: g.x, y: 50, h: 12 }));
  assert.equal(hitOffset(gs, 122, 56, as), 8);
  assert.equal(hitOffset(gs, 128, 56, as), 9);
  as[10] = { x: 40, y: 75, h: 12 };
  assert.equal(hitOffset(gs, 100, 80, as), 10);
});
test("narrow one-column cells reach layout instead of a two-em validation dead end", () => {
  const m = {
    text: "A",
    pageWidth: 600,
    pageHeight: 800,
    frame: { x: 40, y: 50, width: 14, height: 14 },
    size: 11,
    lineHeight: 1.15,
    align: "left",
    color: "#000000",
    columns: 1,
  };
  assert.equal(validateModel(m).frame.width, 14);
  assert.throws(() => validateModel({ ...m, columns: 3, gap: 18 }), /栏间距/);
});
test("overflow preview allocates and paints only the visible frame", () => {
  const old = globalThis.document,
    dpr = globalThis.devicePixelRatio;
  let painted = 0,
    clipped = 0;
  const c = {
    setTransform() {},
    clearRect() {},
    scale() {},
    translate() {},
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {
      clipped++;
    },
    rotate() {},
    transform() {},
    fillText() {
      painted++;
    },
  };
  const canvas = { width: 0, height: 0, style: {}, getContext: () => c };
  globalThis.document = { createElement: () => canvas };
  globalThis.devicePixelRatio = 1;
  try {
    const fonts = new FastFonts(() => {});
    fonts.fonts.set("test", { family: "test" });
    const glyphs = Array.from({ length: 1000 }, (_, i) => ({
      text: "A",
      x: 40,
      y: 50 + i * 14,
      w: 8,
      h: 12,
      originX: 40,
      baseline: 60 + i * 14,
      size: 12,
      scale: 1,
      rotation: 0,
      fontKey: "test",
      color: "#000000",
    }));
    fonts.paint(canvas, { glyphs }, 600, 800, 1, {
      x: 40,
      y: 50,
      width: 100,
      height: 28,
    });
    assert(canvas.height <= 28);
    assert(canvas.width <= 100);
    assert.equal(clipped, 1);
    assert(painted < 5);
  } finally {
    globalThis.document = old;
    globalThis.devicePixelRatio = dpr;
  }
});

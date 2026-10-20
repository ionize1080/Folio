import test from "node:test";
import assert from "node:assert/strict";
import { growthLimit, horizontalLimit } from "../src/flow-page-model.mjs";
const model = {
  sources: [],
  pageWidth: 500,
  pageHeight: 800,
  size: 12,
  frame: { x: 40, y: 50, width: 180, height: 100 },
};
const vertical = {
  index: 1,
  type: "text",
  text: " ",
  bounds: [120, 620, 120, 620],
};
const horizontal = {
  index: 2,
  type: "text",
  text: "\u3000",
  bounds: [240, 720, 240, 720],
};
test("zero-ink whitespace does not block expansion into blank page space", () => {
  assert.equal(
    growthLimit(model, [vertical], [], 1, "self"),
    growthLimit(model, [], [], 1, "self"),
  );
  assert.equal(
    horizontalLimit(model, [horizontal], [], 1, "self"),
    horizontalLimit(model, [], [], 1, "self"),
  );
  const footer = {
    index: 3,
    type: "text",
    text: "Footer",
    bounds: [40, 40, 220, 55],
  };
  assert.equal(
    growthLimit(model, [vertical, footer], [], 1, "self"),
    growthLimit(model, [footer], [], 1, "self"),
  );
  assert(
    growthLimit(model, [footer], [], 1, "self") <
      growthLimit(model, [], [], 1, "self"),
  );
});
test("visible space glyphs, unknown extraction, rules and cells retain growth boundaries", () => {
  for (const obstacle of [
    { ...vertical, bounds: [110, 615, 130, 625] },
    { ...vertical, glyphs: [{ text: " ", w: 8, h: 12 }] },
    { ...vertical, text: "" },
    { ...vertical, text: "unknown" },
    { ...vertical, type: "path", bounds: [40, 620, 220, 620] },
  ])
    assert(
      growthLimit(model, [obstacle], [], 1, "self") <
        growthLimit(model, [], [], 1, "self"),
    );
  assert.equal(
    growthLimit(
      { ...model, cell: { bounds: [40, 50, 220, 150] } },
      [vertical],
      [],
      1,
      "self",
    ),
    100,
  );
});

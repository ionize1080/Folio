import test from "node:test";
import assert from "node:assert/strict";
import {
  rectangle,
  matchesRect,
  transformedBounds,
  makeObjectEdit,
} from "../src/object-selection-model.mjs";
test("marquee normalizes either drag direction and separates contain/intersection", () => {
  const box = rectangle([80, 70], [10, 20]);
  assert.deepEqual(box, [10, 20, 80, 70]);
  assert(matchesRect([20, 30, 40, 60], box));
  assert(!matchesRect([0, 0, 500, 800], box));
  assert(matchesRect([0, 0, 500, 800], box, true));
  assert(!matchesRect([80, 20, 100, 30], box, true));
});
test("text size/move bounds preserve CropBox coordinates and original basis", () => {
  const o = {
    type: "text",
    index: 0,
    signature: "s",
    matrix: [1, 0, 0, 1, 20, 100],
    bounds: [20, 98, 60, 112],
    size: 12,
  };
  const e = makeObjectEdit(o, null, 1, {
    move: [10, -20],
    size: 24,
    fill: [255, 0, 0],
  });
  assert.deepEqual(transformedBounds(o, e), [30, 76, 110, 104]);
  assert.equal(e.objectStyle.scale, 2);
  assert.deepEqual(e.objectStyle.fill, [255, 0, 0]);
  const moved = makeObjectEdit(o, e, 1, { move: [5, 7] });
  assert.deepEqual(moved.matrix, [1, 0, 0, 1, 35, 87]);
  assert.equal(moved.objectStyle.scale, 2);
  assert.equal(o.matrix[4], 20);
  assert.equal(e.matrix[4], 30);
});
test("mixed object updates preserve previous image adjustments, crop and source signature", () => {
  const o = {
    type: "image",
    index: 2,
    signature: "s",
    matrix: [100, 0, 0, 80, 10, 30],
    bounds: [10, 30, 110, 110],
  };
  const prior = {
    id: "keep",
    page: 1,
    index: 2,
    matrix: o.matrix,
    adjustments: { contrast: 10 },
    crop: [2, 3, 4, 5],
  };
  const e = makeObjectEdit(o, prior, 1, { move: [3, 4] });
  assert.equal(e.id, "keep");
  assert.deepEqual(e.adjustments, { contrast: 10 });
  assert.deepEqual(e.crop, [2, 3, 4, 5]);
  assert.deepEqual(transformedBounds(o, e), [13, 34, 113, 114]);
});

test("absolute font size accounts for previously saved object matrix scale", () => {
  const o = {
    type: "text",
    index: 1,
    signature: "s",
    size: 16,
    matrix: [1.25, 0, 0, 1.25, 60, 700],
    bounds: [60, 690, 200, 718],
  };
  const e = makeObjectEdit(o, null, 1, { size: 20 });
  assert.equal(e.objectStyle.scale, 1);
  assert.deepEqual(transformedBounds(o, e), o.bounds);
});

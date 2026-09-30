import test from "node:test";
import assert from "node:assert/strict";
import { perspectiveSourcePoint } from "../src/image-crop-ui.mjs";
import { curveLUT } from "../src/image-color-model.mjs";
test("eyedropper follows a rectified trapezoid rather than sampling its bounding box", () => {
  const p = [
    [0.25, 0],
    [0.75, 0],
    [1, 1],
    [0, 1],
  ];
  for (const [index, point] of [
    [0, [0, 0]],
    [1, [1, 0]],
    [2, [1, 1]],
    [3, [0, 1]],
  ])
    assert.deepEqual(perspectiveSourcePoint(p, ...point), p[index]);
  const center = perspectiveSourcePoint(p, 0.5, 0.5);
  assert(Math.abs(center[0] - 0.5) < 1e-12);
  assert(Math.abs(center[1] - 1 / 3) < 1e-12);
});
test("moving curve endpoints creates clipped plateaus, with finite interpolated values", () => {
  const lut = curveLUT(
    [
      [30, 10],
      [120, 180],
      [220, 240],
    ],
    true,
  );
  assert(lut.slice(0, 31).every((x) => x === 10));
  assert(lut.slice(220).every((x) => x === 240));
  assert(lut.every(Number.isFinite));
});

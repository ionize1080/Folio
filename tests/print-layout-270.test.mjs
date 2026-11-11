import test from "node:test";
import assert from "node:assert/strict";
import { planPrint, MM } from "../src/print-layout.mjs";
const pages = (n) =>
  Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    width: 300,
    height: 400,
  }));
test("booklet imposes folding order, padding, binding and manual duplex independently of N-up order", () => {
  const p = planPrint(pages(8), { mode: "booklet", paper: "A4" });
  assert.deepEqual(
    p.sheets.map((s) => s.slots.map((p) => p.number)),
    [
      [8, 1],
      [2, 7],
      [6, 3],
      [4, 5],
    ],
  );
  assert.deepEqual(
    p.sheets.map((s) => [s.sheet, s.side]),
    [
      [1, "front"],
      [1, "back"],
      [2, "front"],
      [2, "back"],
    ],
  );
  const padded = planPrint(pages(5), {
    mode: "booklet",
    binding: "right",
    sides: "back",
    reverseSheets: true,
  });
  assert.equal(padded.blanks, 3);
  assert.deepEqual(
    padded.sheets.map((s) => s.slots.map((p) => p.number)),
    [
      [5, 4],
      [null, 2],
    ],
  );
  const signature = planPrint(pages(10), { mode: "booklet", signature: 8 });
  assert.equal(signature.blanks, 2);
  assert.deepEqual(
    signature.sheets.slice(-2).map((s) => s.slots.map((p) => p.number)),
    [
      [null, 9],
      [10, null],
    ],
  );
});
test("handout order, custom grid, spacing and subpage size have exact physical geometry", () => {
  for (const [order, expected] of Object.entries({
    row: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    "row-reverse": [
      [1, 0],
      [0, 0],
      [1, 1],
      [0, 1],
    ],
    column: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    "column-reverse": [
      [1, 0],
      [1, 1],
      [0, 0],
      [0, 1],
    ],
  })) {
    const p = planPrint(pages(5), {
      mode: "nup",
      paper: "A4",
      rows: 2,
      cols: 2,
      margin: 10,
      gapX: 6,
      gapY: 8,
      order,
      subWidth: 70,
      subHeight: 100,
    });
    assert.equal(p.sheets.length, 2);
    const slots = p.sheets[0].slots;
    for (let i = 0; i < 4; i++) {
      assert(Math.abs(slots[i].cell.width - 70 * MM) < 1e-8);
      assert(Math.abs(slots[i].cell.height - 100 * MM) < 1e-8);
      assert.equal(slots[i].cell.x > p.sheets[0].width / 2, !!expected[i][0]);
      assert.equal(slots[i].cell.y > p.sheets[0].height / 2, !!expected[i][1]);
      assert.equal(slots[i].clipped, false);
    }
  }
  assert.throws(
    () => planPrint(pages(1), { mode: "nup", margin: 110 }),
    /空间/,
  );
  assert.throws(() => planPrint(pages(1), { mode: "nup", rows: 2.1 }), /整数/);
  assert.throws(
    () => planPrint(pages(1), { mode: "nup", subWidth: 200 }),
    /超过/,
  );
});
test("scaling and dragging preserve source aspect ratio and detect clipping", () => {
  const original = planPrint(pages(1), {
    mode: "single",
    paper: "source",
    margin: 0,
    scaling: "actual",
  }).sheets[0].slots[0];
  assert.deepEqual(original.rect, { x: 0, y: 0, width: 300, height: 400 });
  const adjusted = planPrint(
    pages(1),
    { mode: "single", paper: "source", margin: 0, scaling: "actual" },
    { 1: { x: 12, y: -4, scale: 1.2 } },
  ).sheets[0].slots[0];
  assert.deepEqual(adjusted.rect, { x: -18, y: -44, width: 360, height: 480 });
  assert(adjusted.clipped);
  assert.equal(adjusted.rect.width / adjusted.rect.height, 0.75);
  const rotated = planPrint(pages(1), {
    mode: "single",
    paper: "A4",
    orientation: "landscape",
    autoRotate: true,
  }).sheets[0].slots[0];
  assert.equal(rotated.rotation, 90);
  assert.equal(
    planPrint(pages(1), { mode: "single", paper: "A4", scaling: "shrink" })
      .sheets[0].slots[0].scale,
    1,
  );
});

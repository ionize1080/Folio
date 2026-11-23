import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionLineRects } from '../src/selection-rects.mjs';
const R = (left, top, right, bottom) => ({ left, top, right, bottom });
const overlap = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
test('nested duplicates and mixed-height runs collapse into one rect per line', () => {
  const rects = selectionLineRects([R(0, 10, 100, 30), R(0, 12, 100, 28), R(100, 8, 160, 32), R(160, 10, 200, 30),
    R(0, 40, 90, 60), R(90, 38, 200, 62)]);
  assert.equal(rects.length, 2);
  assert.deepEqual([rects[0].left, rects[0].right], [0, 200]);
});
test('lines never overlap and meet without a seam', () => {
  const rects = selectionLineRects([R(0, 10, 200, 32), R(0, 30, 200, 52), R(0, 58, 120, 80)]);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert(!overlap(rects[i], rects[j]));
  const sorted = rects.sort((a, b) => a.top - b.top);
  assert.equal(sorted[0].bottom, sorted[1].top);
  assert.equal(sorted[1].bottom, sorted[2].top);
});
test('empty and degenerate input is ignored', () => {
  assert.deepEqual(selectionLineRects([]), []);
  assert.deepEqual(selectionLineRects([R(5, 5, 5, 20)]), []);
});

import test from "node:test";
import assert from "node:assert/strict";
import { findPattern, findRanges } from "../src/find-matches.mjs";

test("regex skips empty Unicode matches, including at the end of a page", () => {
  assert.deepEqual([...findRanges("A😀B", findPattern("(?=.)|$", { useRegex: true }))], []);
});
test("literal matches retain offsets after case folding and can overlap", () => {
  assert.deepEqual([...findRanges("İAAA", findPattern("aa", {}), true)], [[1, 2], [2, 2]]);
});
test("whole words include combining marks; punctuation is literal", () => {
  assert.deepEqual([...findRanges("a a\u0301 data", findPattern("a", { wholeWord: true }), true)], [[0, 1]]);
  assert.deepEqual([...findRanges("[.]", findPattern(".", {}), true)], [[1, 1]]);
});

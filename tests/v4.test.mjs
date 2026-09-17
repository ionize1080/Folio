import test from "node:test";
import assert from "node:assert/strict";
import { makeNode, validate, move } from "../src/model.mjs";
import { duplicatePlan, patchStyles } from "../src/bookmark-tools.mjs";
import { generateRules, defaultRules } from "../src/generation.mjs";
import { matchTargets } from "../src/calibrate-worker.mjs";
import { compactPages } from "../src/page-picker.mjs";
import { resourcePlan } from "../ocr-jobs.cjs";
const node = (title, page = 1, y = 700, parent = null) => {
  const n = makeNode(title, page, parent);
  n.target.args = [40, y, null];
  return n;
};
test("same-page dedupe merges children into surviving parent and preserves preorder", () => {
  const a = node("A"),
    ac = node("child", 1, 680, a.id),
    b = node("A", 1, 700.02),
    bc = node("different", 1, 670, b.id),
    c = node("C");
  const r = duplicatePlan([a, ac, b, bc, c]);
  assert.equal(r.removed.length, 1);
  assert.equal(r.nodes.find((n) => n.id === bc.id).parent, a.id);
  validate(r.nodes);
  assert.equal(duplicatePlan([a, b], { mode: "exact" }).removed.length, 0);
  assert.equal(
    duplicatePlan([a, b], { mode: "near", tolerance: 0.01 }).removed.length,
    0,
  );
  assert.equal(
    duplicatePlan([a, b], { mode: "near", tolerance: 1 }).removed.length,
    1,
  );
});
test("dedupe scopes, alternate keeper, ancestor protection and page distinction", () => {
  const a = node("A"),
    b = node("A", 1, 700, a.id),
    c = node("A", 2),
    d = node("A");
  assert.equal(duplicatePlan([a, b, c], { scope: "all" }).removed.length, 0);
  const r = duplicatePlan([a, b, c, d], { keep: { [a.id]: d.id } });
  assert(r.nodes.some((n) => n.id === d.id));
  assert.equal(r.nodes.find((n) => n.id === b.id).parent, d.id);
  assert.equal(
    duplicatePlan([a, d], { ids: new Set([d.id]) }).removed.length,
    0,
  );
});
test("style patch changes only requested fields, leaves source untouched", () => {
  const a = node("A"),
    b = node("B");
  a.bold = true;
  b.italic = true;
  const r = patchStyles([a, b], new Set([a.id, b.id]), { color: "#123456" });
  assert(r[0].bold && r[1].italic);
  assert.equal(a.color, "#263449");
  assert.equal(r[0].color, "#123456");
});
test("unbounded business layers and explicit conflict policy; repeated parents retain child mapping", () => {
  const rules = Array.from({ length: 40 }, (_, i) => ({
    ...defaultRules[0],
    level: i + 1,
    name: `L${i + 1}`,
    pattern: `^L${i + 1}$`,
  }));
  const line = (t) => ({
    text: t,
    page: 1,
    x: 40,
    y: 700,
    upX: 0,
    upY: 1,
    top: 100,
    bottom: 110,
    height: 800,
  });
  const r = generateRules({
    rules,
    lines: rules.map((r) => line(r.name)),
    pageCount: 1,
  });
  assert.equal(r.nodes.length, 40);
  assert.equal(
    generateRules({
      rules: [rules[0], rules[0]],
      lines: [line("L1")],
      pageCount: 1,
    }).nodes.length,
    1,
  );
  assert.equal(
    generateRules({
      rules: [rules[0], rules[0]],
      lines: [line("L1")],
      pageCount: 1,
      conflict: "skip",
    }).nodes.length,
    0,
  );
  const q = generateRules({
    rules: rules.slice(0, 2),
    lines: [line("L1"), { ...line("L1"), y: 700.1 }, line("L2")],
    pageCount: 1,
  });
  assert.equal(q.nodes.length, 2);
  assert.equal(q.nodes[1].parent, q.nodes[0].id);
});
test("calibration uses ordered first occurrence, excludes headers, handles rotation and no-match", () => {
  const n = node("01. 标题"),
    line = {
      text: "标题",
      page: 1,
      x: 200,
      y: 600,
      upX: 1,
      upY: 0,
      top: 60,
      bottom: 70,
      height: 800,
    };
  const r = matchTargets({
    nodes: [n],
    pages: { 1: [{ ...line, top: 5 }, line, { ...line, top: 300, y: 300 }] },
    strip: "^01[.]\\s*",
    header: 20,
    offset: 10,
    unit: "pt",
  });
  assert.equal(r[0].candidates.length, 2);
  assert.deepEqual(r[0].candidates[0].target.args, [210, 600, null]);
  assert.equal(
    matchTargets({ nodes: [node("missing")], pages: { 1: [line] } })[0]
      .candidates.length,
    0,
  );
});
test("range compaction, subtree multi-move, resource limits", () => {
  assert.equal(compactPages([5, 2, 1, 3, 8, 8]), "1-3,5,8");
  const a = node("A"),
    b = node("B", 1, 700, a.id),
    c = node("C");
  const r = move([a, b, c], new Set([b.id]), null, "inside");
  validate(r);
  assert.equal(r.at(-1).parent, null);
  const p = resourcePlan(
    { mode: "custom", workers: 16, threads: 4 },
    2 * 1024 ** 3,
    16,
  );
  assert.equal(p.workers, 1);
  assert(p.memoryLimited);
});
test("repeated generation protects existing duplicates while absorbing new duplicate parent", () => {
  const a = node("A"),
    b = node("A"),
    g = node("A"),
    child = node("new child", 1, 680, g.id);
  const r = duplicatePlan([g, child, a, b], {
    protectedIds: new Set([a.id, b.id]),
  });
  assert(
    r.nodes.some((n) => n.id === a.id) && r.nodes.some((n) => n.id === b.id),
  );
  assert(!r.nodes.some((n) => n.id === g.id));
  assert.equal(r.nodes.find((n) => n.id === child.id).parent, a.id);
  validate(r.nodes);
});

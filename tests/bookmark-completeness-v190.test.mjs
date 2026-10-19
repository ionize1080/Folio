import test from "node:test";
import assert from "node:assert/strict";
import { makeNode, applyBatch, move, validate } from "../src/model.mjs";
import { insertGenerated } from "../src/generation.mjs";
import { bookmarkHTML } from "../src/bookmark-html.mjs";
import { describeChanges } from "../src/changes.mjs";

test("numbering treats dollar sequences and template tokens in titles as literal data", () => {
  const n = makeNode("Price: $& $$ $` $' $1 {n} {page} {title}", 2);
  const out = applyBatch([n], new Set([n.id]), {
    op: "number", template: "{n}. {title} / {title}", start: 3,
  }, 4);
  assert.equal(out[0].title, `3. ${n.title} / ${n.title}`);
  assert.equal(n.title, "Price: $& $$ $` $' $1 {n} {page} {title}");
  assert.deepEqual(out[0].target, n.target);
});

test("zoom difference reports compare coordinate meaning across destination modes", () => {
  const n = makeNode("Target");
  n.target.args = [10, 700, 1.5];
  const zoomed = applyBatch(
    [n],
    new Set([n.id]),
    { op: "zoom", zoomMode: "FitBH" },
    1,
  );
  const fields = describeChanges([n], zoomed)[0].fields;
  assert(!fields.some((f) => f.name === "顶部 Y"));
  assert.deepEqual(
    fields.find((f) => f.name === "左侧 X"),
    { name: "左侧 X", before: 10, after: undefined, operation: "移除参数" },
  );
  const back = applyBatch(
    zoomed,
    new Set([n.id]),
    { op: "zoom", zoomMode: "fixed", zoomPercent: 125 },
    1,
  );
  const reverseFields = describeChanges(zoomed, back)[0].fields;
  assert(!reverseFields.some((f) => f.name === "顶部 Y"));
  assert.deepEqual(
    reverseFields.find((f) => f.name === "缩放"),
    { name: "缩放", before: undefined, after: 1.25, operation: "新增参数" },
  );
});

test("all bookmark zoom modes retain the corresponding view coordinates", () => {
  const n = makeNode("矩形视图", 3);
  n.target = { kind: "dest", page: 3, mode: "FitR", args: [10, 20, 300, 700] };
  const expected = {
    inherit: ["XYZ", [10, 700, null]],
    fixed: ["XYZ", [10, 700, 1.5]],
    Fit: ["Fit", []],
    FitH: ["FitH", [700]],
    FitV: ["FitV", [10]],
    FitB: ["FitB", []],
    FitBH: ["FitBH", [700]],
    FitBV: ["FitBV", [10]],
  };
  for (const [zoomMode, [mode, args]] of Object.entries(expected)) {
    const [out] = applyBatch(
      [n],
      new Set([n.id]),
      { op: "zoom", zoomMode, zoomPercent: 150 },
      5,
    );
    assert.deepEqual(out.target, { kind: "dest", page: 3, mode, args });
  }
  assert.equal(n.target.mode, "FitR");
});

test("invalid zoom input is rejected even when only external actions are selected", () => {
  const n = makeNode("External");
  n.target = {
    kind: "preserve",
    external: true,
    page: 1,
    mode: "XYZ",
    args: [0, 10, 1],
  };
  for (const zoomPercent of ["", "abc", 0, -1, 6401])
    assert.throws(() =>
      applyBatch(
        [n],
        new Set([n.id]),
        { op: "zoom", zoomMode: "fixed", zoomPercent },
        3,
      ),
    );
  assert.throws(() =>
    applyBatch([n], new Set(), { op: "zoom", zoomMode: "unknown" }, 3),
  );
  assert.deepEqual(
    applyBatch(
      [n],
      new Set([n.id]),
      { op: "zoom", zoomMode: "FitBH", convert: true },
      3,
    ),
    [n],
  );
  assert.throws(() =>
    applyBatch(
      [n],
      new Set([n.id]),
      {
        op: "parameters",
        edits: { 2: { op: "absolute", value: 2 } },
        convert: true,
      },
      3,
    ),
  );
});

test("Unicode title case handles supplementary letters without splitting surrogate pairs", () => {
  const n = makeNode("𐐨𐐩 école's 中文");
  assert.equal(
    applyBatch([n], new Set([n.id]), { op: "case", caseMode: "title" }, 1)[0]
      .title,
    "𐐀𐐩 École's 中文",
  );
});

test("multiple copied and cut roots keep a valid preorder forest at all insertion positions", () => {
  const a = makeNode("A"),
    b = makeNode("B"),
    c = makeNode("C");
  const ac = makeNode("A child", 1, a.id),
    bc = makeNode("B child", 1, b.id);
  const nodes = [a, ac, b, bc, c];
  for (const where of ["before", "after", "inside"]) {
    const result = move(nodes, new Set([a.id, ac.id, b.id]), c.id, where);
    validate(result);
    assert.equal(result.length, nodes.length);
    assert.deepEqual(
      result.filter((n) => [a.id, b.id].includes(n.id)).map((n) => n.parent),
      where === "inside" ? [c.id, c.id] : [null, null],
    );
  }
  assert.throws(() => move(nodes, new Set([a.id]), ac.id, "inside"));
  const clone = makeNode("New"),
    child = makeNode("New child", 1, clone.id);
  for (const where of ["before", "after", "child"])
    validate(insertGenerated(nodes, [clone, child], where, b.id));
});

test("HTML export balances a multi-root deep tree and escapes PDF filenames and labels", () => {
  const nodes = [];
  for (let r = 0; r < 3; r++) {
    let parent = null;
    for (let d = 0; d < 5; d++) {
      const n = makeNode(`title ${r}/${d} <>&\"`, 1, parent);
      nodes.push(n);
      parent = n.id;
    }
  }
  const html = bookmarkHTML(nodes, "report #1 & 中文.pdf", {
    page: "<script>",
    lang: 'en\" onload=\"alert(1)',
  });
  assert.equal((html.match(/<li>/g) || []).length, 15);
  assert.equal((html.match(/<\/li>/g) || []).length, 15);
  assert.equal(
    (html.match(/<ol>/g) || []).length,
    (html.match(/<\/ol>/g) || []).length,
  );
  assert(!html.includes("<script>"));
  assert(html.includes("report%20%231%20%26%20"));
  assert(html.includes("&quot; onload=&quot;"));
});

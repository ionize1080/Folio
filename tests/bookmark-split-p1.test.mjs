import test from "node:test";
import assert from "node:assert/strict";
import { splitBookmarks } from "../src/bookmark-split.mjs";
import { validate } from "../src/model.mjs";
const n = (id, title, parent = null) => ({
  id,
  title,
  parent,
  color: "#263449",
  bold: false,
  italic: false,
  open: true,
  target: { kind: "dest", page: 1, mode: "XYZ", args: [111.12, 738.73, null] },
});
const pattern = String.raw`^([\d]{3})([ ]+)(\1[0])([ ]+)(.*)`;
const rules = [
  { pattern, template: "$1 $5" },
  { pattern, template: "$3 $5" },
];
const title = "509 5090 其他未列明建筑业";
const run = (extra = {}) =>
  splitBookmarks({
    nodes: [n("a", title)],
    ids: ["a"],
    mode: "hierarchy",
    rules,
    pageCount: 1,
    ...extra,
  });
test("user backreference example independently makes two levels with exact inherited targets", () => {
  const r = run();
  assert.equal(r.issues.length, 0);
  assert.deepEqual(
    r.nodes.map((n) => n.title),
    ["509 其他未列明建筑业", "5090 其他未列明建筑业"],
  );
  assert.equal(r.nodes[1].parent, r.nodes[0].id);
  assert.deepEqual(r.nodes[0].target, r.nodes[1].target);
  assert.notEqual(r.nodes[0].target, r.nodes[1].target);
});
test("user second expression diagnoses nonexistent $5 before matching any source", () => {
  const bad = {
    pattern: String.raw`^([\d]{3})([ ]+)(\1[0][ ]+)(.*)`,
    template: "$3 $5",
  };
  const r = run({ rules: [rules[0], bad] });
  assert.match(r.issues[0].reason, /\$5.*4 个捕获组/);
  assert.deepEqual(r.nodes, [n("a", title)]);
});
test("same independent rules generate siblings without a parent-child link", () => {
  const r = run({ mode: "siblings" });
  assert.deepEqual(
    r.nodes.map((n) => n.parent),
    [null, null],
  );
  assert.deepEqual(
    r.nodes.map((n) => n.title),
    ["509 其他未列明建筑业", "5090 其他未列明建筑业"],
  );
});
test("four generic layers and branching always read original text", () => {
  const title = "Chapter/Section/Topic/Detail";
  const rules = [0, 1, 2, 3].map((i) => ({
    pattern: `^(?:[^/]+/){${i}}([^/]+)`,
    template: "$1",
  }));
  let r = run({ nodes: [n("a", title)], rules });
  assert.deepEqual(
    r.nodes.map((n) => n.title),
    title.split("/"),
  );
  assert.equal(r.nodes[3].parent, r.nodes[2].id);
  rules[2].parentRule = 0;
  rules[3].parentRule = 0;
  r = run({ nodes: [n("a", title)], rules });
  assert.equal(r.nodes[3].parent, r.nodes[0].id);
});
test("replacement retains unmatched prefix/suffix; template mode only outputs captures", () => {
  const args = {
    nodes: [n("a", "before CODE-123 after")],
    mode: "siblings",
    rules: [{ pattern: "CODE-(\\d+)", template: "number:$1" }],
  };
  assert.equal(
    run({ ...args, outputMode: "replace" }).nodes[0].title,
    "before number:123 after",
  );
  assert.equal(run(args).nodes[0].title, "number:123");
});
test("named captures, dollars, literal HTML and unmatched optional captures", () => {
  let r = run({
    mode: "siblings",
    rules: [{ pattern: "(?<word>.*)", template: "$$ $<word> <b>" }],
  });
  assert.equal(r.nodes[0].title, "$ " + title + " <b>");
  r = run({ rules: [{ pattern: "(xxx)?(.*)", template: "$1" }] });
  assert.match(r.issues[0].reason, /未参与/);
});
test("all scope skips unrelated originals and preserves hierarchy while transforming nested sources once", () => {
  const nodes = [
    n("root", "Root"),
    n("a", title, "root"),
    n("b", "510 5100 Another", "a"),
    n("c", "Unrelated", "a"),
    n("tail", "Tail"),
  ];
  const r = run({ nodes, ids: nodes.map((n) => n.id), children: "last" });
  assert.equal(r.changes.length, 2);
  assert.equal(r.skipped.length, 3);
  assert.equal(r.issues.length, 0);
  validate(r.nodes, 1);
  assert.deepEqual(
    r.nodes.map((n) => n.title),
    [
      "Root",
      "509 其他未列明建筑业",
      "5090 其他未列明建筑业",
      "510 Another",
      "5100 Another",
      "Unrelated",
      "Tail",
    ],
  );
  assert.equal(r.nodes[3].parent, r.nodes[2].id);
  assert.equal(r.nodes[5].parent, r.nodes[2].id);
});
test("all scope retain mode keeps original subtrees and does not process generated titles again", () => {
  const nodes = [n("a", title), n("b", "510 5100 Another", "a")];
  const r = run({ nodes, ids: ["a", "b"], retain: true });
  assert.equal(r.changes.length, 2);
  assert.equal(r.nodes.length, 6);
  assert.deepEqual(
    r.nodes.slice(-2).map((n) => n.title),
    ["509 其他未列明建筑业", "5090 其他未列明建筑业"],
  );
  validate(r.nodes, 1);
});
test("one missing layer retains whole source, while completely unmatched source is a normal skip", () => {
  const r = run({
    nodes: [n("a", title), n("b", "Other")],
    ids: ["a", "b"],
    rules: [rules[0], { pattern: "no-match", template: "x" }],
  });
  assert.equal(r.issues.length, 1);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.changes.length, 0);
});
test("disabled initial rule uses nearest enabled parent; invalid explicit parent is diagnosed", () => {
  let r = run({ rules: [{ pattern: ".+", enabled: false }, ...rules] });
  assert.equal(r.issues.length, 0);
  assert.equal(r.nodes[1].parent, r.nodes[0].id);
  r = run({ rules: [rules[0], { ...rules[1], parentRule: 8 }] });
  assert.match(r.issues[0].reason, /父规则/);
});
test("bulk 1845 bookmark scope preserves unmatched entries and has unique IDs", () => {
  const nodes = Array.from({ length: 1845 }, (_, i) =>
    n("n" + i, i % 3 === 0 ? title : "Unrelated " + i),
  );
  const r = run({ nodes, ids: nodes.map((n) => n.id) });
  assert.equal(r.changes.length, 615);
  assert.equal(r.skipped.length, 1230);
  assert.equal(r.nodes.length, 2460);
  validate(r.nodes, 1);
});

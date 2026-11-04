import test from "node:test";
import assert from "node:assert/strict";
import { treeOperation } from "../src/ai-tools.mjs";
import { makeNode, validate } from "../src/model.mjs";
test("model target arguments cannot silently fall back to page one", () => {
  assert.throws(() =>
    treeOperation("bookmark.create", { title: "missing" }, [], 10),
  );
  assert.throws(() =>
    treeOperation(
      "bookmark.create",
      {
        title: "invalid",
        target: { kind: "xyz", page: 7, mode: "XYZ", args: [10, 700, null] },
      },
      [],
      10,
    ),
  );
  const r = treeOperation(
    "bookmark.create",
    {
      title: "target",
      target: { kind: "dest", page: 7, mode: "XYZ", args: [10, 700, null] },
    },
    [],
    10,
  );
  assert.equal(r.nodes[0].target.page, 7);
  assert.deepEqual(r.nodes[0].target.args, [10, 700, null]);
  assert.throws(() =>
    treeOperation(
      "bookmark.create",
      { title: "typo", page: 7, parentId: "ignored" },
      [],
      10,
    ),
  );
});
test("AI tree mutations preserve descendants, IDs and source snapshot", () => {
  const root = makeNode("root"),
    child = makeNode("child", 2, root.id),
    other = makeNode("other", 3);
  const nodes = [root, child, other];
  let r = treeOperation("bookmark.clone", { ids: [root.id] }, nodes, 3);
  assert.equal(r.nodes.length, 5);
  assert.equal(new Set(r.nodes.map((n) => n.id)).size, 5);
  assert.equal(nodes.length, 3);
  validate(r.nodes, 3);
  r = treeOperation(
    "bookmark.move",
    { ids: [root.id], targetId: other.id, where: "inside" },
    nodes,
    3,
  );
  assert.equal(r.nodes[1].parent, other.id);
  assert.equal(r.nodes[2].parent, root.id);
  assert.throws(() =>
    treeOperation(
      "bookmark.move",
      { ids: [root.id], targetId: child.id, where: "inside" },
      nodes,
      3,
    ),
  );
  r = treeOperation(
    "bookmark.delete",
    { ids: [root.id], promote: true },
    nodes,
    3,
  );
  assert.equal(r.nodes[0].id, child.id);
  assert.equal(r.nodes[0].parent, null);
});
test("invalid target and parent edits are atomic", () => {
  const n = makeNode("A");
  assert.throws(() =>
    treeOperation(
      "bookmark.update",
      {
        id: n.id,
        patch: { target: { kind: "dest", page: 99, mode: "Fit", args: [] } },
      },
      [n],
      2,
    ),
  );
  assert.equal(n.target.page, 1);
  assert.throws(() =>
    treeOperation(
      "bookmark.update",
      { id: n.id, patch: { parent: "missing" } },
      [n],
      2,
    ),
  );
  assert.throws(() =>
    treeOperation("bookmark.replace", { nodes: [n, n] }, [n], 2),
  );
});
test("generation, split and whitespace reuse existing engines", () => {
  const a = makeNode("A;B", 1);
  a.target.args = [20, 100, null];
  let r = treeOperation(
    "bookmark.split",
    { ids: [a.id], method: "separator", separator: ";", mode: "siblings" },
    [a],
    2,
  );
  assert.deepEqual(
    r.nodes.map((n) => n.title),
    ["A", "B"],
  );
  r = treeOperation(
    "bookmark.whitespace",
    { ids: [a.id], amount: 5, unit: "pt" },
    [a],
    2,
    { pages: [{ rotation: 0 }], rotations: {} },
  );
  assert.equal(r.nodes[0].target.args[1], 105);
});

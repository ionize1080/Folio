import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  generateRules,
  industryRules,
  pageRange,
  insertGenerated,
} from "../src/generation.mjs";
import { makeNode, applyBatch, validate } from "../src/model.mjs";
import { conflicts, bindings } from "../src/shortcuts.mjs";
const require = createRequire(import.meta.url),
  { FileStore } = require("../file-store.cjs");
test("multilevel boundaries, missing ancestors, conflicts and rotated offsets", () => {
  const line = (text, y = 500) => ({
    text,
    page: 1,
    x: 40,
    y,
    top: 100,
    bottom: 110,
    height: 842,
  });
  const result = generateRules({
    lines: [
      "A 农业",
      "01 种植",
      "011 谷物",
      "0111 稻谷",
      "01111 超长代码",
      "02 林业",
      "021 树木",
      "0210 造林",
    ].map((t) => line(t)),
    rules: industryRules,
    pageCount: 1,
  });
  assert.equal(result.nodes.length, 7);
  assert.equal(result.nodes[3].parent, result.nodes[2].id);
  assert.equal(result.nodes[4].parent, result.nodes[0].id);
  assert.equal(result.ignored, 1);
  assert.equal(
    generateRules({
      lines: [line("011 孤儿")],
      rules: industryRules,
      pageCount: 1,
    }).orphans,
    1,
  );
  assert.equal(
    generateRules({
      lines: [line("A 农业")],
      rules: [...industryRules, industryRules[0]],
      pageCount: 1,
    }).conflicts,
    1,
  );
  const r = generateRules({
    lines: [{ ...line("A 农业", 300), upX: 1, upY: 0 }],
    rules: industryRules,
    pageCount: 1,
    unit: "mm",
  });
  assert(Math.abs(r.nodes[0].target.args[0] - 40 - (16 * 72) / 25.4) < 0.001);
  assert.equal(r.nodes[0].target.args[1], 300);
});
test("range parity and subtree insertion", () => {
  assert.deepEqual(pageRange("1-5,3,8,12-14", 20, "even"), [2, 4, 8, 12, 14]);
  assert.throws(() => pageRange("1-21", 20));
  const a = makeNode("A"),
    b = makeNode("B", 1, a.id),
    c = makeNode("C"),
    out = insertGenerated([a, b], [c], "child", a.id);
  assert.equal(out[1].id, c.id);
  assert.equal(out[1].parent, a.id);
  validate(out);
});
test("parameter keep/relative/absolute/null and explicit preservation conversion", () => {
  const n = makeNode("n");
  n.target.args = [50, 700, null];
  const id = new Set([n.id]),
    r = applyBatch(
      [n],
      id,
      {
        op: "parameters",
        edits: {
          0: { op: "relative", value: 5 },
          1: { op: "null" },
          2: { op: "keep" },
        },
      },
      2,
    );
  assert.deepEqual(r[0].target.args, [55, null, null]);
  assert.deepEqual(n.target.args, [50, 700, null]);
  assert.throws(() =>
    applyBatch(
      [n],
      id,
      { op: "parameters", edits: { 2: { op: "relative", value: 1 } } },
      2,
    ),
  );
  n.target.kind = "preserve";
  assert.throws(() =>
    applyBatch(
      [n],
      id,
      { op: "parameters", edits: { page: { op: "absolute", value: 2 } } },
      2,
    ),
  );
  assert.equal(
    applyBatch(
      [n],
      id,
      {
        op: "parameters",
        convert: true,
        edits: { page: { op: "absolute", value: 2 } },
      },
      2,
    )[0].target.page,
    2,
  );
});
test("default shortcut context conflict validation", () => {
  assert.deepEqual(conflicts({}), []);
  assert(conflicts({ save: "Ctrl+O" }).length);
  assert(!bindings.some((b) => b[2] === "Tab"));
});
test("save protection, active copy, Save As, cancel and atomic failure", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-save-")),
    a = path.join(dir, "A.pdf"),
    b = path.join(dir, "B.pdf"),
    c = path.join(dir, "C.pdf");
  await fs.writeFile(a, "original");
  let picked = 0,
    next = b;
  const store = new FileStore(async () => {
      picked++;
      return next;
    }),
    handle = store.grant(a),
    first = await store.save({
      name: "A-edited.pdf",
      bytes: Buffer.from("edit1"),
      kind: "pdf",
      handle,
      protect: true,
    });
  assert.equal(first.name, "B.pdf");
  assert.equal(await fs.readFile(a, "utf8"), "original");
  await store.save({
    name: first.name,
    bytes: Buffer.from("edit2"),
    kind: "pdf",
    handle: first.handle,
    working: true,
    protect: true,
  });
  assert.equal(picked, 1);
  assert.equal(await fs.readFile(b, "utf8"), "edit2");
  await store.save({
    name: "B.pdf",
    bytes: Buffer.from("edit3"),
    kind: "pdf",
    handle: first.handle,
    working: true,
    protect: false,
  });
  assert.equal(await fs.readFile(a, "utf8"), "original");
  next = c;
  const third = await store.save({
    name: "B.pdf",
    bytes: Buffer.from("edit4"),
    kind: "pdf",
    handle: first.handle,
    working: true,
    forceAs: true,
  });
  assert.equal(third.name, "C.pdf");
  next = null;
  assert.equal(
    await store.save({
      name: "C.pdf",
      bytes: Buffer.from("x"),
      kind: "pdf",
      forceAs: true,
    }),
    null,
  );
  next = dir;
  await assert.rejects(() =>
    store.save({ name: "x.pdf", bytes: Buffer.from("x"), kind: "pdf" }),
  );
  assert.equal(await fs.readFile(b, "utf8"), "edit3");
  await store.save({
    name: "A.pdf",
    bytes: Buffer.from("explicit"),
    kind: "pdf",
    handle,
    protect: false,
  });
  assert.equal(await fs.readFile(a, "utf8"), "explicit");
});

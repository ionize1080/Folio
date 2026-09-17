import test from "node:test";
import assert from "node:assert/strict";
import { adjustWhitespace, describeChanges } from "../src/changes.mjs";
import { makeNode, applyBatch } from "../src/model.mjs";
test("visual whitespace follows four page rotations without changing page or zoom", () => {
  for (const [r, i, sign] of [
    [0, 1, 1],
    [90, 0, -1],
    [180, 1, -1],
    [270, 0, 1],
  ]) {
    const n = makeNode("A");
    n.target.args = [50, 400, 0];
    const out = adjustWhitespace(
      [n],
      new Set([n.id]),
      { amount: 5, unit: "mm" },
      [{ rotation: r, box: { x: 0 } }],
    );
    assert(
      Math.abs(
        out.nodes[0].target.args[i] - n.target.args[i] - (sign * 5 * 72) / 25.4,
      ) < 1e-8,
    );
    assert.equal(out.nodes[0].target.page, 1);
    assert.equal(out.nodes[0].target.args[2], 0);
  }
});
test("null and preserved actions are not silently rewritten", () => {
  const n = makeNode("A");
  n.target.kind = "preserve";
  n.target.args = [20, 400, null];
  assert.equal(
    adjustWhitespace([n], new Set([n.id]), { amount: 5 }, [{ rotation: 0 }])
      .skipped.length,
    1,
  );
  n.target.kind = "dest";
  n.target.args[1] = null;
  assert.equal(
    adjustWhitespace([n], new Set([n.id]), { amount: 5 }, [{ rotation: 0 }])
      .skipped.length,
    1,
  );
});
test("batch report includes original value, arithmetic and final value", () => {
  const n = makeNode("A");
  n.target.args = [50, 400, 0];
  const rule = {
    op: "parameters",
    edits: { 1: { op: "relative", value: 12 } },
  };
  const out = applyBatch([n], new Set([n.id]), rule, 1);
  assert.deepEqual(describeChanges([n], out, rule)[0].fields, [
    { name: "顶部 Y", before: 400, after: 412, operation: "原值 + 12" },
  ]);
});
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { FileStore } = createRequire(import.meta.url)("../file-store.cjs");
test("Save As overwrites an existing file and replacement failure preserves its bytes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-save3-")),
    file = path.join(dir, "existing.pdf");
  try {
    await fs.writeFile(file, "before");
    const store = new FileStore(async () => file);
    await store.save({
      name: "existing.pdf",
      kind: "pdf",
      bytes: Buffer.from("after"),
      forceAs: true,
    });
    assert.equal(await fs.readFile(file, "utf8"), "after");
    const fail = new FileStore(
      async () => file,
      async () => {
        throw Object.assign(Error("locked"), { code: "EBUSY" });
      },
    );
    await assert.rejects(
      fail.save({
        name: "existing.pdf",
        kind: "pdf",
        bytes: Buffer.from("bad"),
        forceAs: true,
      }),
      /占用/,
    );
    assert.equal(await fs.readFile(file, "utf8"), "after");
    assert.deepEqual(await fs.readdir(dir), ["existing.pdf"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

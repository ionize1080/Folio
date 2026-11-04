import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { StorageBudget, DEFAULT_LIMIT_MB } = createRequire(import.meta.url)(
  "../storage-budget.cjs",
);
test("default 2GB, oldest cache rotates; active large-file storage temporarily raises budget", async () => {
  assert.equal(DEFAULT_LIMIT_MB, 2048);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-budget-test-"));
  try {
    const b = new StorageBudget(1 / 1024);
    const put = async (name, size, pinned = false) => {
      const f = path.join(dir, name);
      await fs.writeFile(f, Buffer.alloc(size));
      await b.add(f, { pinned });
      return f;
    };
    const a = await put("a", 500),
      c = await put("c", 500);
    b.touch(a);
    await put("d", 500);
    await assert.rejects(fs.access(c));
    await fs.access(a);
    const active = await put("active", 4096, true);
    await fs.access(active);
    assert.equal(b.status().effectiveLimitBytes, 4096);
    assert.equal(b.status().temporaryOverage, 3072);
    assert.equal(b.status().bytes, 4096);
    b.forget(active);
    await fs.unlink(active);
    assert.equal((await b.trim()).effectiveLimitBytes, 1024);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("leases prevent eviction during PDF operations and release trims immediately", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-budget-test-"));
  try {
    const b = new StorageBudget(1 / 1024),
      file = path.join(dir, "snapshot.pdf");
    await fs.writeFile(file, Buffer.alloc(900));
    await b.add(file);
    const release = b.lease([file]);
    const f = path.join(dir, "other.pdf");
    await fs.writeFile(f, Buffer.alloc(900));
    await b.add(f);
    await fs.access(file);
    await assert.rejects(fs.access(f));
    await release();
    await assert.rejects(b.setLimit(0));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

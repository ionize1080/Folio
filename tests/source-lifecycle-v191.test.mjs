import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { SourceStore } = require("../source-store.cjs");
const bytes = Buffer.from("%PDF-1.7\nsource lifecycle fixture");

test("normal document replacements release more than sixteen sources", async () => {
  const store = new SourceStore();
  try {
    let previous;
    for (let i = 0; i < 32; i++) {
      if (previous) await store.release(previous.handle);
      previous = await store.register(bytes);
      assert.equal(store.entries.size, 1);
    }
  } finally {
    await store.close();
  }
});

test("renderer clear reuses its directory through more than sixteen reloads", async () => {
  const store = new SourceStore();
  try {
    let directory;
    for (let i = 0; i < 32; i++) {
      const source = await store.register(bytes);
      directory ||= store.root;
      assert.equal(store.root, directory);
      await store.clear();
      assert.equal(store.entries.size, 0);
      assert.throws(() => store.acquire(source.handle), /失效/);
    }
    assert.deepEqual(await fs.readdir(directory), ["folio-owner.json"]);
  } finally {
    await store.close();
  }
});

test("clear invalidates an in-flight write without collecting a new generation", async (t) => {
  const store = new SourceStore();
  const writeFile = fs.writeFile;
  let resume, entered, oldFile;
  const gate = new Promise((resolve) => (resume = resolve));
  const writing = new Promise((resolve) => (entered = resolve));
  const mock = t.mock.method(fs, "writeFile", async (...args) => {
    if (String(args[0]).endsWith(".pdf") && !oldFile) {
      oldFile = args[0];
      entered();
      await gate;
    }
    return writeFile(...args);
  });
  try {
    const old = store.register(bytes);
    const rejected = assert.rejects(old, /重新加载/);
    await writing;
    await store.clear();
    const current = await store.register(bytes);
    resume();
    await rejected;
    assert.equal(store.registering, 0);
    assert.equal(store.entries.size, 1);
    assert(store.entries.has(current.handle));
    await assert.rejects(fs.readFile(oldFile), { code: "ENOENT" });
  } finally {
    resume();
    mock.mock.restore();
    await store.close();
  }
});

test("clear preserves a leased old file until the native request releases it", async () => {
  const store = new SourceStore();
  try {
    const source = await store.register(bytes);
    const lease = store.acquire(source.handle);
    await store.clear();
    assert.throws(() => store.acquire(source.handle), /失效/);
    assert.deepEqual(await fs.readFile(lease.file), bytes);
    const current = await store.register(bytes);
    await lease.release();
    await assert.rejects(fs.readFile(lease.file), { code: "ENOENT" });
    assert.deepEqual([...store.entries.keys()], [current.handle]);
  } finally {
    await store.close();
  }
});

test("the source limit still rejects a seventeenth live source", async () => {
  const store = new SourceStore();
  try {
    for (let i = 0; i < 16; i++) await store.register(bytes);
    await assert.rejects(store.register(bytes), /过多/);
    await store.clear();
    await store.register(bytes);
    assert.equal(store.entries.size, 1);
  } finally {
    await store.close();
  }
});

test("terminal close waits for a pending write and rejects later registration", async (t) => {
  const store = new SourceStore();
  const writeFile = fs.writeFile;
  let resume, entered;
  const gate = new Promise((resolve) => (resume = resolve));
  const writing = new Promise((resolve) => (entered = resolve));
  const mock = t.mock.method(fs, "writeFile", async (...args) => {
    if (String(args[0]).endsWith(".pdf")) {
      entered();
      await gate;
    }
    return writeFile(...args);
  });
  try {
    const pending = store.register(bytes);
    const rejected = assert.rejects(pending, /重新加载/);
    await writing;
    const closed = store.close();
    resume();
    await rejected;
    await closed;
    assert.equal(store.entries.size, 0);
    await assert.rejects(fs.stat(store.root), { code: "ENOENT" });
    await assert.rejects(store.register(bytes), /已关闭/);
  } finally {
    resume();
    mock.mock.restore();
    await store.close();
  }
});

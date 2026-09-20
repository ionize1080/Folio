const { LargeFiles } = require("../large-files.cjs");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-large-test-"));
  const input = path.join(dir, "in.pdf"),
    output = path.join(dir, "out.pdf");
  await fs.writeFile(input, "%PDF-test-data");
  await fs.writeFile(output, "KEEP");
  const store = new LargeFiles("", null, async () => output);
  try {
    const f = await store.register(input);
    assert.equal(
      (await store.read({ handle: f.handle, offset: 0, length: 5 })).toString(),
      "%PDF-",
    );
    await assert.rejects(
      store.read({ handle: f.handle, offset: 0, length: 4 * 1024 ** 2 + 1 }),
    );
    await assert.rejects(store.read({ handle: "wrong", offset: 0, length: 1 }));
    store.writer.request = async () => {
      throw Error("interrupted");
    };
    await assert.rejects(store.save({ handle: f.handle, outlines: [] }));
    assert.equal(await fs.readFile(output, "utf8"), "KEEP");
    assert.deepEqual((await fs.readdir(dir)).sort(), ["in.pdf", "out.pdf"]);
    await fs.appendFile(input, "changed");
    await assert.rejects(
      store.read({ handle: f.handle, offset: 0, length: 5 }),
      /修改/,
    );
    await store.release(f.handle);
    console.log(
      "PASS large file capability, bounds, mutation and atomic-failure checks",
    );
  } finally {
    await store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

const fs = require("fs/promises"),
  path = require("path"),
  os = require("os"),
  assert = require("assert/strict");
const { OCRJobs } = require("../ocr-jobs.cjs");
(async () => {
  const root = path.resolve(__dirname, ".."),
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-ocr-test-")),
    jobs = new OCRJobs(path.join(root, "native"), dir, "python3"),
    checks = [];
  try {
    const data = {
      bytes: await fs.readFile(path.join(root, "tests/output/v4-scan.pdf")),
      pages: [4, 1, 3, 2],
      profile: "v6",
      mode: "custom",
      workers: 2,
      threads: 2,
      resume: true,
    };
    let s = await jobs.start(data);
    while (s.running) {
      await new Promise((r) => setTimeout(r, 200));
      s = jobs.status();
    }
    assert.equal(s.failed.length, 0, JSON.stringify(s.failed));
    assert.deepEqual(s.done, [1, 2, 3, 4]);
    checks.push("Concurrent pages finish with stable sorted result order");
    const id = s.id;
    const p = await jobs.page({ id, page: 2 });
    p.blocks[0].text = "persisted correction";
    await jobs.correct({ id, page: 2, blocks: p.blocks });
    s = await jobs.start(data);
    assert.equal(s.restored, 4);
    assert.equal(
      (await jobs.page({ id: s.id, page: 2 })).blocks[0].text,
      "persisted correction",
    );
    checks.push(
      "Completed pages and corrections resume without repeated inference",
    );
    await jobs.stop();
    s = await jobs.start({ ...data, resume: false });
    await jobs.stop();
    assert(!jobs.status().running);
    checks.push(
      "Cancel terminates workers and retains readable completed results",
    );
    await fs.writeFile(
      path.join(root, "tests/output/v4-jobs-report.json"),
      JSON.stringify({ checks, plan: s.plan }, null, 2),
    );
    console.log(checks);
  } finally {
    await jobs.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { NativeBridge } = require("../native-bridge.cjs");
os.totalmem = () => 32 * 1024 ** 3;
os.availableParallelism = () => 16;
let free = 1 * 1024 ** 3;
os.freemem = () => free;
NativeBridge.prototype.request = async function (d) {
  await new Promise((r) => setTimeout(r, 90));
  if (d.page === 1) throw Error("simulated worker exit");
  return {
    blocks: [],
    skipped: false,
    rss: 0.8 * 1024 ** 3,
    timing: { load: 0, total: 0.09 },
  };
};
NativeBridge.prototype.cancel = function () {};
const { OCRJobs } = require("../ocr-jobs.cjs");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-scheduler-")),
    jobs = new OCRJobs(path.resolve("native"), dir);
  try {
    await jobs.start({
      bytes: Buffer.from("mocked PDF"),
      pages: Array.from({ length: 150 }, (_, i) => i + 1),
      mode: "high",
      resume: false,
    });
    assert.equal(jobs.status().actualWorkers, 1);
    let peak = 1;
    free = 30 * 1024 ** 3;
    while (jobs.status().running) {
      await new Promise((r) => setTimeout(r, 70));
      peak = Math.max(peak, jobs.status().actualWorkers);
    }
    const s = jobs.status();
    assert(peak >= 3, `peak=${peak}`);
    assert.equal(s.done.length, 149);
    assert.equal(s.failed.length, 1);
    assert.equal(s.actualWorkers, 0);
    assert(s.rate > 0);
    console.log(
      "PASS memory recovers -> concurrency grows beyond two; worker failure isolates one page; peak",
      peak,
    );
    await fs.writeFile(
      "tests/output/v5-scheduler-report.json",
      JSON.stringify(
        {
          peak,
          done: s.done.length,
          failed: s.failed.length,
          kind: "simulated resources and worker replies",
        },
        null,
        2,
      ),
    );
  } finally {
    await jobs.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

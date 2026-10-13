import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { OCRJobs } = createRequire(import.meta.url)("../ocr-jobs.cjs");
test("explicit skip applies 5000 doubts without accepting, deleting, or mutating source blocks", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-skip-"));
  const jobs = new OCRJobs(path.resolve("native"), dir, "python");
  try {
    const base = Array.from({ length: 5000 }, (_, i) => ({
      id: String(i),
      page: 1,
      text: "Test",
      confidence: 0.4,
      needsReview: true,
    }));
    base.push({
      id: "excluded",
      page: 1,
      text: "X",
      excluded: true,
      needsReview: true,
    });
    base.push({
      id: "corrected",
      page: 1,
      text: "Correction",
      corrected: true,
      needsReview: true,
    });
    await assert.rejects(jobs.collect({ base }), /5000/);
    const result = await jobs.collect({ base, skipReview: true });
    assert.equal(result.skippedReview, 5000);
    assert.equal(result.blocks.length, 5002);
    assert(
      result.blocks
        .slice(0, 5000)
        .every(
          (b) =>
            b.reviewSkipped &&
            b.needsReview &&
            !b.reviewAccepted &&
            b.text === "Test",
        ),
    );
    assert(!base[0].reviewSkipped);
    assert(result.blocks[5000].excluded);
    const saved = (
      await fs.readFile(jobs.resolveReference(result.reference), "utf8")
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(saved, result.blocks);
    const missing = await jobs.collect({
      base: [{ page: 1, text: "\u{10ffff}", needsReview: true }],
      skipReview: true,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.count, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

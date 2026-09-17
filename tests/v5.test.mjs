import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { History } from "../src/model.mjs";
const require = createRequire(import.meta.url);
const { OCRJobs, normalizeBlocks, resourcePlan } = require("../ocr-jobs.cjs");
test("OCR data over 32 MiB remains undoable without per-bookmark copies", () => {
  const ocr = Array.from({ length: 758 * 200 }, (_, i) => ({
    page: 1 + (i % 758),
    text: "中文".repeat(40),
    quad: [
      [1, 2],
      [3, 2],
      [3, 1],
      [1, 1],
    ],
    confidence: 0.99,
  }));
  assert(JSON.stringify(ocr).length * 2 > 32 * 1024 ** 2);
  const h = new History();
  for (let i = 0; i < 8; i++) h.push({ nodes: [{ title: String(i) }], ocr });
  assert.equal(h.past.length, 8);
  assert(h.past.every((e) => e.ocr === ocr));
  const previous = h.undo({ nodes: [{ title: "8" }], ocr });
  assert.equal(previous.nodes[0].title, "7");
  assert.equal(previous.ocr, ocr);
  assert.equal(h.redo(previous).nodes[0].title, "8");
  assert.throws(() => {
    ocr[0].text = "mutated";
  }, TypeError);
});
test("language preference preserves confidence and original text; conversion explicit", () => {
  const b = { page: 1, text: "臺灣經濟發展", confidence: 0.999, quad: [] };
  const [raw] = normalizeBlocks([b]);
  assert.equal(raw.text, b.text);
  assert(raw.scriptIssue);
  const [cn] = normalizeBlocks([b], { outputScript: "simplified" });
  assert.equal(cn.text, "台湾经济发展");
  assert.equal(cn.rawText, b.text);
  assert.equal(cn.confidence, 0.999);
  const [tw] = normalizeBlocks([cn], { outputScript: "traditional" });
  assert.equal(tw.text, b.text);
});
test("font preflight blocks application, explicit exclusion does not mutate history", async () => {
  const store = await fs.mkdtemp(path.join(os.tmpdir(), "folio-v5-"));
  try {
    const jobs = new OCRJobs(path.resolve("native"), store);
    const base = Object.freeze([
      Object.freeze({
        id: "1:0",
        page: 1,
        text: "ϕ 中文\u200b",
        quad: [],
        confidence: 0.9,
      }),
      Object.freeze({
        id: "1:1",
        page: 1,
        text: "\u{10ffff}",
        quad: [],
        confidence: 0.9,
      }),
    ]);
    const report = await jobs.collect({ base });
    assert.equal(report.count, 1);
    assert(!report.reference);
    assert.equal(report.cleaned, 1);
    const r = await jobs.collect({ base, excludeUnsupported: true });
    assert(r.reference);
    assert(r.blocks[1].excluded);
    assert(!base[1].excluded);
    const lines = (
      await fs.readFile(jobs.resolveReference(r.reference), "utf8")
    )
      .trim()
      .split("\n");
    assert.equal(lines.length, 2);
    assert.throws(() => jobs.resolveReference("../input.pdf"));
  } finally {
    await fs.rm(store, { recursive: true, force: true });
  }
});
test("resource planning honors thread and CPU bounds without a fixed two-process limit", () => {
  const p = resourcePlan(
    { mode: "high" },
    os.totalmem() + 20 * 1024 ** 3,
    16,
    0.8 * 1024 ** 3,
  );
  assert.equal(p.workers, 8);
  assert.equal(p.threads, 2);
  const low = resourcePlan({ mode: "high" }, 0.5 * 1024 ** 3, 16);
  assert.equal(low.workers, 1);
  assert(low.memoryLimited);
});
test("different OCR versions obey their separate history budget", () => {
  const h = new History(40, 32 * 1024 ** 2, 1000);
  for (let i = 0; i < 5; i++)
    h.push({
      nodes: [{ title: String(i) }],
      ocr: [{ page: 1, text: String(i).repeat(1000), quad: [] }],
    });
  assert.equal(h.past.length, 1);
  assert.equal(h.undo({ nodes: [], ocr: [] }).nodes[0].title, "4");
});

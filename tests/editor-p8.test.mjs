import test from "node:test";
import assert from "node:assert/strict";
import { constrainedDelta, nudgeDelta } from "../src/object-movement.mjs";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url),
  { NativeBridge } = require("../native-bridge.cjs"),
  { mergeReview } = require("../ocr-review-merge.cjs");
test("constrained drag and visual nudge at all page rotations", () => {
  assert.deepEqual(constrainedDelta(18, -4, true), { x: 18, y: 0 });
  assert.deepEqual(constrainedDelta(-3, 20, true), { x: 0, y: 20 });
  assert.deepEqual(constrainedDelta(18, -4, false), { x: 18, y: -4 });
  assert.deepEqual(nudgeDelta("ArrowRight"), { x: 1, y: 0 });
  assert.deepEqual(nudgeDelta("ArrowDown", true), { x: 0, y: 10 });
  assert.deepEqual(nudgeDelta("ArrowRight", false, 90), { x: 0, y: -1 });
  assert.deepEqual(nudgeDelta("ArrowRight", false, 180), { x: -1, y: -0 });
  assert.deepEqual(nudgeDelta("ArrowRight", false, 270), { x: -0, y: 1 });
  assert.equal(nudgeDelta("a"), null);
});
const block = (id, text, x = 0, extra = {}) => ({
  id,
  page: 1,
  text,
  quad: [
    [x, 20],
    [x + 30, 20],
    [x + 30, 10],
    [x, 10],
  ],
  ...extra,
});
test("OCR refresh preserves manual text, exclusions and unmatched corrections without duplicates", () => {
  const previous = [
    block("1", "corrected", 0, { corrected: true }),
    block("2", "excluded", 50, { excluded: true }),
    block("3", "unmatched", 100, { reviewAccepted: true }),
  ];
  const result = mergeReview(
    [block("a", "wrong", 1), block("b", "wrong", 51), block("c", "new", 160)],
    previous,
  );
  assert.equal(result.length, 4);
  assert.deepEqual(
    new Set(result.map((b) => b.text)),
    new Set(["corrected", "excluded", "unmatched", "new"]),
  );
  assert.equal(result.find((b) => b.id === "2").excluded, true);
  const region = mergeReview(
    [block("c", "inside", 160)],
    [block("old", "outside")],
    {
      regionQuad: [
        [150, 30],
        [200, 30],
        [200, 0],
        [150, 0],
      ],
    },
  );
  assert.equal(region.length, 2);
});
test(
  "native protocol rejects contamination, wrong IDs, duplicate/late output; timeout and restart recover",
  { timeout: 20000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-protocol-"));
    await fs.writeFile(
      path.join(dir, "worker.py"),
      `import sys,json,time\nfor line in sys.stdin:\n a=json.loads(line);c=a['command'];m={'requestId':a['requestId'],'epoch':a['epoch'],'result':c}\n if c=='hang':time.sleep(5)\n if c=='bad':print('not-json',flush=True);continue\n if c=='log':print(json.dumps({'log':'hello'}),flush=True);continue\n if c=='wrong':m['requestId']+=1\n print(json.dumps(m),flush=True)\n if c=='duplicate':print(json.dumps(m),flush=True)\n`,
    );
    const bridge = new NativeBridge(
      dir,
      process.env.FOLIO_PYTHON ||
        (process.platform === "win32" ? "python" : "python3"),
      null,
      { hang: 100 },
    );
    try {
      assert.equal(await bridge.request({ command: "ok" }), "ok");
      for (const command of ["bad", "log", "wrong", "hang"]) {
        await assert.rejects(bridge.request({ command }));
        assert.equal(await bridge.request({ command: "ok" }), "ok");
      }
      await bridge.request({ command: "duplicate" });
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(await bridge.request({ command: "ok" }), "ok");
      const hung = bridge.request({ command: "hang" }),
        queued = bridge.request({ command: "ok" });
      await Promise.all([assert.rejects(hung), assert.rejects(queued)]);
      assert.equal(await bridge.request({ command: "ok" }), "ok");
    } finally {
      bridge.cancel();
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

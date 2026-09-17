import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  canvas = require(
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/@napi-rs/canvas",
  );
Object.assign(globalThis, {
  DOMMatrix: canvas.DOMMatrix,
  ImageData: canvas.ImageData,
  Path2D: canvas.Path2D,
});
Uint8Array.prototype.toHex ??= function () {
  return Buffer.from(this).toString("hex");
};
const pdfjs = await import("../src/vendor/pdf.mjs");
const { extractLines } = await import("../src/text-lines.mjs");
const { generateRules, industryRules } = await import("../src/generation.mjs");
const pdf = await pdfjs.getDocument({
  data: new Uint8Array(fs.readFileSync(process.argv[2])),
  isEvalSupported: false,
}).promise;
let lines = [];
const started = performance.now();
for (let p = 11; p <= 117; p++) {
  const page = await pdf.getPage(p);
  lines.push(
    ...(await extractLines(pdf, p, page.rotate, { visualRows: true })),
  );
}
const r = generateRules({
  lines,
  rules: industryRules,
  pageCount: pdf.numPages,
});
const first = r.nodes.filter((n) => n.target.page === 11);
assert.equal(first.length, 14);
assert.equal(first[0].title, "A 农、林、牧、渔业");
assert(first.every((n) => /^\S+\s+\S/.test(n.title)));
fs.writeFileSync(
  "tests/output/v6-industry-report.json",
  JSON.stringify(
    {
      pages: 107,
      lines: lines.length,
      nodes: r.nodes.length,
      ms: performance.now() - started,
      page11: first.map((n) => n.title),
      orphans: r.orphans,
      conflicts: r.conflicts,
    },
    null,
    2,
  ),
);
console.log(
  "PASS industry pages 11–117",
  r.nodes.length,
  "bookmarks",
  first.map((n) => n.title),
);
await pdf.destroy();

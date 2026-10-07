// Optional local corpus: no third-party PDFs are distributed in the release.
import fs from "node:fs";
import path from "node:path";
import {
  recognizeTocPage,
  resolveTocEntries,
  entriesToNodes,
} from "../src/smart-toc.mjs";
const input = process.argv[2],
  output = process.argv[3] || "tests/output/smart-toc-corpus.json";
const report = [];
for (const name of fs.readdirSync(input).filter((n) => n.endsWith(".json"))) {
  const d = JSON.parse(fs.readFileSync(path.join(input, name), "utf8")),
    start = Date.now();
  const found = d.toc.map((p) => recognizeTocPage(p)),
    selected = found.filter((p) => p.selected);
  const entries = selected.flatMap((p) => p.entries).slice(0, 200);
  const resolved = resolveTocEntries(
    entries,
    d.pages,
    d.pageCount,
    [],
    selected.map((p) => p.page),
  );
  const nodes = entriesToNodes(resolved, d.pageCount);
  const row = {
    name: d.name,
    pages: d.pageCount,
    scanPages: d.toc.length,
    emptyPages: found.filter((p) => p.empty).map((p) => p.page),
    candidates: selected.map((p) => ({
      page: p.page,
      score: p.score,
      entries: p.entries.length,
    })),
    extracted: selected.reduce((n, p) => n + p.entries.length, 0),
    matchedSample: resolved.length,
    high: nodes.length,
    review: resolved.filter((e) => e.candidates.length && !e.selected).length,
    unmatched: resolved.filter((e) => !e.candidates.length).length,
    examples: resolved.slice(0, 12).map((e) => ({
      title: e.title,
      printed: e.printedLabel,
      source: e.sourcePage,
      target: e.target?.page,
      candidates: e.candidates.slice(0, 3).map((c) => c.page),
    })),
    seconds: (Date.now() - start) / 1000,
  };
  report.push(row);
  console.log(
    d.name,
    JSON.stringify({
      candidates: row.candidates.length,
      entries: row.extracted,
      high: row.high,
      seconds: row.seconds,
    }),
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        note: "Exploratory unlabelled corpus: counts are not accuracy. First 50 pages detected; up to 200 entries matched against full document text. OCR not run in this pass.",
        documents: report,
      },
      null,
      2,
    ),
  );
}

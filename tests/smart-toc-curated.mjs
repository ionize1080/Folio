// Human-reviewed pages from the optional external corpus (not redistributed).
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { recognizeTocPage, resolveTocEntries } from "../src/smart-toc.mjs";
const dir = process.argv[2],
  checks = [];
const docs = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f))));
const get = (name, page) => {
  const d = docs.find((d) => d.name.includes(name));
  assert(d, name);
  return [d, recognizeTocPage(d.toc.find((p) => p.page === page))];
};
{
  const [d, r] = get("moma-art", 3);
  assert(r.selected);
  assert.equal(r.entries.length, 7);
  assert.deepEqual(
    r.entries.map((e) => e.printedLabel).sort(),
    ["4", "8", "9", "12", "14", "24", "26"].sort(),
  );
  assert(
    r.entries.some(
      (e) => e.title === "The Value of Good Design" && e.printedLabel === "8",
    ),
  );
  const matches = resolveTocEntries(r.entries, d.pages, d.pageCount, [], [3]);
  // Printed spread numbers differ from physical PDF pages; keep alternatives.
  assert(
    matches
      .find((e) => e.title === "The Value of Good Design")
      .candidates.some((c) => c.page === 6),
  );
  checks.push(
    "MoMA image grid: 7/7 human-counted entries and all seven printed labels; Good Design offers actual PDF page 6 for printed page 8",
  );
}
{
  const [d, r] = get("insee-fr-art", 3);
  assert(r.selected);
  assert.equal(r.entries.length, 25);
  assert(
    r.entries.some(
      (e) =>
        e.title === "ALLER AU-DEVANT DE TOUS LES PUBLICS" &&
        e.printedLabel === "27",
    ),
  );
  assert(
    r.entries.some(
      (e) =>
        e.title === "Enrichir l’offre pour les utilisateurs avertis" &&
        e.printedLabel === "28",
    ),
  );
  checks.push(
    "French artistic annual report: 25/25 human-counted entries, including page-first labels and wrapped display headings",
  );
}
{
  const [d, r] = get("HLP_", 2);
  assert(r.selected);
  assert.equal(r.entries.length, 6);
  assert.deepEqual(
    r.entries.map((e) => e.printedLabel),
    ["1", "2", "27", "30", "41", "43"],
  );
  assert.deepEqual(
    d.toc
      .map((p) => recognizeTocPage(p))
      .filter((r) => r.selected)
      .map((r) => r.page),
    [2],
  );
  checks.push(
    "Traditional Chinese report: 6/6 contents labels; financial tables across all 45 pages are not auto-selected as contents",
  );
}
fs.mkdirSync("tests/output", { recursive: true });
fs.writeFileSync(
  "tests/output/smart-toc-curated-report.json",
  JSON.stringify({ checks, errors: [] }, null, 2),
);
console.log(checks.join("\n"));

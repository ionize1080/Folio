import fs from "node:fs";
import path from "node:path";
import {
  recognizeTocPages,
  resolveTocEntries,
  entriesToNodes,
} from "../src/smart-toc.mjs";
const input = process.argv[2] || "../baseline",
  out = process.argv[3] || "../after";
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(input).filter((n) => n.endsWith(".json"))) {
  const d = JSON.parse(fs.readFileSync(path.join(input, name)));
  const found = recognizeTocPages(d.toc),
    selected = found.filter((p) => p.selected),
    entries = selected.flatMap((p) => p.entries);
  console.log(
    d.name,
    selected.map((p) => [p.page, p.entries.length, p.columns]),
  );
  const result = process.env.EXTRACT_ONLY
    ? entries
    : resolveTocEntries(
        entries,
        d.pages,
        d.pageCount,
        d.labels,
        selected.map((p) => p.page),
      );
  fs.writeFileSync(
    path.join(out, name),
    JSON.stringify(
      {
        name: d.name,
        pageCount: d.pageCount,
        found: found.filter((p) => p.selected),
        result,
      },
      null,
      2,
    ),
  );
}

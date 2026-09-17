import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFHexString,
  PDFNull,
} from "../src/vendor/pdf-lib.js";
import { PdfEngine } from "../src/pdf-core.mjs";
import {
  makeNode,
  validate,
  move,
  applyBatch,
  parseTOC,
  History,
  importJSON,
  deduplicate,
} from "../src/model.mjs";
const N = (s) => PDFName.of(s);
let fixture;
async function base() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 12; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText("Folio test page " + (i + 1), { x: 48, y: 775, size: 22 });
    p.drawText("A bookmark-first workspace for long documents.", {
      x: 48,
      y: 720,
      size: 12,
    });
  }
  return doc.save();
}
async function engine() {
  const e = new PdfEngine();
  await e.open(await base());
  return e;
}
test("all eight destination types and null / zero roundtrip", async () => {
  const e = await engine(),
    specs = [
      ["XYZ", [null, 0, 0]],
      ["Fit", []],
      ["FitH", [700]],
      ["FitV", [null]],
      ["FitR", [0, 20, 400, 700]],
      ["FitB", []],
      ["FitBH", [null]],
      ["FitBV", [30]],
    ];
  const nodes = specs.map(([mode, args], i) => ({
    ...makeNode("章节 " + mode, i + 1),
    target: { kind: "dest", page: i + 1, mode, args },
  }));
  const b = await e.save({ nodes });
  const re = new PdfEngine(),
    r = await re.open(b);
  assert.equal(r.nodes.length, 8);
  for (let i = 0; i < 8; i++) {
    assert.deepEqual(r.nodes[i].target.args, specs[i][1]);
    assert.equal(r.nodes[i].target.mode, specs[i][0]);
    assert.equal(r.nodes[i].title, nodes[i].title);
  }
  await mkdir("tests/output", { recursive: true });
  await writeFile("tests/output/modes.pdf", b);
});
test("original chained actions, named destinations and unknown keys survive rename and move", async () => {
  const d = await PDFDocument.load(await base()),
    c = d.context,
    p = d.getPages()[2],
    a = c.obj({
      S: "GoTo",
      D: c.obj([p.ref, N("XYZ"), PDFNull, PDFNumber.of(500), PDFNull]),
      Next: c.obj({
        S: "URI",
        URI: PDFHexString.fromText("https://example.com"),
      }),
    });
  const one = c.obj({
      Title: PDFHexString.fromText("原始动作"),
      A: a,
      CustomFlag: PDFNumber.of(123),
    }),
    two = c.obj({
      Title: PDFHexString.fromText("Named"),
      Dest: PDFHexString.fromText("chapter"),
    });
  const r1 = c.register(one),
    r2 = c.register(two),
    root = c.obj({ Type: "Outlines", First: r1, Last: r2, Count: 2 }),
    rr = c.register(root);
  one.set(N("Parent"), rr);
  two.set(N("Parent"), rr);
  one.set(N("Next"), r2);
  two.set(N("Prev"), r1);
  d.catalog.set(N("Outlines"), rr);
  d.catalog.set(
    N("Names"),
    c.obj({
      Dests: c.obj({
        Names: c.obj([
          PDFHexString.fromText("chapter"),
          c.obj([d.getPages()[4].ref, N("Fit")]),
        ]),
      }),
    }),
  );
  const e = new PdfEngine(),
    r = await e.open(await d.save());
  assert.equal(r.nodes[1].target.page, 5);
  r.nodes[0].title = "已改名";
  const before = e.sources.get(r.nodes[0].sourceRef).get(N("A")).toString();
  const out = await e.save({ nodes: r.nodes }),
    e2 = new PdfEngine(),
    r3 = await e2.open(out);
  const src = e2.sources.get(r3.nodes[0].sourceRef);
  assert.equal(src.get(N("A")).toString(), before);
  assert.equal(src.get(N("CustomFlag")).asNumber(), 123);
  assert.equal(r3.nodes[1].target.named, "chapter");
  await writeFile("tests/output/preserved.pdf", out);
});
test("visible descendant counts, open flags, unicode and style", async () => {
  const e = await engine(),
    a = makeNode("第一章", 1),
    b = makeNode("封闭子层", 2, a.id),
    c = makeNode("孙层", 3, b.id),
    d = makeNode("次级", 4, a.id);
  b.open = false;
  b.bold = true;
  b.italic = true;
  b.color = "#ff0080";
  const out = await e.save({ nodes: [a, b, c, d] }),
    re = new PdfEngine(),
    r = await re.open(out);
  assert.equal(r.nodes[1].open, false);
  assert.equal(r.nodes[1].color, "#ff0080");
  assert.equal(r.nodes[1].bold, true);
  const da = re.sources.get(r.nodes[0].sourceRef),
    db = re.sources.get(r.nodes[1].sourceRef);
  assert.equal(da.get(N("Count")).asNumber(), 2);
  assert.equal(db.get(N("Count")).asNumber(), -1);
});
test("repeat save does not accumulate annotations; extraction and rotation", async () => {
  const e = await engine(),
    nodes = [makeNode("A", 1)],
    annotations = [
      {
        page: 1,
        type: "highlight",
        rect: [48, 710, 330, 730],
        text: "note 中文",
        color: "#ffff00",
      },
    ],
    opts = { nodes, annotations, rotations: { 1: 90 } };
  await e.save(opts);
  const b = await e.save(opts),
    d = await PDFDocument.load(b);
  assert.equal(d.getPage(0).node.Annots().size(), 1);
  assert.equal(d.getPage(0).getRotation().angle, 90);
  assert.equal(
    (await PDFDocument.load(await e.extractPages([0, 3, 5]))).getPageCount(),
    3,
  );
  await writeFile("tests/output/annotations.pdf", b);
});
test("invalid ranges and coordinates reject transactionally", () => {
  const n = makeNode("A", 1);
  assert.throws(() =>
    applyBatch([n], new Set([n.id]), { op: "offset", amount: -2 }, 12),
  );
  assert.equal(n.target.page, 1);
  const bad = structuredClone(n);
  bad.target = { kind: "dest", page: 1, mode: "FitR", args: [0, 0, 0, 100] };
  assert.throws(() => validate([bad], 12));
});
test("subtree moves cannot introduce cycles and maintain contiguous preorder", () => {
  const a = makeNode("A"),
    b = makeNode("B", 2, a.id),
    c = makeNode("C", 3, b.id),
    d = makeNode("D");
  const nodes = [a, b, c, d];
  assert.throws(() => move(nodes, new Set([a.id]), c.id, "inside"));
  const out = move(nodes, new Set([b.id]), d.id, "after");
  assert.deepEqual(
    out.map((n) => n.title),
    ["A", "D", "B", "C"],
  );
  assert.equal(out[2].parent, null);
  assert.equal(out[3].parent, b.id);
});
test("TOC nesting, numbering, regex captures and JSON import", () => {
  const { nodes, bad } = parseTOC(
    "Chapter 1\t1\n  Section 1.1 .... 2\nignored\nChapter 2 …… 3",
    12,
    2,
  );
  assert.equal(nodes.length, 3);
  assert.equal(nodes[1].parent, nodes[0].id);
  assert.equal(nodes[2].target.page, 5);
  assert.equal(bad, 1);
  const out = applyBatch(
    nodes,
    new Set(nodes.map((n) => n.id)),
    { op: "replace", find: "Chapter (\\d+)", replacement: "章节 $1" },
    12,
  );
  assert.equal(out[0].title, "章节 1");
  const data = importJSON(
    JSON.stringify({ format: "folio-outline/1", nodes }),
    12,
  );
  assert.notEqual(data.nodes[0].id, nodes[0].id);
  assert.equal(data.nodes[1].parent, data.nodes[0].id);
});
test("undo history restores complete document state", () => {
  const h = new History(3),
    a = { nodes: [makeNode("a")], rotation: { 1: 90 }, annotations: [] };
  h.push(a);
  a.nodes[0].title = "b";
  const old = h.undo(a);
  assert.equal(old.nodes[0].title, "a");
  assert.equal(h.redo(old).nodes[0].title, "b");
});
test("10,000 bookmark benchmark, batch update and save", async () => {
  const e = await engine(),
    nodes = [];
  for (let i = 0; i < 10000; i++) {
    const n = makeNode(
      "Bookmark " + i,
      (i % 12) + 1,
      i % 10 ? nodes[i - (i % 10)].id : null,
    );
    nodes.push(n);
  }
  const start = performance.now();
  const out = applyBatch(
    nodes,
    new Set(nodes.map((n) => n.id)),
    { op: "number", template: "{n} {title}", start: 1 },
    12,
  );
  const batch = performance.now() - start;
  const t = performance.now(),
    bytes = await e.save({ nodes: out }),
    save = performance.now() - t;
  const reopened = new PdfEngine(),
    r = await reopened.open(bytes);
  assert.equal(r.nodes.length, 10000);
  await writeFile(
    "tests/output/benchmark.json",
    JSON.stringify(
      {
        nodes: 10000,
        batch_ms: batch,
        save_ms: save,
        output_bytes: bytes.length,
        node: process.version,
      },
      null,
      2,
    ),
  );
  await writeFile("tests/output/10000-bookmarks.pdf", bytes);
  console.log("BENCHMARK", JSON.stringify({ batch_ms: batch, save_ms: save }));
});

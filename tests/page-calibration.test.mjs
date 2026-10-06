import test from "node:test";
import assert from "node:assert/strict";
import {
  calibratePages,
  applyPageCalibration,
  calibrationLines,
} from "../src/page-calibration.mjs";
import { parsePageLabel, samePageLabel } from "../src/page-labels.mjs";
import { makeNode, parseTOC, History } from "../src/model.mjs";
const line = (text, page, extra = {}) => ({
  text,
  page,
  left: 40,
  right: 350,
  top: 100,
  bottom: 116,
  height: 800,
  x: 40,
  y: 700,
  upX: 0,
  upY: 1,
  source: "PDF",
  ...extra,
});
const run = (nodes, pages, extra = {}) =>
  calibratePages({ nodes, pages, pageCount: 100, offset: 0, ...extra });
test("every row has an independent offset, including negative, unchanged and out-of-order targets", () => {
  const nodes = [
    makeNode("Chapter Alpha", 2),
    makeNode("Chapter Beta", 9),
    makeNode("Chapter Gamma", 3),
    makeNode("Chapter Delta", 7),
  ];
  const pages = {
    29: [line(nodes[0].title, 29)],
    6: [line(nodes[1].title, 6)],
    12: [line(nodes[2].title, 12)],
    7: [line(nodes[3].title, 7)],
  };
  const r = run(nodes, pages);
  assert.deepEqual(
    r.map((r) => r.delta),
    [27, -3, 9, 0],
  );
  assert.deepEqual(
    r.map((r) => r.candidates[0].page),
    [29, 6, 12, 7],
  );
  assert(r.every((r) => r.status === "high"));
  // Moving the old targets arbitrarily must not change ranking or confidence.
  const moved = nodes.map((n) => ({ ...n, target: { ...n.target, page: 80 } }));
  assert.deepEqual(
    run(moved, pages).map((r) => [r.candidates, r.confidence]),
    r.map((r) => [r.candidates, r.confidence]),
  );
});
test("all pages are compared: body mention on old page never hides later actual heading", () => {
  const n = makeNode("Financial statements", 1);
  const r = run([n], {
    1: [line("See Financial statements in the next chapter for details", 1)],
    80: [line(n.title, 80)],
  })[0];
  assert.equal(r.candidates[0].page, 80);
  assert.equal(r.status, "high");
});
test("ambiguous repeated titles require review; no nearest-page bias", () => {
  const n = makeNode("Introduction", 5),
    r = run([n], { 5: [line(n.title, 5)], 80: [line(n.title, 80)] })[0];
  assert.equal(r.status, "ambiguous");
  assert.equal(r.recommended, -1);
  assert(r.confidence < 70);
});
test("same-page headings and repeated nearby geometry do not imply one-to-one page assignment", () => {
  const a = makeNode("First heading", 1),
    b = makeNode("Second heading", 2);
  const r = run([a, b], {
    9: [
      line(a.title, 9),
      line(a.title, 9, { x: 40.3, y: 700.1 }),
      line(b.title, 9, { y: 500, top: 300, bottom: 316 }),
    ],
  });
  assert.deepEqual(
    r.map((r) => r.candidates[0].page),
    [9, 9],
  );
  assert.equal(r[0].candidates.length, 1);
});
test("TOC/index exclusions, leader rows and recurring page headers are not high-confidence matches", () => {
  const n = makeNode("Annual overview", 1);
  const r = run(
    [n],
    {
      1: [line(n.title, 1)],
      2: [line(n.title + " ...... 12", 2)],
      3: [line(n.title, 3, { top: 10, bottom: 20 })],
      4: [line(n.title, 4, { top: 10, bottom: 20 })],
      5: [line(n.title, 5, { top: 10, bottom: 20 })],
    },
    { excludedPages: [1] },
  )[0];
  assert(r.candidates.every((c) => c.page !== 1));
  assert.equal(r.recommended, -1);
  assert(r.candidates.some((c) => c.warnings.includes("repeated-header")));
});
test("short titles, fuzzy OCR and body-only matches remain reviewable without automatic selection", () => {
  for (const [title, text] of [
    ["税", "税"],
    ["Financial statement", "Financial statemant"],
    ["Revenue growth", "This report discusses Revenue growth at length"],
  ]) {
    const r = run([makeNode(title, 1)], { 20: [line(text, 20)] })[0];
    assert(r.candidates.length);
    assert.equal(r.recommended, -1);
  }
});
test("printed page labels are independent evidence, preserving Roman/front-matter distinction", () => {
  const n = makeNode("Overview section", 1);
  n.origin = { printedPageLabel: "（Ⅻ）" };
  const labels = [];
  labels[9] = "xii";
  labels[19] = "12";
  const r = run(
    [n],
    {
      10: [line(n.title, 10), line("xii", 10, { top: 770, bottom: 780 })],
      20: [line(n.title, 20), line("12", 20, { top: 770, bottom: 780 })],
    },
    { pageLabels: labels },
  )[0];
  assert.equal(r.candidates[0].page, 10);
  assert.equal(r.status, "high");
  assert(r.candidates[0].evidence.includes("printed-label"));
});
test("wrong PDF labels cannot override strong title evidence or filter candidates", () => {
  const n = makeNode("Standalone heading", 1);
  n.origin = { printedPageLabel: "12" };
  const labels = [];
  labels[19] = "99";
  const r = run([n], { 20: [line(n.title, 20)] }, { pageLabels: labels })[0];
  assert.equal(r.candidates[0].page, 20);
  assert(r.candidates[0].warnings.includes("label-differs"));
});
test("rotated coordinates and original zoom survive per-entry calibration", () => {
  const n = makeNode("Rotated heading", 1);
  n.target.args = [10, 20, 1.5];
  const r = run(
    [n],
    {
      20: [
        line(n.title, 20, {
          upX: 1,
          upY: 0,
          segments: [{ start: 0, end: 15, point: [300, 200] }],
        }),
      ],
    },
    { offset: 10 },
  )[0];
  assert.deepEqual(r.candidates[0].target.args, [310, 200, 1.5]);
});
test("cross-line alternatives retain originals and avoid different columns", () => {
  const a = line("Long chapter", 1),
    b = line("heading", 1, { top: 120, bottom: 136, y: 680 });
  const lines = calibrationLines([
    a,
    b,
    line("Another column", 1, { left: 350, top: 140, bottom: 156 }),
  ]);
  assert(lines.some((l) => l.text === "Long chapter heading"));
  assert(!lines.some((l) => l.text.includes("heading Another")));
  assert.equal(
    run([makeNode("Long chapter heading", 1)], { 1: lines })[0].candidates[0]
      .kind,
    "exact",
  );
});
test("apply changes only selected targets, preserves hierarchy/styles and supports one-step undo", () => {
  const a = makeNode("Parent chapter", 1),
    b = makeNode("Child heading", 2, a.id),
    c = makeNode("Missing heading", 3);
  b.bold = true;
  const nodes = [a, b, c],
    before = structuredClone(nodes),
    r = run(nodes, { 20: [line(a.title, 20)], 40: [line(b.title, 40)] });
  const h = new History();
  h.push(nodes);
  const out = applyPageCalibration(
    nodes,
    r,
    new Map([
      [a.id, 0],
      [b.id, { kind: "dest", page: 33, mode: "Fit", args: [] }],
    ]),
    100,
  );
  assert.equal(out.count, 2);
  assert.deepEqual(
    out.nodes.map((n) => n.target.page),
    [20, 33, 3],
  );
  assert.equal(out.nodes[1].parent, a.id);
  assert.equal(out.nodes[1].bold, true);
  assert.deepEqual(nodes, before);
  assert.deepEqual(h.undo(out.nodes), before);
});
test("stale and out-of-bounds manual targets are rejected; unmatched rows keep originals", () => {
  const n = makeNode("Some heading", 1),
    r = run([n], {});
  assert.equal(r[0].status, "unmatched");
  assert.deepEqual(applyPageCalibration([n], r, new Map(), 100).nodes, [n]);
  assert.throws(
    () =>
      applyPageCalibration(
        [{ ...n, title: "Changed" }],
        r,
        new Map([[n.id, { kind: "dest", page: 2, mode: "Fit", args: [] }]]),
        100,
      ),
    /stale/,
  );
  assert.throws(() =>
    applyPageCalibration(
      [n],
      r,
      new Map([[n.id, { kind: "dest", page: 101, mode: "Fit", args: [] }]]),
      100,
    ),
  );
});
test("label normalization covers brackets, Chinese, Roman and multilingual decimal digits", () => {
  for (const s of [
    "（１２８）",
    "一百二十八",
    "壹佰贰拾捌",
    "١٢٨",
    "۱۲۸",
    "१२८",
    "১২৮",
    "๑๒๘",
    "第一百二十八页",
  ])
    assert.equal(parsePageLabel(s)?.value, 128, s);
  assert.equal(parsePageLabel("Ⅻ")?.system, "roman");
  assert(samePageLabel("Ⅻ", "xii"));
  assert(!samePageLabel("xii", "12"));
  assert.equal(parsePageLabel("A-12")?.prefix, "A");
  assert(!samePageLabel("A-12", "12"));
  for (const s of [
    "",
    "IIX",
    "IC",
    "第三章",
    "二百百",
    "0",
    "(12]",
    "1 2",
    "2025年",
  ])
    assert.equal(parsePageLabel(s), null, s);
});
test("TOC import retains labels for calibration, including internal spacing and hierarchy", () => {
  const r = parseTOC(
    "Main  title ...... （１２）\n  子标题\t一百二十八\nPreface …… Ⅻ\nChapter heading\t١٢٨",
    200,
  );
  assert.equal(r.bad, 0);
  assert.deepEqual(
    r.nodes.map((n) => n.target.page),
    [12, 128, 12, 128],
  );
  assert.equal(r.nodes[0].title, "Main  title");
  assert.equal(r.nodes[1].parent, r.nodes[0].id);
  assert.deepEqual(
    r.nodes.map((n) => n.origin.printedPageLabel),
    ["（１２）", "一百二十八", "Ⅻ", "١٢٨"],
  );
});

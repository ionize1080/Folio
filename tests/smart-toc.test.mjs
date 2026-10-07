import test from "node:test";
import assert from "node:assert/strict";
import {
  splitTocText,
  recognizeTocPage,
  recognizeTocPages,
  resolveTocEntries,
  entriesToNodes,
} from "../src/smart-toc.mjs";
import { parsePageLabel } from "../src/page-labels.mjs";
const fragment = (text, x, y, w = 100, angle = 0) => {
  const r = (angle * Math.PI) / 180;
  return {
    text,
    angle,
    quad: [
      [0, 0],
      [w, 0],
      [w, 12],
      [0, 12],
    ].map(([u, v]) => [
      x + u * Math.cos(r) - v * Math.sin(r),
      y + u * Math.sin(r) + v * Math.cos(r),
    ]),
  };
};
test("leaders, adjacent digits, numeral systems, ranges, alphabets and invalid labels", () => {
  for (const [s, n] of [
    ["标题……１２", 12],
    ["标题★壹佰零贰", 102],
    ["标题十二", 12],
    ["Introduction —— iv", 4],
    ["عنوان .... ١٢", 12],
    ["Title17", 17],
    ["绪论Ⅻ", 12],
    ["Title  4–7", 4],
    ["附录　A-12", 12],
  ])
    assert.equal(splitTocText(s)?.label.value, n, s);
  for (const x of ["Introduction", "A normal sentence", "Title 0", "Title IIV"])
    assert.equal(splitTocText(x), null, x);
  assert.equal(parsePageLabel("aa", { alphabetic: true }).value, 27);
  assert.equal(parsePageLabel("c", { alphabetic: true }).value, 3);
  assert.equal(parsePageLabel("c").value, 100);
  assert.equal(splitTocText("序言 a", { alphabetic: true }).label.value, 1);
});
test("horizontal, diagonal and rotated titles pair across empty/vector leaders", () => {
  for (const angle of [0, 25, 90, -90, 180]) {
    const r = (angle * Math.PI) / 180;
    const f = [
      fragment("Chapter alpha", 200, 200, 100, angle),
      fragment(
        "12",
        200 + 180 * Math.cos(r),
        200 + 180 * Math.sin(r),
        15,
        angle,
      ),
    ];
    const result = recognizeTocPage({ page: 1, fragments: f });
    assert.equal(result.entries.length, 1, String(angle));
    assert.equal(result.entries[0].printedLabel, "12");
    assert.equal(result.entries[0].title, "Chapter alpha");
  }
});
test("two columns do not collapse title-number pairs", () => {
  const result = recognizeTocPage({
    page: 2,
    fragments: [
      fragment("Contents", 50, 20),
      fragment("Alpha title", 50, 100),
      fragment("3", 200, 100, 10),
      fragment("Beta title", 300, 100),
      fragment("5", 480, 100, 10),
      fragment("Gamma title", 50, 130),
      fragment("7", 200, 130, 10),
    ],
  });
  assert.deepEqual(
    result.entries.map((e) => e.title),
    ["Alpha title", "Beta title", "Gamma title"],
  );
  assert(result.selected);
});
test("wrapped titles and independent artistic number blocks stay reviewable", () => {
  const r = recognizeTocPage({
    page: 1,
    fragments: [
      fragment("A long chapter", 50, 50),
      fragment("continued here", 50, 68),
      fragment("10", 220, 68, 15),
      fragment("12", 350, 100, 15),
      fragment("An artistic title", 350, 120, 160),
    ],
  });
  assert(r.entries.some((e) => e.title === "A long chapter continued here"));
  assert(
    r.entries.some(
      (e) => e.title === "An artistic title" && e.confidence === 50,
    ),
  );
});
const line = (text, page, y = 100) => ({
  text,
  page,
  top: y,
  bottom: y + 14,
  height: 800,
  left: 50,
  right: 250,
  x: 50,
  y: 800 - y,
  upX: 0,
  upY: 1,
});
test("balanced title punctuation survives leaders and a trailing page label", () => {
  assert.equal(
    splitTocText("Creating an ID (default security) .... 163").title,
    "Creating an ID (default security)",
  );
  assert.equal(
    splitTocText("The “quoted title” ——— 12").title,
    "The “quoted title”",
  );
});
test("cross-page detection removes running folios and keeps continuation levels stable", () => {
  const pages = [1, 2, 3].map((page) => ({
    page,
    width: 600,
    height: 800,
    fragments: [
      fragment("Developer Guide", 35, 45, 130),
      fragment(String(page), 550, 45, 10),
      fragment("Heading " + page + " .... 10", 60, 130, 470),
      fragment("Child " + page + " .... 11", 90, 155, 440),
      fragment("Nested " + page + " .... 12", 110, 180, 420),
    ],
  }));
  const result = recognizeTocPages(pages);
  assert.deepEqual(
    result.map((p) => p.entries.length),
    [3, 3, 3],
  );
  assert.deepEqual(
    result.map((p) => p.entries.map((e) => e.level)),
    [
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ],
  );
  const auxiliary = recognizeTocPages([
    {
      page: 4,
      width: 600,
      height: 800,
      fragments: [
        fragment("List of Examples", 50, 100, 180),
        fragment("One example .... 10", 50, 160, 450),
        fragment("Another example .... 15", 50, 190, 450),
      ],
    },
  ])[0];
  assert(auxiliary.auxiliary);
  assert(!auxiliary.selected);
  assert.equal(auxiliary.entries.length, 2);
});
test("PDF links must be corroborated by a heading, and cannot override contrary body evidence", () => {
  const e = {
    ...splitTocText("1 Alpha chapter .... 2"),
    level: 1,
    linkedTarget: { kind: "dest", page: 3, mode: "Fit", args: [] },
  };
  const resolved = resolveTocEntries(
    [e],
    { 2: [line("Alpha chapter", 2)], 3: [line("Alpha chapter", 3)] },
    4,
  );
  assert.equal(resolved[0].target.page, 3);
  assert.equal(resolved[0].candidates[0].reason, "verified-link");
  const contradicted = resolveTocEntries(
    [e],
    { 2: [line("Alpha chapter", 2)], 3: [line("Unrelated heading", 3)] },
    4,
  );
  assert.equal(contradicted[0].target.page, 2);
  assert.equal(contradicted[0].candidates[0].page, 2);
  const missing = resolveTocEntries(
    [e],
    { 3: [line("Unrelated heading", 3)] },
    4,
  );
  assert(!missing[0].selected);
  assert.equal(missing[0].target, null);
});
test("wrong printed numbers are overridden by independent title evidence; no fixed offset", () => {
  const entries = ["Alpha heading", "Beta heading", "Gamma heading"].map(
    (title, i) => ({
      ...splitTocText(title + " .... " + (i + 1)),
      sourcePage: 1,
      level: 1,
    }),
  );
  const rows = resolveTocEntries(
    entries,
    {
      1: [line("Alpha heading", 1)],
      2: [line("Beta heading", 2)],
      6: [line("Alpha heading", 6)],
      4: [line("Gamma heading", 4)],
    },
    8,
    [],
    [1],
  );
  assert.deepEqual(
    rows.map((e) => e.target.page),
    [6, 2, 4],
  );
  assert.equal(entriesToNodes(rows, 8).length, 3);
});
test("repeated titles, page labels alone and unmatched rows cannot silently produce wrong targets", () => {
  const entries = [
    { ...splitTocText("Duplicate title ... 3"), level: 1 },
    { ...splitTocText("Missing title ... 2"), level: 1 },
  ];
  const rows = resolveTocEntries(
    entries,
    {
      2: [line("Duplicate title", 2)],
      3: [line("Duplicate title", 3)],
      4: [line("2", 4, 770)],
    },
    5,
    [],
    [],
  );
  assert(rows.every((e) => !e.selected && !e.target));
  assert(rows[1].candidates.some((c) => c.page === 4));
  assert.throws(() => entriesToNodes([{ ...rows[1], selected: true }], 5));
  rows[1].target = { kind: "dest", page: 4, mode: "Fit", args: [] };
  rows[1].selected = true;
  assert.equal(entriesToNodes(rows, 5)[0].target.page, 4);
  rows[1].target.page = 6;
  assert.throws(() => entriesToNodes(rows, 5));
});
test("manual hierarchy normalizes missing parent levels, retaining source labels", () => {
  const rows = [1, 3, 2, 1].map((level, i) => ({
    title: "Title " + i,
    level,
    selected: true,
    sourcePage: 2,
    printedLabel: "iv",
    target: { kind: "dest", page: 3, mode: "Fit", args: [] },
  }));
  const nodes = entriesToNodes(rows, 5);
  assert.equal(nodes[1].parent, nodes[0].id);
  assert.equal(nodes[2].parent, nodes[0].id);
  assert.equal(nodes[3].parent, null);
  assert.equal(nodes[0].origin.printedPageLabel, "iv");
});
test("page-first French and superscript art labels survive geometry", () => {
  assert.equal(splitTocText("18 God Save the Queen").printedLabel, "18");
  assert.equal(
    splitTocText("P. 12 _ Analyser les phénomènes").printedLabel,
    "12",
  );
  const p = {
    page: 3,
    width: 600,
    height: 800,
    fragments: [
      fragment("Contents", 200, 200, 200),
      fragment("An art title", 100, 100, 100),
      {
        text: "12",
        angle: 0,
        quad: [
          [205, 96],
          [215, 96],
          [215, 102],
          [205, 102],
        ],
      },
      fragment("Another work", 300, 400),
      fragment("8", 405, 400, 10),
    ],
  };
  const r = recognizeTocPage(p);
  assert(r.selected);
  assert.deepEqual(
    r.entries.map((e) => e.printedLabel),
    ["12", "8"],
  );
});
test("financial tables are not selected as contents without heading evidence", () => {
  const fragments = [];
  for (let i = 0; i < 15; i++) {
    fragments.push(fragment("Revenue category", 30, 50 + i * 20));
    for (let j = 0; j < 5; j++)
      fragments.push(
        fragment(String(120 + j * 100 + i), 220 + j * 40, 50 + i * 20, 25),
      );
  }
  assert.equal(recognizeTocPage({ page: 3, fragments }).selected, false);
});
test("upright vertical CJK glyphs can be regrouped automatically", () => {
  const fragments = [fragment("目录", 10, 20, 30)];
  for (const [x, word] of [
    [200, "第一章绪论12"],
    [300, "第二章研究20"],
  ])
    for (const [i, c] of [...word].entries())
      fragments.push(fragment(c, x, 70 + i * 18, 12));
  const result = recognizeTocPage({ page: 2, fragments });
  assert.equal(result.entries.length, 2);
  assert(result.entries.every((e) => e.angle === 90));
});

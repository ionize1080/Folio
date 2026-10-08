import test from "node:test";
import assert from "node:assert/strict";
import { calibratePages } from "../src/page-calibration.mjs";
import { makeNode } from "../src/model.mjs";
import {
  recognizeTocPages,
  recognizeTocPage,
  entriesToNodes,
  splitTocText,
  resolveTocEntries,
} from "../src/smart-toc.mjs";
const f = (text, x, y, w = 100, h = 12) => ({
  text,
  angle: 0,
  quad: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ],
});
const page = (n, fragments) => ({
  page: n,
  width: 600,
  height: 800,
  fragments,
});
test("numbered table cells and organization credits are never auto-selected as headings", () => {
  const line = (text, i) => ({
    text,
    page: 2,
    left: 40,
    right: 240,
    top: 100 + i * 20,
    bottom: 112 + i * 20,
    height: 800,
    x: 40,
    y: 700 - i * 20,
  });
  for (const rows of [
    ["序号", "Example transport company", "1", "2", "3", "4", "5"],
    ["（Example transport company）"],
  ]) {
    const [r] = calibratePages({
      nodes: [makeNode("Example transport company", 1)],
      pages: { 2: rows.map(line) },
      pageCount: 10,
    });
    assert.notEqual(r.status, "high");
  }
});
test("two columns read down the left before the right and use local indentation", () => {
  const rows = [f("Contents", 30, 30)];
  for (let i = 0; i < 4; i++) {
    rows.push(
      f(`${i + 1}. Left chapter ..... ${i + 4}`, 30, 100 + i * 25, 220),
    );
    rows.push(
      f(`${i + 5}. Right chapter ..... ${i + 8}`, 330, 100 + i * 25, 220),
    );
  }
  const r = recognizeTocPages([page(1, rows)])[0];
  assert.deepEqual(
    r.entries.map((e) => +e.printedLabel),
    [4, 5, 6, 7, 8, 9, 10, 11],
  );
  assert(r.entries.every((e) => e.level === 1));
});
test("yearbook font families distinguish unindented sections and children", () => {
  const r = recognizeTocPages([
    page(1, [
      f("目录", 30, 30),
      f("铁路篇", 100, 60),
      { ...f("年度发展综述 ...... 2", 30, 100, 250), font: "major" },
      { ...f("基本情况 ...... 2", 30, 130, 250), font: "body" },
      { ...f("行业统计公报 ...... 5", 30, 160, 250), font: "major" },
      { ...f("运输服务 ...... 6", 30, 190, 250), font: "body" },
    ]),
  ])[0];
  assert.deepEqual(
    r.entries.map((e) => e.level),
    [1, 2, 3, 2, 3],
  );
});
test("a sparse bilingual final contents page continues only with reliable leader rows", () => {
  const start = page(1, [
    f("Contents", 30, 20),
    ...[1, 2, 3, 4].map((i) =>
      f(`Chapter ${i} .... ${i + 4}`, 30, 40 + i * 30, 250),
    ),
  ]);
  const tail = page(2, [
    f("Appendix", 30, 20),
    f("Translation", 30, 35),
    f("Other heading", 30, 50),
    ...[1, 2, 3].flatMap((i) => [
      f(`Annex ${i} ...... ${i + 20}`, 30, 80 + i * 40, 250),
      f(
        `Unnumbered translation ${String.fromCharCode(64 + i)}`,
        30,
        96 + i * 40,
        250,
      ),
    ]),
  ]);
  assert(recognizeTocPages([start, tail])[1].selected);
  assert(!recognizeTocPages([tail])[0].selected);
});
test("superscript lesson star cannot steal the title folio", () => {
  const r = recognizeTocPage(
    page(1, [
      f("Contents", 40, 40),
      f("花之歌", 80, 100, 60),
      f("................", 140, 96, 100),
      f("*", 64, 99, 5, 7.5),
      f("4", 56, 100, 6),
      f("10", 240, 100, 12),
    ]),
  );
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].printedLabel, "10");
  assert.match(r.entries[0].title, /花之歌/);
});
test("one-character lessons, year suffixes and contents headers", () => {
  assert.equal(splitTocText("13 桥 ...... 54").printedLabel, "54");
  assert.equal(splitTocText("Energy Balance (2023)"), null);
  assert.equal(splitTocText("Energy Balance -2023"), null);
  const r = recognizeTocPage(
    page(2, [
      f("内容", 40, 50),
      f("1. Overview ..... 14", 40, 70, 300),
      f("2. More ..... 18", 40, 95, 300),
    ]),
  );
  assert.equal(r.entries[0].title, "1. Overview");
});
test("explicit chapter numbering wins over continuation indentation", () => {
  const r = recognizeTocPages([
    page(1, [
      f("Contents", 30, 30),
      f("1. Chapter ..... 3", 30, 100, 300),
      f("1.1. Part ..... 4", 50, 125, 300),
    ]),
    page(2, [
      f("2. Chapter ..... 5", 50, 100, 300),
      f("2.1. Part ..... 6", 70, 125, 300),
    ]),
  ]);
  assert.equal(r[1].entries[0].level, 1);
  assert.equal(r[1].entries[1].level, 2);
});
test("unchecked parents do not move children under an unrelated previous chapter", () => {
  const e = (title, level, selected = true) => ({
    title,
    level,
    selected,
    target: { kind: "dest", page: 1, mode: "Fit", args: [] },
  });
  const r = entriesToNodes(
    [e("A", 1), e("B", 1, false), e("B child", 2), e("B grandchild", 3)],
    4,
  );
  assert.equal(r[1].parent, null);
  assert.equal(r[2].parent, r[1].id);
});
test("missing scanned folios stay unresolved and bilingual rows do not contaminate the next title", () => {
  const r = recognizeTocPage(
    page(1, [
      f("Contents", 30, 30),
      f("1-1 统计表……", 30, 100, 180),
      f("English translation", 30, 116, 170),
      f("1-2 下一个表…… 8", 30, 140, 280),
      f("1-3 再下一个表…… 9", 30, 165, 280),
    ]),
  );
  assert(r.entries.some((e) => e.title === "1-1 统计表" && !e.printedLabel));
  assert(r.entries.every((e) => !e.title.includes("English")));
});
test("textbook author annotations can locate an independent body heading", () => {
  const e = {
    title: "1 沁园春·长沙 / 毛泽东",
    printedLabel: "2",
    level: 2,
    confidence: 90,
  };
  const r = resolveTocEntries(
    [e],
    {
      9: [
        {
          text: "沁园春·长沙",
          page: 9,
          left: 40,
          right: 200,
          top: 200,
          bottom: 224,
          height: 800,
          x: 40,
          y: 600,
        },
      ],
    },
    20,
  );
  assert.equal(r[0].target.page, 9);
  assert(r[0].selected);
});

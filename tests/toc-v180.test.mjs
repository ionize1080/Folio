import test from "node:test";
import assert from "node:assert/strict";
import { recognizeTocPages, splitTocText } from "../src/smart-toc.mjs";
const f = (text, x, y, w = 240) => ({
  text,
  angle: 0,
  quad: [
    [x, y],
    [x + w, y],
    [x + w, y + 12],
    [x, y + 12],
  ],
});
const p = (page, fragments) => ({ page, width: 600, height: 800, fragments });
test("spaced leaders and Spanish banner identify every continuation, including one-row tail", () => {
  const pages = [
    p(1, [
      f("Índice general", 30, 40),
      f("1 Intro . . . . 5", 30, 80),
      f("1.1 Start . . . . 6", 45, 110),
    ]),
    p(2, [
      f("A.1 Appendix . . . . 25", 45, 80),
      f("A.1.1 Detail . . . . 26", 60, 110),
    ]),
    p(3, [f("Index . . . . 40", 30, 80)]),
  ];
  const r = recognizeTocPages(pages);
  assert.deepEqual(
    r.map((x) => x.selected),
    [true, true, true],
  );
  assert.deepEqual(
    r[1].entries.map((e) => e.level),
    [2, 3],
  );
  assert.equal(splitTocText("A.1 Start . . . . 4").confidence, 90);
});
test("body sentence ending contents is not a contents banner", () => {
  const r = recognizeTocPages([
    p(1, [
      f("contents.", 30, 90),
      ...Array.from({ length: 20 }, (_, i) =>
        f("This is an ordinary sentence.", 30, 120 + i * 20),
      ),
      f("Header 12", 30, 40),
      f("See chapter 5", 30, 600),
    ]),
  ])[0];
  assert.equal(r.selected, false);
  assert.equal(r.hasHeading, false);
});

test("off-centre columns below spanning prose preserve reading order and keep same-page indexes out", () => {
  const fragments = [
    f("An introductory paragraph spans the whole page.", 70, 60, 480),
    f("Contents", 70, 100, 100),
  ];
  for (let i = 0; i < 5; i++)
    fragments.push(
      f(`${i + 1} Left title . . . .`, 70, 140 + i * 30, 220),
      f(String(i + 10), 305, 140 + i * 30, 10),
      f(`${i + 6} Right title . . . .`, 330, 140 + i * 30, 180),
      f(String(i + 20), 540, 140 + i * 30, 12),
    );
  fragments.push(
    f("List of examples", 70, 340),
    f("Example one . . . . 40", 70, 370),
    f("Example two . . . . 41", 70, 400),
  );
  const r = recognizeTocPages([p(1, fragments)])[0];
  assert(r.selected);
  assert.equal(r.columns, 2);
  assert.equal(r.entries.length, 10);
  assert.deepEqual(
    r.entries.map((e) => e.title.match(/^\d+/)[0]),
    Array.from({ length: 10 }, (_, i) => String(i + 1)),
  );
});

test("Roman part headings add a parent above numbered chapters and sections", () => {
  const r = recognizeTocPages([
    p(1, [
      f("Contents", 30, 40),
      f("I First part . . . . 2", 30, 80),
      f("1 Chapter . . . . 2", 45, 110),
      f("1.1 Detail . . . . 3", 60, 140),
      f("2 Chapter . . . . 4", 45, 170),
      f("II Second part . . . . 5", 30, 200),
      f("3 Chapter . . . . 5", 45, 230),
    ]),
  ])[0];
  assert.deepEqual(
    r.entries.map((e) => e.level),
    [1, 2, 3, 2, 1, 2],
  );
});

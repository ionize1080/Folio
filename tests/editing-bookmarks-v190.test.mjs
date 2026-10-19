import test from "node:test";
import assert from "node:assert/strict";
import { makeNode, applyBatch } from "../src/model.mjs";
import { fastLayout } from "../src/fast-layout.mjs";
import { visualCaretMove } from "../src/text-navigation.mjs";
import { connectedParagraphs } from "../src/flow-regions.mjs";

test("bookmark zoom retains positions, skips external actions and requires explicit conversion", () => {
  const a = makeNode("第一章", 2),
    b = makeNode("Web", 1),
    c = makeNode("Width", 3);
  a.target = { kind: "preserve", page: 2, mode: "XYZ", args: [15, 720, 2] };
  b.target = { kind: "preserve", external: true, page: 4, raw: "URI" };
  c.target = { kind: "dest", page: 3, mode: "FitH", args: [640] };
  const nodes = [a, b, c],
    ids = new Set(nodes.map((n) => n.id));
  assert.throws(() =>
    applyBatch(nodes, ids, { op: "zoom", zoomMode: "inherit" }, 10),
  );
  const out = applyBatch(
    nodes,
    ids,
    { op: "zoom", zoomMode: "fixed", zoomPercent: 125, convert: true },
    10,
  );
  assert.deepEqual(out[0].target, {
    kind: "dest",
    page: 2,
    mode: "XYZ",
    args: [15, 720, 1.25],
  });
  assert.deepEqual(out[1], b);
  assert.deepEqual(out[2].target.args, [null, 640, 1.25]);
  assert.equal(a.target.kind, "preserve");
  for (const zoomPercent of ["", 0, Infinity, NaN, 6401])
    assert.throws(() =>
      applyBatch(
        [c],
        new Set([c.id]),
        { op: "zoom", zoomMode: "fixed", zoomPercent },
        10,
      ),
    );
  assert.deepEqual(
    applyBatch(
      [a],
      new Set([a.id]),
      { op: "zoom", zoomMode: "FitH", convert: true },
      10,
    )[0].target.args,
    [720],
  );
  assert.deepEqual(
    applyBatch(
      [a],
      new Set([a.id]),
      { op: "zoom", zoomMode: "inherit", convert: true },
      10,
    )[0].target.args,
    [15, 720, null],
  );
});

test("Unicode title case transforms preserve destinations, Chinese, punctuation and scope", () => {
  const a = makeNode("中文 ÉCOLE chapter 2"),
    b = makeNode("untouched");
  const r = applyBatch(
    [a, b],
    new Set([a.id]),
    { op: "case", caseMode: "title" },
    2,
  );
  assert.equal(r[0].title, "中文 École Chapter 2");
  assert.deepEqual(r[0].target, a.target);
  assert.deepEqual(r[1], b);
  assert.equal(
    applyBatch([a], new Set([a.id]), { op: "case", caseMode: "upper" }, 2)[0]
      .title,
    "中文 ÉCOLE CHAPTER 2",
  );
});

const model = (text) => ({
  text,
  frame: { x: 10, y: 10, width: 200, height: 300 },
  size: 10,
  lineHeight: 1.5,
  align: "left",
  sources: [],
});
const layout = (m) =>
  fastLayout(m, () => ({ width: 10, fontKey: "a".repeat(32) }));
test("visual navigation traverses blank lines and preserves X through a short line", () => {
  const m = model("abcdefghij\nx\nabcdefghij\n\nend");
  const p = layout(m);
  let state = { start: 8, end: 8, direction: "forward", preferredX: null };
  const move = (key) =>
    (state = visualCaretMove({ ...p, model: m, ...state, key }));
  move("ArrowDown");
  assert.equal(state.start, 12);
  move("ArrowDown");
  assert.equal(state.start, 21);
  move("ArrowDown");
  assert.equal(state.start, 24);
  move("ArrowDown");
  assert.equal(state.start, 28);
  move("ArrowUp");
  assert.equal(state.start, 24);
  move("Home");
  assert.equal(state.start, 24);
  move("End");
  assert.equal(state.start, 24);
});
test("visual Home and End stop before hard breaks; Shift retains the anchor", () => {
  const m = model("abc\ndef"),
    p = layout(m);
  const r = visualCaretMove({
    ...p,
    model: m,
    start: 1,
    end: 1,
    key: "End",
    shift: true,
  });
  assert.deepEqual([r.start, r.end], [1, 3]);
  const up = visualCaretMove({
    ...p,
    model: m,
    start: 5,
    end: 5,
    key: "ArrowUp",
    shift: true,
  });
  assert.equal(up.end, 5);
  assert.equal(up.direction, "backward");
});
test("native empty paragraph anchors with line -1 remain separate", () => {
  const m = model("abc\n\n\ndef"),
    p = layout(m);
  const anchors = {
    4: { x: 10, y: 25, h: 15, line: -1 },
    5: { x: 10, y: 40, h: 15, line: -1 },
  };
  const glyphs = p.glyphs.filter((g) => g.text !== "\n");
  const r = visualCaretMove({
    glyphs,
    anchors,
    model: m,
    start: 4,
    end: 4,
    key: "ArrowDown",
  });
  assert.equal(r.start, 5);
});

const row = (index, text, x, y, width) => ({
  index,
  type: "text",
  text,
  size: 12,
  flowEditable: true,
  fontName: "宋体",
  matrix: [1, 0, 0, 1, x, 800 - y],
  bounds: [x, 800 - y - 3, x + width, 800 - y + 10],
});
test("a new two-em first-line indent starts a new Chinese paragraph", () => {
  const r = connectedParagraphs(
    [
      row(0, "这是前段的首行文字内容", 64, 100, 416),
      row(1, "这是前段延续到行末的文字。", 40, 118, 440),
      row(2, "这是另起一段的首行文字", 64, 136, 416),
      row(3, "这是第二段的后续文字。", 40, 154, 430),
    ],
    800,
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].text.split("\n").length, 2);
  assert.equal(r[1].text.split("\n").length, 2);
});

test("HTML outline preserves hierarchy and style, escapes untrusted text, and only links local pages", async () => {
  const { bookmarkHTML } = await import("../src/bookmark-html.mjs");
  const a = makeNode("<script>alert(1)</script>", 1),
    b = makeNode("子项 & École", 2, a.id),
    c = makeNode("External", 1);
  b.bold = true;
  b.italic = true;
  c.target = {
    kind: "preserve",
    external: true,
    page: 1,
    raw: "javascript:alert(1)",
  };
  const html = bookmarkHTML([a, b, c], "C:\\docs\\中文 & file.pdf");
  assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert(!html.includes("<script>"));
  assert(!html.includes("javascript:"));
  assert.equal((html.match(/<ol>/g) || []).length, 2);
  assert.equal((html.match(/<\/ol>/g) || []).length, 2);
  assert.equal((html.match(/href=/g) || []).length, 2);
  assert(html.includes("#page=2"));
  assert(html.includes("font-weight:700;font-style:italic"));
  assert(!html.includes("C:"));
  assert(bookmarkHTML([], "empty.pdf").endsWith("</html>"));
});

test("Positioned spaces survive link/punctuation boundaries without splitting CJK or tight words", () => {
  const text = (objects) => connectedParagraphs(objects, 800)[0].text;
  assert.equal(
    text([row(0, "(SAEs)", 40, 100, 40), row(1, "explain", 84, 100, 42)]),
    "(SAEs) explain",
  );
  assert.equal(
    text([row(0, "study,", 40, 100, 40), row(1, "École", 84, 100, 42)]),
    "study, École",
  );
  assert.equal(
    text([row(0, "inter", 40, 100, 40), row(1, "net", 81, 100, 20)]),
    "internet",
  );
  assert.equal(
    text([row(0, "中文", 40, 100, 40), row(1, "测试", 84, 100, 42)]),
    "中文测试",
  );
});

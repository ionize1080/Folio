import test from "node:test";
import assert from "node:assert/strict";
import { pageCandidates } from "../src/flow-page-model.mjs";
import { sourceStyles } from "../src/flow-style.mjs";

const object = (index, text, x, y, width, fontName = "LMRoman10-Regular") => ({
  index, type: "text", text, size: 10, flowEditable: true, editable: true,
  signature: String(index), fontKey: "test", fontName,
  matrix: [1, 0, 0, 1, x, 800 - y],
  bounds: [x, 800 - y - 2, x + width, 800 - y + 8],
});

test("LaTeX small-cap section headings do not become the first line of the body", () => {
  const models = pageCandidates([
    object(0, "3.2 Coefficient Refitting", 108, 190, 180, "LMRomanCaps10-Regular-Identity-H"),
    object(1, "While the penalty promotes sparsity, it also introduces", 108, 208, 396),
    object(2, "shrinkage bias in correctly identified active atoms.", 108, 220, 370),
  ], 612, 800).map(c => c.model);
  assert.equal(models.length, 2);
  assert.equal(models[0].text, "3.2 Coefficient Refitting");
  assert.equal(models[1].sources.length, 2);
});

test("small-cap tokens inside a full prose line do not make a heading", () => {
  const models = pageCandidates([
    object(0, "The ", 108, 190, 20),
    object(1, "FISTA", 129, 190, 28, "LMRomanCaps10-Regular"),
    object(2, " procedure is repeated until convergence", 158, 190, 346),
    object(3, "with a stable step size and unchanged stopping criterion.", 108, 202, 396),
  ], 612, 800).map(c => c.model);
  assert.equal(models.length, 1);
  assert.equal(models[0].sources.length, 4);
});

test("a wrapped small-cap section title remains one unit above body text", () => {
  const models = pageCandidates([
    object(0, "3.4 Training Objective and Alternating", 108, 180, 270, "LMRomanCaps10-Regular"),
    object(1, "Optimization with Shared Representations", 108, 192, 270, "LMRomanCaps10-Regular"),
    object(2, "The coefficients are estimated from the reconstruction loss.", 108, 210, 396),
  ], 612, 800).map(c => c.model);
  assert.equal(models.length, 2);
  assert.equal(models[0].sources.length, 2);
  assert.equal(models[1].sources.length, 1);
});

test("a small-cap title above simultaneous columns keeps both column boundaries", () => {
  const objects = [object(0, "2.4 Results and Discussion", 108, 140, 250, "LMRomanCaps10-Regular")];
  for (let y = 180; y <= 234; y += 18) {
    objects.push(object(objects.length, `left column row ${y}`, 50, y, 235));
    objects.push(object(objects.length, `right column row ${y}`, 310, y, 235));
  }
  const models = pageCandidates(objects, 600, 800).map(c => c.model);
  assert.equal(models.length, 3);
  for (const model of models)
    assert(!(model.text.includes("left column") && model.text.includes("right column")));
});

test("inline formula fragments cannot hide the main lane of a narrow Chinese column", () => {
  const objects = [];
  for (let row = 0; row < 12; row++) {
    const y = 130 + row * 16;
    const fragment = [2, 5, 8].includes(row) ? 160 : [3, 6, 9].includes(row) ? 195 : null;
    if (fragment) {
      objects.push(object(objects.length, `左栏前半${row}`, 50, y, fragment - 62));
      objects.push(object(objects.length, `左栏后半${row}`, fragment, y, 288 - fragment));
    } else objects.push(object(objects.length, `左栏完整正文${row}`, 50, y, 238));
    objects.push(object(objects.length, `右栏完整正文${row}`, 308, y + (row === 9 ? 5 : 0), 234));
  }
  for (const o of objects) o.size = 10.5;
  const models = pageCandidates(objects, 595.2, 842).map(c => c.model);
  for (const model of models)
    assert(!(model.text.includes("左栏") && model.text.includes("右栏")), model.text);
  assert(models.some(m => m.text.includes("左栏完整正文0") && m.text.includes("左栏完整正文11")));
});

test("saved logical soft wraps restore UTF-16 offsets independently of rendered rows", () => {
  const text = "😀alpha\nbeta\nhard paragraph";
  const source = [
    object(0, "😀alpha", 50, 100, 70),
    object(1, "beta", 50, 116, 40),
    object(2, "hard paragraph", 50, 150, 140),
  ].map(o => ({ ...o, flowGroup: 77, flowText: text, flowSoftBreaks: [7] }));
  const [candidate] = pageCandidates(source, 600, 800);
  assert.equal(candidate.model.text, text);
  assert.deepEqual(candidate.model.softBreaks, [7]);
  assert.equal(candidate.model.text[candidate.model.softBreaks[0]], "\n");
  for (const metadata of [undefined, [1], [8], [7, 7], [false], [NaN]]) {
    const [legacy] = pageCandidates(source.map(o => ({ ...o, flowSoftBreaks: metadata })), 600, 800);
    assert.deepEqual(legacy.model.softBreaks, [], String(metadata));
  }
});

const glyphs = (text, y = 100) => {
  let x = 50;
  return [...text].map(text => {
    const g = { text, x, y: y - 8, w: 8, h: 10, originX: x, baseline: y };
    x += 8;
    return g;
  });
};
test("saved soft-wrap whitespace retains font runs and supplementary glyph offsets", () => {
  const text = "😀first\nsecond\nhard";
  const source = [
    { ...object(0, "😀first second", 50, 100, 112), glyphs: glyphs("😀first second") },
    { ...object(1, "hard", 50, 120, 32), glyphs: glyphs("hard", 120) },
  ].map(o => ({ ...o, flowGroup: 4, flowText: text, flowSoftBreaks: [7] }));
  const model = pageCandidates(source, 600, 800)[0].model;
  assert.equal(model.styleMappingWarning, undefined);
  assert.equal(model.fontResolution, "embedded");
  assert.equal(model.originalLayout.glyphs.map(g => g.text).join(""), text);
  assert.deepEqual(model.originalLayout.glyphs.slice(0, 1).map(g => [g.start, g.end]), [[0, 2]]);
  assert.equal(model.originalLayout.glyphs.find(g => g.start === 7).text, "\n");
  assert.equal(model.runs[0].end, 14);
});

test("saved Chinese soft wraps may disappear physically without losing style geometry", () => {
  const text = "中文\n内容";
  const source = [{ ...object(0, "中文内容", 50, 100, 32), glyphs: glyphs("中文内容"), flowGroup: 4, flowText: text, flowSoftBreaks: [2] }];
  const model = pageCandidates(source, 600, 800)[0].model;
  assert.equal(model.styleMappingWarning, undefined);
  assert.equal(model.originalLayout.glyphs.map(g => g.text).join(""), text);
  assert.equal(model.originalLayout.glyphs.find(g => g.start === 3).text, "内");
  assert.deepEqual(model.runs.map(r => [r.start, r.end]), [[0, 5]]);
});

test("saved paragraph metadata never permits non-whitespace style mismatches", () => {
  const model = { text: "alpha\nbeta", sources: [{ index: 0 }], frame: { x: 50, y: 90, width: 160, height: 60 } };
  const source = [{ ...object(0, "alpha zeta", 50, 100, 80), flowGroup: 4, flowText: model.text }];
  sourceStyles(model, source);
  assert.equal(model.fontResolution, "unresolved");
  assert.match(model.styleMappingWarning, /文字不一致/);
});

test("saved table cells restore logical soft and hard breaks after physical reflow", () => {
  const text = "first\nsecond\nhard";
  const source = [
    { ...object(0, "first second", 50, 100, 96), glyphs: glyphs("first second") },
    { ...object(1, "hard", 50, 120, 32), glyphs: glyphs("hard", 120) },
  ].map(o => ({ ...o, flowGroup: 4, flowText: text, flowSoftBreaks: [5] }));
  const table = [{ id: "table", cells: [{ id: "cell", row: 0, column: 0, bounds: [45, 85, 180, 150] }] }];
  const [candidate] = pageCandidates(source, 600, 800, [], table);
  assert.equal(candidate.model.cell.id, "cell");
  assert.equal(candidate.model.text, text);
  assert.deepEqual(candidate.model.softBreaks, [5]);
  assert.equal(candidate.model.styleMappingWarning, undefined);
  assert.equal(candidate.model.originalLayout.glyphs.map(g => g.text).join(""), text);
  const [legacy] = pageCandidates(source.map(o => ({ ...o, flowSoftBreaks: undefined })), 600, 800, [], table);
  assert.deepEqual(legacy.model.softBreaks, []);
  const [untrusted] = pageCandidates(source.map((o, i) => ({ ...o, flowGroup: i })), 600, 800, [], table);
  assert.notEqual(untrusted.model.text, text);
});

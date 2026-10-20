import test from "node:test";
import assert from "node:assert/strict";
import { flowConflicts } from "../src/flow-page-model.mjs";
const glyph = { x: 30, y: 30, w: 10, h: 12, baseline: 42, start: 0, end: 1 };
const model = {
  pageHeight: 200,
  frame: { x: 30, y: 30, width: 80, height: 30 },
  sources: [{ index: 3 }],
  originalLayout: { glyphs: [glyph] },
};
const image = (index = 0, bounds = [0, 0, 200, 200], type = "image") => ({
  index,
  bounds,
  type,
});
test("existing text over a fully containing background image is editable", () => {
  assert.deepEqual(
    flowConflicts(model, [image()], [], 1, null, [{ ...glyph, x: 40 }]),
    [],
  );
  assert.deepEqual(
    flowConflicts(
      model,
      [
        {
          ...image(0, undefined, "form"),
          nestedContent: { text: 0, truncated: false },
        },
      ],
      [],
      1,
      null,
      [{ ...glyph, x: 100 }],
    ),
    [],
  );
});
test("a proven text-free watermark retains existing overlap and paint order", () => {
  const form = {
    ...image(4, undefined, "form"),
    nestedContent: { text: 0, truncated: false },
  };
  assert.deepEqual(flowConflicts(model, [form], [], 1, null, [glyph]), []);
  for (const index of [2, 3]) {
    const sources = [{ index: 1 }, { index: 5 }];
    assert.equal(
      flowConflicts({ ...model, sources }, [{ ...form, index }], [], 1, null, [
        glyph,
      ])[0].kind,
      "image",
    );
  }
  assert.equal(
    flowConflicts(model, [form], [], 1, null, [{ ...glyph, x: 100 }])[0].kind,
    "image",
  );
  assert.equal(
    flowConflicts(
      model,
      [{ ...form, nestedContent: { text: 1, truncated: false } }],
      [],
      1,
      null,
      [glyph],
    )[0].kind,
    "image",
  );
});
test("foreground images, new image entry and Forms remain visible conflicts", () => {
  assert.equal(
    flowConflicts(model, [image(4)], [], 1, null, [glyph])[0].kind,
    "image",
  );
  assert.equal(
    flowConflicts(
      { ...model, originalLayout: { glyphs: [{ ...glyph, x: 210 }] } },
      [image()],
      [],
      1,
      null,
      [glyph],
    )[0].kind,
    "image",
  );
  assert.equal(
    flowConflicts(model, [image(0, undefined, "form")], [], 1, null, [glyph])[0]
      .kind,
    "image",
  );
  for (const nestedContent of [
    { text: 1, truncated: false },
    { text: 0, truncated: true },
  ])
    assert.equal(
      flowConflicts(
        model,
        [{ ...image(0, undefined, "form"), nestedContent }],
        [],
        1,
        null,
        [glyph],
      )[0].kind,
      "image",
    );
  assert.equal(
    flowConflicts(
      model,
      [
        {
          ...image(4, undefined, "form"),
          nestedContent: { text: 0, truncated: false },
        },
      ],
      [],
      1,
      null,
      [{ ...glyph, x: 100 }],
    )[0].kind,
    "image",
  );
});

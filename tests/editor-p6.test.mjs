import test from "node:test";
import assert from "node:assert/strict";
import { editWarnings } from "../src/edit-warnings.mjs";
import { pagePreview, disposePreview } from "../src/page-preview.mjs";
import { pageCandidates } from "../src/flow-page-model.mjs";
import { fastLayout, FastFonts, canFast } from "../src/fast-layout.mjs";

test("geometry notices distinguish page clipping, frame overset and ownership failures", () => {
  const model = { pageWidth: 100, pageHeight: 100 };
  const layout = {
    mappingComplete: true,
    frameOverset: true,
    overflow: false,
    glyphs: [{ x: 98, y: 30, w: 8, h: 10 }],
  };
  const warning = editWarnings(model, layout, [
    { kind: "text", bounds: [99, 30, 101, 40] },
  ]);
  assert(
    warning.pageClipped &&
      warning.frameOverset &&
      warning.overlap === 1 &&
      !warning.integrity,
  );
  assert.match(warning.messages.join(" "), /导出.*裁切/);
  assert.equal(layout.overflow, false);
  assert(
    editWarnings(model, layout, [{ kind: "source", bounds: [0, 0, 1, 1] }])
      .integrity,
  );
});

test("page preview shares unchanged pages, caches export per revision, and rolls back ownership", async () => {
  const calls = [];
  const doc = (name) => ({
    numPages: 2000,
    getPage: async (n) => ({
      pageNumber: n,
      name,
      getAnnotations: async () => [name, n],
    }),
    getData: async () => new Uint8Array([0]),
    destroy: async () => calls.push("destroy " + name),
  });
  const root = doc("root");
  let renders = 0,
    materialized = 0;
  const p1 = pagePreview(
    root,
    new Map([[800, "a"]]),
    async () => {
      renders++;
      return doc("edited");
    },
    async () => {
      materialized++;
      return new Uint8Array([1, 2]);
    },
  );
  assert.equal((await p1.getPage(20)).name, "root");
  assert.equal(renders, 0);
  const p = await p1.getPage(800);
  assert.equal(p.pageNumber, 800);
  assert.deepEqual(await p.getAnnotations(), ["root", 800]);
  assert.equal(materialized, 0);
  const p2 = pagePreview(
    p1,
    new Map([[800, "a"]]),
    () => assert.fail("unchanged preview regenerated"),
    async () => new Uint8Array([3]),
  );
  await disposePreview(root);
  await p1.destroy();
  assert.deepEqual(calls, []);
  assert.equal((await p2.getPage(800)).name, "edited");
  assert.equal(renders, 1);
  const failed = pagePreview(
    p2,
    new Map([[800, "b"]]),
    async () => {
      throw Error("preview failed");
    },
    async () => new Uint8Array([4]),
  );
  await assert.rejects(failed.getPage(800), /preview failed/);
  await failed.destroy();
  assert.equal((await p2.getPage(800)).name, "edited");
  let b = await p2.getData();
  b[0] = 99;
  assert.deepEqual([...(await p2.getData())], [3]);
  await p2.destroy();
  assert.deepEqual(calls.sort(), ["destroy edited", "destroy root"]);
  assert.equal(materialized, 0);
});

const object = (index, text, x, base, width, fontName = "FreeMono") => ({
  index,
  type: "text",
  text,
  size: 10,
  flowEditable: true,
  editable: true,
  fontKey: "font",
  fontName,
  signature: String(index),
  matrix: [1, 0, 0, 1, x, base],
  bounds: [x, base - 2, x + width, base + 8],
});
test("one source object crossing cell borders remains an original row", () => {
  const src = object(0, "Left label Right value", 20, 100, 220);
  const grid = [{id:"table", cells:[
    {id:"left",bounds:[10,690,100,712],row:0,column:0},
    {id:"right",bounds:[100,690,260,712],row:0,column:1},
  ]}];
  const cs = pageCandidates([src],600,800,[],grid);
  const row = cs.find(c=>c.model.text.includes("Left label"));
  assert(row && !row.model.cell && row.model.structureWarning);
  assert(row.model.frame.x <= 20);
  assert.equal(row.model.sources.length,1);
});
test("floating baseline noise cannot detach command arguments or merge prose into code", () => {
  const cs = pageCandidates(
    [
      object(0, "cmake ", 20, 100, 30),
      object(1, ".. -G Ninja", 51, 100.00006, 60),
      object(2, "ninja", 20, 86, 30),
      object(3, "Explanation of the command:", 20, 70, 150, "Serif"),
    ],
    600,
    800,
  );
  const command = cs.find((c) => c.model.text.startsWith("cmake")).model;
  assert.equal(command.text, "cmake .. -G Ninja\nninja");
  assert(!command.softBreaks?.length);
  assert.equal(cs.length, 2);
});
test("uncertain multi-column table cell stays in original rows; genuinely tiny cells remain editable", () => {
  const objects = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++)
      objects.push(
        object(objects.length, "123", 20 + col * 80, 180 - row * 15, 20),
      );
  const grid = [
    {
      id: "table",
      cells: [{ id: "wrong", bounds: [10, 600, 260, 690], row: 0, column: 0 }],
    },
  ];
  const cs = pageCandidates(objects, 600, 800, [], grid);
  assert(cs.every((c) => !c.model.cell && c.model.structureWarning));
  assert(cs.length >= 3);
  const tiny = pageCandidates(
    [object(0, "1", 20, 780, 4)],
    600,
    800,
    [],
    [
      {
        id: "t",
        cells: [{ id: "small", bounds: [18, 10, 28, 25], row: 0, column: 0 }],
      },
    ],
  );
  assert(tiny.some((c) => c.model.cell?.id === "small"));
  assert(canFast({ ...tiny.find((c) => c.model.cell).model, growth: "fixed" }));
});
test("font measurements use original fractional advances instead of Chromium rounded pixels", () => {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        measureText: () => ({
          width: 6,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: 5,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        }),
      }),
    }),
  };
  try {
    const fonts = new FastFonts(() => {});
    fonts.fonts.set("font", {
      key: "font",
      coverage: new Set([57]),
      family: "test",
      advances: { 57: 0.552 },
      fontBold: false,
      fontItalic: false,
    });
    assert(
      Math.abs(fonts.measure("9", { fontKey: "font", size: 10 }).width - 5.52) <
        1e-9,
    );
  } finally {
    globalThis.document = previous;
  }
});
test("short insert preserves preceding and following lines and their fractional origins", () => {
  const m = {
    text: "abcd\nefgh\nijkl",
    frame: { x: 20, y: 30, width: 100, height: 80 },
    size: 10,
    lineHeight: 1.4,
    color: "#000000",
    align: "left",
    fontKey: "font",
    growth: "fixed",
    allowOverflow: true,
  };
  const first = fastLayout(m, () => ({ width: 5.2, fontKey: "font" }));
  m.originalLayout = {
    text: m.text,
    frame: { ...m.frame },
    settings: { size: 10, lineHeight: 1.4, align: "left" },
    glyphs: first.glyphs.map((g) => ({
      ...g,
      style: { fontKey: "font", size: 10, horizontalScale: 100 },
    })),
  };
  m.text = "abcd\neXfgh\nijkl";
  const result = fastLayout(m, () => ({ width: 5.2, fontKey: "font" }));
  assert.equal(result.layoutMode, "局部行重排");
  for (const index of [0, 1, 2, 3, 11, 12, 13, 14]) {
    const before = first.glyphs[index < 4 ? index : index - 1],
      after = result.glyphs[index];
    assert.equal(after.originX, before.originX);
    assert.equal(after.baseline, before.baseline);
  }
});

import { sourceLigature } from "../src/ligatures.mjs";
test("source ligatures keep exact logical offsets and never merge ordinary distinct or mixed-style glyphs", () => {
 const glyphs = [..."ffi"].map((text,i)=>({text,start:i,end:i+1,fontKey:"face",size:12,originX:30,baseline:50,color:"#000000"}));
 const before=structuredClone(glyphs), coverage=new Set([0xfb03,0xfb00,0xfb01]);
 assert.deepEqual(sourceLigature(glyphs,0,coverage),{text:"ﬃ",count:3});
 assert.deepEqual(glyphs,before);
 glyphs[1].originX=34;assert.equal(sourceLigature(glyphs,0,coverage).count,1);
 glyphs[1].originX=30;glyphs[1].color="#ff0000";assert.equal(sourceLigature(glyphs,0,coverage).count,1);
 assert.equal(sourceLigature(before,0,new Set()).count,1);
});

import { encodeProject, decodeProject } from "../src/project.mjs";
test("nonblocking preflight round trips through a project without confusing page geometry and page numbers", async () => {
 const preflight=editWarnings({pageWidth:100,pageHeight:100},{mappingComplete:true,frameOverset:true,glyphs:[{x:98,y:30,w:8,h:10}]});
 const state={nodes:[],ocr:[],annotations:[],nativeEdits:[{page:1,type:"flow",preflight}]};
 const saved=await encodeProject(new Uint8Array([37,80,68,70]),"test.pdf",state,{local:true});
 const reopened=await decodeProject(saved,{local:true});
 assert.deepEqual(reopened.state.nativeEdits[0].preflight,preflight);
 const bad=await encodeProject(new Uint8Array([37,80,68,70]),"test.pdf",{...state,nativeEdits:[{page:false}]},{local:true});
 await assert.rejects(decodeProject(bad,{local:true}),/工程数值无效/);
});

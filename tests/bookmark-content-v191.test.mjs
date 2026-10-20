import test from "node:test";
import assert from "node:assert/strict";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFHexString,
  PDFRawStream,
} from "../src/vendor/pdf-lib.js";
import { PdfEngine } from "../src/pdf-core.mjs";
const N = PDFName.of;

async function fixture() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 131; i++) doc.addPage([522, 737]);
  const c = doc.context,
    payload = new TextEncoder().encode(
      "<metadata>unchanged textbook source</metadata>",
    );
  const metadata = c.register(
    PDFRawStream.of(
      c.obj({ Length: payload.length, Subtype: "XML", Type: "Metadata" }),
      payload,
    ),
  );
  const tree = c.obj({ Type: "StructTreeRoot" }),
    treeRef = c.register(tree);
  const element = c.register(
    c.obj({ S: "Document", P: treeRef, Metadata: metadata }),
  );
  tree.set(N("K"), element);
  doc.catalog.set(N("StructTreeRoot"), treeRef);
  const outline = c.obj({ Type: "Outlines" }),
    root = c.register(outline),
    refs = [];
  for (const page of [1, 2, 131])
    refs.push(
      c.register(
        c.obj({
          Title: PDFHexString.fromText(`教材 ${page}`),
          Parent: root,
          SE: element,
          A: c.obj({
            S: "GoTo",
            D: c.obj([doc.getPage(page - 1).ref, N("FitH"), PDFNumber.of(737)]),
          }),
        }),
      ),
    );
  for (let i = 0; i < refs.length; i++) {
    const item = c.lookup(refs[i]);
    if (i) item.set(N("Prev"), refs[i - 1]);
    if (i + 1 < refs.length) item.set(N("Next"), refs[i + 1]);
  }
  outline.set(N("First"), refs[0]);
  outline.set(N("Last"), refs.at(-1));
  doc.catalog.set(N("Outlines"), root);
  return doc.save();
}
function metadata(doc) {
  return doc.catalog
    .lookup(N("Outlines"))
    .lookup(N("First"))
    .lookup(N("SE"))
    .lookup(N("Metadata"));
}

test("131-page textbook outline identity survives native stream dictionary reordering and two saves", async () => {
  const original = await fixture(),
    engine = new PdfEngine(),
    info = await engine.open(original);
  const changed = await PDFDocument.load(original),
    stream = metadata(changed);
  const length = stream.dict.get(N("Length"));
  stream.dict.delete(N("Length"));
  stream.dict.set(N("Length"), length);
  changed.getPage(11).drawText("Edited paragraph");
  const contentBytes = await changed.save();
  const nodes = info.nodes.map((n, i) => ({
    ...n,
    title: i === 1 ? "Latest bookmark title" : n.title,
  }));
  for (let i = 0; i < 2; i++) {
    const saved = await engine.save({ nodes, contentBytes }),
      reopened = new PdfEngine(),
      result = await reopened.open(saved);
    assert.deepEqual(
      result.nodes.map((n) => n.target.page),
      [1, 2, 131],
    );
    assert.equal(result.nodes[1].title, "Latest bookmark title");
    assert.deepEqual(
      metadata(reopened.doc).getContents(),
      stream.getContents(),
    );
    assert(result.nodes.every((n) => n.raw.includes("/SE")));
  }
});

test("changed outline stream payload or metadata dictionary still prevents source rebinding", async () => {
  const original = await fixture(),
    engine = new PdfEngine(),
    info = await engine.open(original);
  for (const mutate of [
    (s) => {
      s.contents = new TextEncoder().encode(
        "<metadata>different textbook source</metadata>",
      );
    },
    (s) => s.dict.set(N("Subtype"), N("Changed")),
  ]) {
    const changed = await PDFDocument.load(original);
    mutate(metadata(changed));
    await assert.rejects(
      engine.save({ nodes: info.nodes, contentBytes: await changed.save() }),
      /来源发生变化/,
    );
  }
});

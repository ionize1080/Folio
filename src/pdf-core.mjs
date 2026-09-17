import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFNumber,
  PDFString,
  PDFHexString,
  PDFRef,
  PDFNull,
  rgb,
  degrees,
  StandardFonts,
} from "./vendor/pdf-lib.js";
import { MODES, validate, uid, childrenMap } from "./model.mjs";
const N = (s) => PDFName.of(s),
  str = (o) =>
    o instanceof PDFString || o instanceof PDFHexString
      ? o.decodeText()
      : o instanceof PDFName
        ? o.decodeText()
        : "";
const num = (o) => (o instanceof PDFNumber ? o.asNumber() : null);
// Show byte strings as hex so UTF-16 is never misrepresented as corrupt Unicode.
function readableRaw(o) {
  if (o instanceof PDFString)
    return (
      "<" +
      Array.from(o.asBytes(), (b) => b.toString(16).padStart(2, "0")).join("") +
      ">"
    );
  if (o instanceof PDFArray)
    return "[ " + o.asArray().map(readableRaw).join(" ") + " ]";
  if (o instanceof PDFDict)
    return (
      "<<\n" +
      o
        .entries()
        .map(([k, v]) => k.toString() + " " + readableRaw(v))
        .join("\n") +
      "\n>>"
    );
  return o.toString();
}
export class PdfEngine {
  async open(bytes) {
    this.bytes = bytes;
    this.doc = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
    this.pages = this.doc.getPages();
    this.refs = new Map(this.pages.map((p, i) => [p.ref.toString(), i + 1]));
    this.warnings = [];
    const ctx = this.doc.context;
    this.lookup = (o) => {
      try {
        return ctx.lookup(o);
      } catch {
        return undefined;
      }
    };
    this.sources = new Map();
    this.named = this.readNames();
    const nodes = this.readOutlines();
    return {
      nodes,
      pageCount: this.pages.length,
      pages: this.pages.map((p) => ({
        userUnit: num(p.node.get(N("UserUnit"))) || 1,
        width: p.getWidth(),
        height: p.getHeight(),
        rotation: p.getRotation().angle,
        box: p.getCropBox(),
      })),
      warnings: this.warnings,
      metadata: {
        title: this.doc.getTitle() || "",
        author: this.doc.getAuthor() || "",
        subject: this.doc.getSubject() || "",
        keywords: this.doc.getKeywords() || "",
      },
    };
  }
  readNames() {
    const map = new Map(),
      old = this.lookup(this.doc.catalog.get(N("Dests")));
    if (old instanceof PDFDict)
      for (const [k, v] of old.entries()) map.set(str(k), v);
    const names = this.lookup(this.doc.catalog.get(N("Names"))),
      root = names instanceof PDFDict ? names.get(N("Dests")) : null;
    const stack = root ? [root] : [],
      seen = new Set();
    while (stack.length) {
      const r = stack.pop(),
        key = r.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const d = this.lookup(r);
      if (!(d instanceof PDFDict)) continue;
      const a = this.lookup(d.get(N("Names")));
      if (a instanceof PDFArray)
        for (let i = 0; i + 1 < a.size(); i += 2)
          map.set(str(this.lookup(a.get(i))), a.get(i + 1));
      const kids = this.lookup(d.get(N("Kids")));
      if (kids instanceof PDFArray) stack.push(...kids.asArray());
    }
    return map;
  }
  parseDest(obj, seen = new Set()) {
    let a = this.lookup(obj);
    if (a instanceof PDFDict) a = this.lookup(a.get(N("D")));
    if (
      a instanceof PDFName ||
      a instanceof PDFString ||
      a instanceof PDFHexString
    ) {
      const name = str(a);
      if (seen.has(name)) return null;
      seen.add(name);
      const resolved = this.parseDest(this.named.get(name), seen);
      return resolved ? { ...resolved, named: name } : null;
    }
    if (!(a instanceof PDFArray) || a.size() < 2) return null;
    const pageRef = a.get(0),
      page =
        pageRef instanceof PDFRef ? this.refs.get(pageRef.toString()) : null,
      mode = str(this.lookup(a.get(1)));
    if (!page || !(mode in MODES) || a.size() < MODES[mode] + 2) return null;
    return {
      page,
      mode,
      args: Array.from({ length: MODES[mode] }, (_, i) =>
        num(this.lookup(a.get(i + 2))),
      ),
    };
  }
  readOutlines() {
    const root = this.lookup(this.doc.catalog.get(N("Outlines")));
    if (!(root instanceof PDFDict)) return [];
    const out = [],
      stack = [],
      visited = new Set();
    if (root.get(N("First")))
      stack.push({ ref: root.get(N("First")), parent: null });
    while (stack.length) {
      const { ref, parent } = stack.pop(),
        key = ref.toString();
      if (visited.has(key)) {
        this.warnings.push("原书签包含循环引用，已跳过重复节点");
        continue;
      }
      visited.add(key);
      if (out.length >= 200000) throw Error("文档书签超过 200,000 条");
      const d = this.lookup(ref);
      if (!(d instanceof PDFDict)) continue;
      const id = uid(),
        sourceRef = key;
      this.sources.set(sourceRef, d);
      const action = this.lookup(d.get(N("A"))),
        dest =
          d.get(N("Dest")) ||
          (action instanceof PDFDict && str(action.get(N("S"))) === "GoTo"
            ? action.get(N("D"))
            : null),
        parsed = this.parseDest(dest);
      const c = this.lookup(d.get(N("C"))),
        color =
          c instanceof PDFArray && c.size() === 3
            ? "#" +
              c
                .asArray()
                .map((x) =>
                  Math.round(
                    Math.max(0, Math.min(1, num(this.lookup(x)) || 0)) * 255,
                  )
                    .toString(16)
                    .padStart(2, "0"),
                )
                .join("")
            : "#263449";
      const flags = num(this.lookup(d.get(N("F")))) || 0;
      // Preserve all original action dictionaries and named destinations until explicitly edited.
      out.push({
        id,
        parent,
        title: str(this.lookup(d.get(N("Title")))),
        open: (num(this.lookup(d.get(N("Count")))) ?? 0) >= 0,
        bold: !!(flags & 2),
        italic: !!(flags & 1),
        color,
        sourceRef,
        target: {
          kind: "preserve",
          ...(parsed || {}),
          label: parsed
            ? parsed.named
              ? `命名目标：${parsed.named}`
              : parsed.mode
            : action instanceof PDFDict
              ? `原始动作：${str(action.get(N("S")))}`
              : "无可解析目标",
        },
        raw: readableRaw(d),
        decoded: {
          Title: str(this.lookup(d.get(N("Title")))),
          target: parsed,
          sourceRef,
        },
      });
      if (d.get(N("Next"))) stack.push({ ref: d.get(N("Next")), parent });
      if (d.get(N("First"))) stack.push({ ref: d.get(N("First")), parent: id });
    }
    return out;
  }
  writeOutlines(nodes) {
    validate(nodes, this.pages.length);
    const ctx = this.doc.context;
    if (!nodes.length) {
      this.doc.catalog.delete(N("Outlines"));
      return;
    }
    const root = ctx.obj({ Type: "Outlines" }),
      rootRef = ctx.register(root),
      dicts = new Map(),
      refs = new Map(),
      children = childrenMap(nodes);
    for (const n of nodes) {
      const src = this.sources.get(n.sourceRef),
        d = ctx.obj({});
      if (src)
        for (const [k, v] of src.entries())
          if (
            ![
              "Parent",
              "Prev",
              "Next",
              "First",
              "Last",
              "Count",
              "Title",
              "C",
              "F",
            ].includes(k.decodeText())
          )
            d.set(k, v);
      d.set(N("Title"), PDFHexString.fromText(n.title));
      d.set(N("F"), PDFNumber.of((n.bold ? 2 : 0) + (n.italic ? 1 : 0)));
      d.set(
        N("C"),
        ctx.obj(
          [1, 3, 5].map((i) => parseInt(n.color.slice(i, i + 2), 16) / 255),
        ),
      );
      if (n.target.kind === "dest") {
        d.delete(N("A"));
        d.delete(N("Dest"));
        const t = n.target;
        d.set(
          N("Dest"),
          ctx.obj([
            this.pages[t.page - 1].ref,
            N(t.mode),
            ...t.args.map((v) => (v === null ? PDFNull : PDFNumber.of(v))),
          ]),
        );
      } else if (!src) throw Error("原始动作已失去来源，请重新指定该书签目标");
      dicts.set(n.id, d);
      refs.set(n.id, ctx.register(d));
    }
    // Count is the number of visible descendants if this node were open, not total descendants.
    const visible = new Map();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i],
        kids = children.get(n.id) || [];
      visible.set(
        n.id,
        kids.reduce((v, c) => v + 1 + (c.open ? visible.get(c.id) || 0 : 0), 0),
      );
    }
    for (const [parent, kids] of children) {
      const pd = parent === null ? root : dicts.get(parent),
        pr = parent === null ? rootRef : refs.get(parent);
      pd.set(N("First"), refs.get(kids[0].id));
      pd.set(N("Last"), refs.get(kids.at(-1).id));
      kids.forEach((n, i) => {
        const d = dicts.get(n.id);
        d.set(N("Parent"), pr);
        if (i) d.set(N("Prev"), refs.get(kids[i - 1].id));
        if (i + 1 < kids.length) d.set(N("Next"), refs.get(kids[i + 1].id));
        const count = visible.get(n.id);
        if (count) d.set(N("Count"), PDFNumber.of(n.open ? count : -count));
      });
    }
    root.set(
      N("Count"),
      PDFNumber.of(
        (children.get(null) || []).reduce(
          (v, n) => v + 1 + (n.open ? visible.get(n.id) : 0),
          0,
        ),
      ),
    );
    this.doc.catalog.set(N("Outlines"), rootRef);
  }
  async save({
    nodes,
    rotations = {},
    annotations = [],
    metadata = null,
    showBookmarks = true,
    contentBytes = null,
  }) {
    // Work on a new document for each save so repeated saves never duplicate annotations or objects.
    const working = new PdfEngine();
    await working.open(contentBytes || this.bytes);
    if (contentBytes) {
      const keys = [...this.sources.keys()],
        values = [...working.sources.values()];
      if (keys.length !== values.length)
        throw Error("内容预览的原始书签来源发生变化，请重新打开文档");
      working.sources = new Map(keys.map((key, i) => [key, values[i]]));
    }
    working.writeOutlines(nodes);
    for (const [p, a] of Object.entries(rotations)) {
      if (!working.pages[Number(p) - 1] || !Number.isFinite(a) || a % 90)
        throw Error("旋转参数无效");
      working.pages[Number(p) - 1].setRotation(degrees(a));
    }
    for (const a of annotations) working.addAnnotation(a);
    if (metadata) {
      working.doc.setTitle(metadata.title || "");
      working.doc.setAuthor(metadata.author || "");
      working.doc.setSubject(metadata.subject || "");
      working.doc.setKeywords(
        (metadata.keywords || "")
          .split(/[,，]/)
          .map((x) => x.trim())
          .filter(Boolean),
      );
    }
    if (showBookmarks) working.doc.catalog.set(N("PageMode"), N("UseOutlines"));
    return working.doc.save({
      useObjectStreams: true,
      objectsPerTick: 100,
      addDefaultPage: false,
    });
  }
  addAnnotation(a) {
    const page = this.pages[a.page - 1];
    if (!page) throw Error("批注页码无效");
    const r = a.rect;
    if (
      !Array.isArray(r) ||
      r.length !== 4 ||
      r.some((x) => !Number.isFinite(x))
    )
      throw Error("批注坐标无效");
    const ctx = this.doc.context,
      color = [1, 3, 5].map(
        (i) => parseInt((a.color || "#f3c640").slice(i, i + 2), 16) / 255,
      ),
      sub =
        a.type === "highlight"
          ? "Highlight"
          : a.type === "rectangle"
            ? "Square"
            : "Text";
    const obj = {
      Type: "Annot",
      Subtype: sub,
      Rect: r,
      C: color,
      F: 4,
      Contents: PDFHexString.fromText(a.text || ""),
      T: PDFHexString.fromText("Folio"),
      M: PDFString.of(
        "D:" +
          new Date()
            .toISOString()
            .replace(/[-:TZ.]/g, "")
            .slice(0, 14) +
          "Z",
      ),
    };
    if (sub === "Highlight") {
      obj.QuadPoints = [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]];
      obj.CA = 0.35;
    } else if (sub === "Square") {
      obj.BS = ctx.obj({ W: 1.5, S: "S" });
    } else obj.Name = N("Comment");
    page.node.addAnnot(ctx.register(ctx.obj(obj)));
  }
  async extractPages(indices) {
    if (
      !indices.length ||
      indices.some(
        (i) => !Number.isInteger(i) || i < 0 || i >= this.pages.length,
      )
    )
      throw Error("提取页码无效");
    const out = await PDFDocument.create();
    for (const p of await out.copyPages(this.doc, indices)) out.addPage(p);
    return out.save();
  }
  async merge(bytes) {
    const other = await PDFDocument.load(bytes, { updateMetadata: false });
    for (const p of await this.doc.copyPages(other, other.getPageIndices()))
      this.doc.addPage(p);
    return this.doc.save();
  }
}

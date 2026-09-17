// Flat preorder outline model. Parent references avoid recursive traversal limits.
export const MODES = {
  XYZ: 3,
  Fit: 0,
  FitH: 1,
  FitV: 1,
  FitR: 4,
  FitB: 0,
  FitBH: 1,
  FitBV: 1,
};
export const uid = () => globalThis.crypto.randomUUID();
export const clone = (x) => structuredClone(x);
export function makeNode(title, page = 1, parent = null) {
  return {
    id: uid(),
    parent,
    title,
    open: true,
    bold: false,
    italic: false,
    color: "#263449",
    sourceRef: null,
    target: { kind: "dest", page, mode: "XYZ", args: [null, null, null] },
  };
}
export function validate(nodes, pageCount = Infinity) {
  if (!Array.isArray(nodes) || nodes.length > 200000)
    throw Error("书签数量无效（最多 200,000 条）");
  const ids = new Set(),
    stack = [];
  for (const n of nodes) {
    if (!n || typeof n.id !== "string" || ids.has(n.id))
      throw Error("书签 ID 缺失或重复");
    if (typeof n.title !== "string" || n.title.length > 32768)
      throw Error("标题无效或过长");
    if (n.parent !== null) {
      while (stack.length && stack.at(-1) !== n.parent) stack.pop();
      if (!stack.length) throw Error("书签层级必须为合法的前序树");
    } else stack.length = 0;
    stack.push(n.id);
    ids.add(n.id);
    if (!/^#[0-9a-f]{6}$/i.test(n.color)) throw Error("书签颜色无效");
    const t = n.target;
    if (!t || !["dest", "preserve"].includes(t.kind))
      throw Error("跳转目标无效");
    if (t.kind === "dest") {
      if (!Number.isInteger(t.page) || t.page < 1 || t.page > pageCount)
        throw Error(`「${n.title}」的页码超出文档范围`);
      if (
        !(t.mode in MODES) ||
        !Array.isArray(t.args) ||
        t.args.length !== MODES[t.mode]
      )
        throw Error("跳转模式或坐标数量无效");
      if (
        t.args.some(
          (v) => v !== null && (typeof v !== "number" || !Number.isFinite(v)),
        )
      )
        throw Error("坐标必须是有限数值或 null");
      if (
        t.mode === "FitR" &&
        (t.args.some((v) => v === null) ||
          t.args[2] <= t.args[0] ||
          t.args[3] <= t.args[1])
      )
        throw Error("FitR 需要有效的 left、bottom、right、top 矩形");
      if (t.mode === "XYZ" && t.args[2] !== null && t.args[2] < 0)
        throw Error("缩放比例不能为负数");
    }
  }
  return nodes;
}
export function childrenMap(nodes) {
  const m = new Map();
  for (const n of nodes) {
    if (!m.has(n.parent)) m.set(n.parent, []);
    m.get(n.parent).push(n);
  }
  return m;
}
export function descendants(nodes, ids) {
  const set = new Set(ids);
  for (const n of nodes) if (set.has(n.parent)) set.add(n.id);
  return set;
}
export function depths(nodes) {
  const m = new Map();
  for (const n of nodes)
    m.set(n.id, n.parent === null ? 0 : (m.get(n.parent) ?? -1) + 1);
  return m;
}
export function flattenChildren(map) {
  const out = [],
    stack = [...(map.get(null) || [])].reverse();
  while (stack.length) {
    const n = stack.pop();
    out.push(n);
    const c = map.get(n.id) || [];
    for (let i = c.length - 1; i >= 0; i--) stack.push(c[i]);
  }
  return out;
}
export function move(nodes, ids, targetId, where) {
  const out = clone(nodes),
    chosen = descendants(out, ids),
    roots = out.filter((n) => ids.has(n.id) && !chosen.has(n.parent));
  if (!roots.length) return out;
  if (targetId && chosen.has(targetId)) throw Error("不能移动到自身或子书签中");
  const rest = out.filter((n) => !chosen.has(n.id));
  const target = rest.find((n) => n.id === targetId);
  const parent = where === "inside" ? targetId : (target?.parent ?? null);
  for (const n of roots) n.parent = parent;
  const chunk = out.filter((n) => chosen.has(n.id));
  let at = rest.length;
  if (target) {
    at = rest.indexOf(target);
    if (where !== "before") {
      at++;
      const sub = descendants(rest, new Set([targetId]));
      while (at < rest.length && sub.has(rest[at].id)) at++;
    }
  }
  rest.splice(at, 0, ...chunk);
  return validate(rest);
}
export function applyBatch(nodes, ids, rule, pageCount) {
  const out = clone(nodes);
  let re;
  if (rule.op === "replace")
    re = new RegExp(rule.find, rule.caseSensitive ? "gu" : "giu");
  const d = depths(out);
  let serial = Number(rule.start) || 1;
  for (const n of out) {
    if (!ids.has(n.id)) continue;
    switch (rule.op) {
      case "replace":
        n.title = n.title.replace(re, rule.replacement || "");
        break;
      case "prefix":
        n.title = (rule.prefix || "") + n.title + (rule.suffix || "");
        break;
      case "trim":
        n.title = n.title.trim().replace(/\s+/g, " ");
        break;
      case "number":
        n.title = (rule.template || "{n}. {title}")
          .replaceAll("{n}", String(serial++))
          .replaceAll("{level}", String(d.get(n.id) + 1))
          .replaceAll("{page}", String(n.target.page || ""))
          .replaceAll("{title}", n.title);
        break;
      case "offset":
        if (n.target.kind === "dest") n.target.page += Number(rule.amount);
        break;
      case "coordinates":
        if (n.target.kind === "dest") {
          n.target.mode = rule.mode;
          n.target.args = clone(rule.args);
        }
        break;
      case "parameters": {
        const original = n.target;
        if (!original.page) throw Error(`「${n.title}」不是本地页目标`);
        const edits = rule.edits || {};
        if (!Object.values(edits).some((e) => e.op !== "keep")) break;
        if (original.kind === "preserve" && !rule.convert)
          throw Error("原始目标需要勾选「转换原始本地目标」");
        const t = {
          kind: "dest",
          page: original.page,
          mode: original.mode,
          args: clone(original.args),
        };
        for (const [key, e] of Object.entries(edits)) {
          if (e.op === "keep") continue;
          const i = Number(key),
            prev = key === "page" ? t.page : t.args[i];
          if (key !== "page" && (i < 0 || i >= t.args.length))
            throw Error("所选目标模式参数不同，请分模式处理");
          let value;
          if (e.op === "null") value = null;
          else {
            if (!Number.isFinite(Number(e.value)))
              throw Error("参数不是有效数字");
            value = Number(e.value);
            if (e.op === "relative") {
              if (prev === null)
                throw Error("null 参数不能相对偏移，请先设绝对值");
              value += prev;
            }
          }
          if (key === "page") {
            if (value === null) throw Error("页码不能为 null");
            t.page = value;
          } else t.args[i] = value;
        }
        n.target = t;
        break;
      }
      case "style":
        n.bold = !!rule.bold;
        n.italic = !!rule.italic;
        n.color = rule.color || n.color;
        break;
      case "open":
        n.open = !!rule.open;
        break;
      default:
        throw Error("未知批处理规则");
    }
  }
  return validate(out, pageCount);
}
export function sortTree(nodes, by = "page") {
  const map = childrenMap(clone(nodes));
  for (const a of map.values())
    a.sort((x, y) =>
      by === "title"
        ? x.title.localeCompare(y.title, "zh-CN", { numeric: true })
        : (x.target.page ?? Infinity) - (y.target.page ?? Infinity),
    );
  return flattenChildren(map);
}
export function deduplicate(nodes) {
  const seen = new Set(),
    removed = new Map(),
    out = [];
  for (const n0 of nodes) {
    const n = clone(n0);
    while (removed.has(n.parent)) n.parent = removed.get(n.parent);
    const key = JSON.stringify([n.parent, n.title, n.target]);
    if (seen.has(key)) {
      removed.set(n.id, n.parent);
      continue;
    }
    seen.add(key);
    out.push(n);
  }
  return out;
}
export function importJSON(text, pageCount) {
  const data = JSON.parse(text);
  if (data.format !== "folio-outline/1")
    throw Error("不是 Folio 书签 JSON 文件");
  const nodes = clone(data.nodes),
    ids = new Map(nodes.map((n) => [n.id, uid()]));
  let skipped = 0;
  for (const n of nodes) {
    n.id = ids.get(n.id);
    n.parent = n.parent === null ? null : ids.get(n.parent);
    n.sourceRef = null;
    if (n.target.kind === "preserve") {
      if (n.target.page)
        n.target = {
          kind: "dest",
          page: n.target.page,
          mode: n.target.mode || "XYZ",
          args: n.target.args || [null, null, null],
        };
      else {
        n.target = { kind: "dest", page: 1, mode: "Fit", args: [] };
        skipped++;
      }
    }
  }
  return { nodes: validate(nodes, pageCount), skipped };
}
export function parseTOC(text, pageCount, offset = 0) {
  const nodes = [],
    parents = [];
  let bad = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(
      /^(\s*)(.*?)\s*(?:\t|\.{2,}|…+|·{2,}|\s{2,})\s*(\d+)\s*$/,
    );
    if (!m) {
      bad++;
      continue;
    }
    const indent = m[1].replaceAll("\t", "  ").length,
      depth = Math.min(Math.floor(indent / 2), parents.length),
      page = Number(m[3]) + offset;
    const n = makeNode(m[2].trim(), page, depth ? parents[depth - 1] : null);
    parents.length = depth;
    parents.push(n.id);
    nodes.push(n);
  }
  validate(nodes, pageCount);
  return { nodes, bad };
}
// Large OCR datasets are immutable shared assets, not copied into every undo step.
const immutableOCR = new WeakSet(),
  ocrSizes = new WeakMap();
function ocrSize(blocks) {
  if (!blocks) return 0;
  if (!ocrSizes.has(blocks))
    ocrSizes.set(
      blocks,
      blocks.reduce(
        (n, b) =>
          n + 256 + (b.text?.length || 0) * 2 + (b.rawText?.length || 0) * 2,
        0,
      ),
    );
  return ocrSizes.get(blocks);
}
export function shareOCR(blocks) {
  if (!blocks || immutableOCR.has(blocks)) return blocks;
  for (const b of blocks) {
    if (b.quad) {
      for (const point of b.quad) Object.freeze(point);
      Object.freeze(b.quad);
    }
    Object.freeze(b);
  }
  Object.freeze(blocks);
  immutableOCR.add(blocks);
  return blocks;
}
export class History {
  constructor(
    limit = 40,
    budget = 32 * 1024 * 1024,
    assetBudget = 256 * 1024 * 1024,
  ) {
    this.assetBudget = assetBudget;
    this.limit = limit;
    this.budget = budget;
    this.past = [];
    this.future = [];
  }
  pack(value) {
    if (value && !Array.isArray(value) && Array.isArray(value.ocr)) {
      const { ocr, ...small } = value;
      return { json: JSON.stringify(small), ocr: shareOCR(ocr) };
    }
    return { json: JSON.stringify(value) };
  }
  unpack(entry) {
    const v = JSON.parse(entry.json);
    if (entry.ocr) v.ocr = entry.ocr;
    return v;
  }
  trim() {
    let bytes = this.past.reduce((n, e) => n + e.json.length * 2, 0);
    const assetBytes = () =>
      [...new Set(this.past.map((e) => e.ocr))].reduce(
        (n, ocr) => n + ocrSize(ocr),
        0,
      );
    // Keep at least the most recent operation, even for an unusually large node tree.
    while (
      this.past.length > Math.max(1, this.limit) ||
      ((bytes > this.budget || assetBytes() > this.assetBudget) &&
        this.past.length > 1)
    )
      bytes -= this.past.shift().json.length * 2;
  }
  push(value) {
    this.past.push(this.pack(value));
    this.future = [];
    this.trim();
  }
  undo(value) {
    if (!this.past.length) return null;
    this.future.push(this.pack(value));
    return this.unpack(this.past.pop());
  }
  redo(value) {
    if (!this.future.length) return null;
    this.past.push(this.pack(value));
    this.trim();
    return this.unpack(this.future.pop());
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}

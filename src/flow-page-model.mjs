import { sourceStyles } from "./flow-style.mjs";
import { paragraphCandidates, mergeCandidates } from "./flow-model.mjs";

const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
export const intersects = (a, b, t = 0) =>
  a[2] > b[0] + t && a[0] < b[2] - t && a[3] > b[1] + t && a[1] < b[3] - t;
export const topBounds = (o, h) => [
  o.bounds[0],
  h - o.bounds[3],
  o.bounds[2],
  h - o.bounds[1],
];
export const frameBounds = (f) => [f.x, f.y, f.x + f.width, f.y + f.height];

export function pageCandidates(objects, w, h, regions = [], tables = []) {
  // PDF font size is in text space; Office PDFs often use 280pt with a 0.05 CTM.
  // Baseline / grouping thresholds must use its effective page-space size.
  objects = objects.map((o) =>
    o.type === "text"
      ? { ...o, size: o.size * Math.hypot(o.matrix[2], o.matrix[3]) }
      : o,
  );
  // Repeated native line starts establish gutters even when AI labels the whole page as text.
  const lanes = [];
  for (const o of objects.filter(
    (o) =>
      o.type === "text" &&
      o.flowEditable &&
      o.bounds[2] - o.bounds[0] > w * 0.14 &&
      o.bounds[2] - o.bounds[0] < w * 0.48,
  )) {
    let lane = lanes.find((l) => Math.abs(l.x - o.bounds[0]) < o.size * 2.5);
    if (!lane) {
      lane = { x: o.bounds[0], left: [], right: [] };
      lanes.push(lane);
    }
    lane.left.push(o.bounds[0]);
    lane.right.push(o.bounds[2]);
  }
  const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
  const strong = lanes
    .filter((l) => l.left.length >= 3)
    .sort((a, b) => a.x - b.x);
  const cuts = strong
    .slice(1)
    .map((l, i) => (median(strong[i].right) + median(l.left)) / 2)
    .filter((c, i) => median(strong[i].right) < median(strong[i + 1].left));
  const cellObjects = new Map();
  const cellList = tables.flatMap((t) =>
    t.cells.map((c) => ({ ...c, tableId: t.id })),
  );
  const groups = new Map();
  for (const o of objects.filter((o) => o.type === "text" && o.flowEditable)) {
    const b = topBounds(o, h),
      x = (b[0] + b[2]) / 2,
      y = (b[1] + b[3]) / 2;
    const cell = cellList.find(
      (c) =>
        x > c.bounds[0] &&
        x < c.bounds[2] &&
        y > c.bounds[1] &&
        y < c.bounds[3],
    );
    if (cell) {
      if (!cellObjects.has(cell.id)) cellObjects.set(cell.id, []);
      cellObjects.get(cell.id).push(o);
      continue;
    }
    let r = regions
      .map((r, i) => ({ ...r, i }))
      .filter(
        (r) =>
          x >= r.bounds[0] &&
          x <= r.bounds[2] &&
          y >= r.bounds[1] &&
          y <= r.bounds[3],
      )
      .sort((a, b) => area(a.bounds) - area(b.bounds))[0];
    if (!r && /^[·•▪●「『（(【“‘\s]+$/.test(o.text))
      r = regions
        .map((r, i) => ({ ...r, i }))
        .find(
          (r) =>
            r.kind === "text" &&
            y >= r.bounds[1] - 2 &&
            y <= r.bounds[3] + 2 &&
            r.bounds[0] - b[2] >= -o.size &&
            r.bounds[0] - b[2] < o.size * 3,
        );
    // In tables, no vertical aggregation across rows or cells.
    const column = cuts.some((c) => b[0] < c - 2 && b[2] > c + 2)
      ? "span"
      : cuts.filter((c) => x > c).length;
    const key =
      (r
        ? `${r.i}:${r.kind === "table" ? Math.round(o.matrix[5] / 3) : ""}`
        : "geometry") +
      ":" +
      column;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  let candidates = [...groups.values()].flatMap((g) =>
    paragraphCandidates(g, h),
  );
  // Native deletion now preserves advances inside shared BT groups; never merge columns by BT identity.
  candidates = candidates.map((c, i) => {
    const cs = [c];
    const m = mergeCandidates(cs, w, h);
    const src = objects.filter((o) =>
      m.sources.some((s) => s.index === o.index),
    );
    const bases = [
      ...new Set(src.map((o) => Math.round(o.matrix[5] * 10) / 10)),
    ].sort((a, b) => b - a);
    const gaps = bases
      .slice(1)
      .map((b, i) => bases[i] - b)
      .filter((v) => v > m.size * 0.65 && v < m.size * 3)
      .sort((a, b) => a - b);
    m.size = src[0].size;
    m.lineHeight = gaps.length
      ? Math.max(1, Math.min(3, gaps[Math.floor(gaps.length / 2)] / m.size))
      : 1.4;
    const fill = src.find((o) => o.fill)?.fill;
    if (fill)
      m.color =
        "#" +
        fill
          .slice(0, 3)
          .map((v) => Math.round(v).toString(16).padStart(2, "0"))
          .join("");
    m.text = cs.length === 1 ? cs[0].text : m.text;
    m.engine = "story";
    m.schema = 2;
    const selected = new Set(m.sources.map((s) => s.index));
    let reason = "";
    const original = { ...m.frame };
    const firstBase = Math.max(...src.map((o) => o.matrix[5]));
    const lastBase = Math.min(...src.map((o) => o.matrix[5]));
    const originX = Math.min(...src.map((o) => o.matrix[4]));
    const right = Math.max(...src.map((o) => o.bounds[2]));
    m.frame.x = Math.max(0, originX);
    m.frame.width = Math.min(
      w - m.frame.x,
      Math.max(m.size * 2, right - m.frame.x),
    );
    // Story uses a line box, while PDF bounds describe ink only.
    m.frame.y = Math.max(0, h - firstBase - m.size * (m.lineHeight / 2 + 0.3));
    m.frame.height = Math.max(
      10,
      firstBase - lastBase + m.size * m.lineHeight + 1,
    );
    m.firstIndent = Math.max(
      0,
      Math.min(
        ...src
          .filter((o) => Math.abs(o.matrix[5] - firstBase) < 1)
          .map((o) => o.matrix[4]),
      ) - m.frame.x,
    );
    // Give typing room down to the next paragraph, rule, figure or page edge.
    const x0 = m.frame.x,
      x1 = x0 + m.frame.width,
      top = m.frame.y;
    let bottom = Math.min(
      h - 12,
      top + Math.max(m.frame.height, m.size * m.lineHeight),
    );
    let limit = h - 12;
    for (const o of objects) {
      if (selected.has(o.index)) continue;
      const b = topBounds(o, h);
      if (b[2] <= x0 + 1 || b[0] >= x1 - 1) continue;
      if (b[1] >= h - lastBase + m.size * 0.18)
        limit = Math.min(limit, b[1] + m.size * 0.55);
    }
    bottom = Math.max(bottom, Math.min(limit, top + m.frame.height + m.size));
    m.frame.height = Math.max(10, Math.min(limit - top, bottom - top));
    sourceStyles(m, objects);
    m.originalBaseline = h - firstBase;
    return { id: "page-paragraph-" + i, model: m, original, reason };
  });
  for (const cell of cellList) {
    const src = cellObjects.get(cell.id) || [];
    if (
      src.length === 0 &&
      objects.some(
        (o) => o.type === "text" && intersects(topBounds(o, h), cell.bounds, 1),
      )
    )
      continue;
    const parts = paragraphCandidates(src, h);
    let m = parts.length
      ? mergeCandidates(parts, w, h)
      : {
          text: "",
          sources: [],
          pageWidth: w,
          pageHeight: h,
          size: 10,
          lineHeight: 1.2,
          paragraphGap: 0,
          columns: 1,
          gap: 0,
          align: "left",
          color: "#202020",
          font: "sans",
        };
    const [x, y, r, b] = cell.bounds,
      pad = 2;
    if (r - x < 14 || b - y < 14) continue;
    m.frame = {
      x: x + pad,
      y: y + pad,
      width: r - x - pad * 2,
      height: b - y - pad * 2,
    };
    m.lineHeight = 1.15;
    m.firstIndent = 0;
    m.engine = "story";
    m.schema = 3;
    if (src.length) {
      const left = Math.min(...src.map((o) => o.bounds[0])),
        right = Math.max(...src.map((o) => o.bounds[2]));
      const centerError = Math.abs((left + right) / 2 - (x + r) / 2);
      m.align =
        centerError < Math.max(2, (r - x) * 0.12)
          ? "center"
          : Math.abs(right - r) < 3 && left - x > 8
            ? "right"
            : "left";
      const firstBase = Math.max(...src.map((o) => o.matrix[5]));
      m.frame.y = Math.max(
        y + 1,
        Math.min(b - 11, h - firstBase - m.size * (m.lineHeight / 2 + 0.3)),
      );
      m.frame.height = b - m.frame.y - 1;
    }
    m.cell = { ...cell };
    const fill = src.find((o) => o.fill)?.fill;
    if (fill)
      m.color =
        "#" +
        fill
          .slice(0, 3)
          .map((v) => Math.round(v).toString(16).padStart(2, "0"))
          .join("");
    sourceStyles(m, objects);
    candidates.push({
      id: cell.id,
      model: m,
      original: { x, y, width: r - x, height: b - y },
      reason: "",
    });
  }
  return candidates.sort(
    (a, b) => a.original.y - b.original.y || a.original.x - b.original.x,
  );
}

// Vertical spatial buckets limit each obstacle query to nearby glyphs on dense pages.
export function flowConflicts(
  model,
  objects,
  edits,
  page,
  ownId,
  glyphs = null,
) {
  const ids = new Set(model.sources.map((s) => s.index)),
    conflicts = [];
  const ink = (glyphs || [])
    .filter((g) => g.w > 0.05)
    .map((g) => [g.x, g.y + g.h * 0.13, g.x + g.w, g.y + g.h * 0.87])
    .sort((a, b) => a[1] - b[1]);
  const bucketHeight = 24,
    buckets = new Map();
  for (const g of ink)
    for (
      let y = Math.floor(g[1] / bucketHeight);
      y <= Math.floor(g[3] / bucketHeight);
      y++
    ) {
      if (!buckets.has(y)) buckets.set(y, []);
      buckets.get(y).push(g);
    }
  const touches = (box) => {
    if (!glyphs) return intersects(frameBounds(model.frame), box, 1);
    for (
      let y = Math.floor(box[1] / bucketHeight);
      y <= Math.floor(box[3] / bucketHeight);
      y++
    )
      if ((buckets.get(y) || []).some((g) => intersects(g, box, 0.65)))
        return true;
    return false;
  };
  const removed = new Set(
    edits
      .filter((e) => e.page === page && e.type === "flow")
      .flatMap((e) => (e.sources || []).map((s) => s.index)),
  );
  for (const e of edits.filter((e) => e.page === page && e.id !== ownId)) {
    if (e.index != null && ids.has(e.index))
      conflicts.push({
        kind: "source",
        bounds: frameBounds(model.frame),
        message: "这段文字已有对象修改，请先撤销该对象修改",
      });
    if (e.type === "flow" && e.model) {
      // Frame overlap is harmless. Persisted ink geometry is the authoritative obstacle.
      const boxes = e.ink?.map((g) => [
        g.x,
        g.y + g.h * 0.13,
        g.x + g.w,
        g.y + g.h * 0.87,
      ]) || [frameBounds(e.model.frame)];
      const b = boxes.find(touches);
      if (b)
        conflicts.push({
          kind: "text",
          bounds: b,
          message: "文字与已编辑段落发生遮挡",
        });
    }
  }
  for (const o of objects) {
    if (ids.has(o.index) || removed.has(o.index)) continue;
    const box = topBounds(o, model.pageHeight);
    if (o.type === "text" && o.text?.trim() && touches(box))
      conflicts.push({
        kind: "text",
        bounds: box,
        message: "文字与邻近正文发生遮挡，可接续段落或调整字号",
      });
    if (["image", "form"].includes(o.type) && touches(box))
      conflicts.push({
        kind: "image",
        bounds: box,
        message: "文字进入图片或复合对象区域",
      });
    if (
      o.type === "path" &&
      Math.min(box[2] - box[0], box[3] - box[1]) < 3 &&
      touches([box[0] - 0.5, box[1] - 0.5, box[2] + 0.5, box[3] + 0.5])
    )
      conflicts.push({
        kind: "rule",
        bounds: box,
        message: "文字跨过表格边框或分隔线",
      });
  }
  return conflicts;
}
export function checkFlowConflicts(...args) {
  const c = flowConflicts(...args);
  if (c.length) throw Error(c[0].message);
}
export function growthLimit(model, objects, edits, page, ownId) {
  const f = model.frame;
  if (model.cell) return Math.max(f.height, model.cell.bounds[3] - 2 - f.y);
  const ids = new Set(model.sources.map((s) => s.index));
  const removed = new Set(
    edits
      .filter((e) => e.page === page && e.type === "flow")
      .flatMap((e) => (e.sources || []).map((s) => s.index)),
  );
  let bottom = model.pageHeight - 8;
  const consider = (b) => {
    if (
      b[0] < f.x + f.width - 1 &&
      b[2] > f.x + 1 &&
      b[1] >= f.y + f.height - 1
    )
      bottom = Math.min(bottom, b[1] + model.size * 0.08);
  };
  for (const o of objects)
    if (
      !ids.has(o.index) &&
      !removed.has(o.index) &&
      (["text", "image", "form"].includes(o.type) ||
        (o.type === "path" &&
          Math.min(o.bounds[2] - o.bounds[0], o.bounds[3] - o.bounds[1]) < 3))
    )
      consider(topBounds(o, model.pageHeight));
  for (const e of edits)
    if (e.page === page && e.id !== ownId && e.model) {
      if (e.ink?.length)
        e.ink.forEach((g) => consider([g.x, g.y, g.x + g.w, g.y + g.h]));
      else consider(frameBounds(e.model.frame));
    }
  return Math.max(f.height, Math.min(model.pageHeight - f.y, bottom - f.y));
}

export function hitOffset(glyphs, x, y) {
  if (!glyphs.length) return 0;
  const distance = (g) =>
    Math.max(g.x - x, 0, x - g.x - g.w) ** 2 +
    4 * Math.max(g.y - y, 0, y - g.y - g.h) ** 2;
  const g = glyphs.reduce((a, b) => (distance(b) < distance(a) ? b : a));
  return x > g.x + g.w / 2 ? g.end : g.start;
}

export function caretRect(glyphs, offset, model) {
  const next = glyphs.find((g) => g.start >= offset);
  const before = [...glyphs].reverse().find((g) => g.end <= offset);
  const glyph = next?.start === offset ? next : before;
  if (glyph) {
    // Ink bounds describe a dot's paint, not the line's insertion caret.
    // Use the local font size and baseline, preserving genuine small text.
    const size = glyph.size || model.runs?.find(
      (r) => r.start <= glyph.start && r.end > glyph.start,
    )?.size || model.size;
    const baseline = glyph.baseline ?? glyph.y + glyph.h;
    return {
      x: glyph === next ? glyph.x : glyph.x + glyph.w,
      y: baseline - size * 0.85,
      h: size,
      line: glyph.line,
    };
  }
  return {
    x: model.frame.x,
    y: model.frame.y,
    h: model.size * model.lineHeight,
    line: 0,
  };
}

export function horizontalLimit(model, objects, edits, page, ownId) {
  const f = model.frame,
    ids = new Set(model.sources.map((s) => s.index));
  let right = model.pageWidth - 8;
  const removed = new Set(
    edits
      .filter((e) => e.page === page && e.type === "flow")
      .flatMap((e) => (e.sources || []).map((s) => s.index)),
  );
  const consider = (b) => {
    if (
      b[1] < f.y + f.height - 1 &&
      b[3] > f.y + 1 &&
      b[0] >= f.x + f.width - 1
    )
      right = Math.min(right, b[0] - 2);
  };
  for (const o of objects)
    if (!ids.has(o.index) && !removed.has(o.index))
      consider(topBounds(o, model.pageHeight));
  for (const e of edits)
    if (e.page === page && e.id !== ownId && e.model)
      consider(frameBounds(e.model.frame));
  return Math.max(f.width, right - f.x);
}
export function suggestGrowth(model, objects, regions, edits, page, id) {
  if (model.cell)
    return { direction: "down", reason: "单元格沿列宽换行，增加整行高度" };
  if (model.columns > 1)
    return { direction: "down", reason: "保留既有多栏宽度" };
  if (model.align === "right" || model.align === "center")
    return {
      direction: "fixed",
      reason: "保留原有居中或右对齐锚点，可手动选择扩展",
    };
  const f = model.frame,
    region = regions.find(
      (r) =>
        /title|heading/i.test(r.kind) && intersects(frameBounds(f), r.bounds),
    );
  const oneLine =
    !model.text.includes("\n") &&
    f.height < model.size * model.lineHeight * 2.1;
  const space = horizontalLimit(model, objects, edits, page, id) - f.width;
  if (
    oneLine &&
    space > model.size * 3 &&
    (region || model.text.length < 55) &&
    !/^\s*[\d.,%+-]+\s*$/.test(model.text)
  )
    return {
      direction: "right",
      reason: region
        ? "本地版式识别为标题，右侧留白充足"
        : "单行短文本，右侧留白充足",
    };
  return { direction: "down", reason: "保留当前段落宽度与阅读栏" };
}

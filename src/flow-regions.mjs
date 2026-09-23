// Direction-aware local connectivity. Sorting O(n log n), bounded active rows /
// paragraphs; never compare every object pair. Distances are in page points.
const heading =
  /^(?:第[〇零一二三四五六七八九十百千万\d]+[章节篇部分]|[（(]?[一二三四五六七八九十百\d]+[）)、.．](?![0-9]))/u;
const item = /^[\s]*[□☐☑✓√·•▪●]/u;
export function textDirection(o) {
  const m = o.matrix || [1, 0, 0, 1, 0, 0],
    gs = (o.glyphs || []).filter((g) => g.text?.trim());
  const dx = gs.length > 1 ? gs.at(-1).originX - gs[0].originX : 0;
  const dy = gs.length > 1 ? gs.at(-1).baseline - gs[0].baseline : 0;
  const angle = (Math.atan2(-m[1], m[0]) * 180) / Math.PI;
  const rotation = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  const rtl = /[\u0590-\u08ff]/u.test(o.text || "");
  const vertical =
    o.writingMode === "vertical-rl" ||
    (gs.length > 1 && Math.abs(dy) > Math.abs(dx) * 3 && Math.abs(angle) < 8);
  return {
    writingMode: vertical ? "vertical-rl" : "horizontal-tb",
    direction: rtl ? "rtl" : "ltr",
    rotation: vertical ? 0 : rotation,
    supported:
      !rtl && (vertical || Math.abs(angle - Math.round(angle / 90) * 90) < 3),
  };
}
function project(o, h, d) {
  const [l, b, r, t] = o.bounds,
    corners = [
      [l, h - t],
      [r, h - t],
      [l, h - b],
      [r, h - b],
    ];
  // u advances within a line; v advances between lines.
  const a = (d.rotation * Math.PI) / 180,
    ux = d.writingMode === "vertical-rl" ? 0 : Math.cos(a),
    uy = d.writingMode === "vertical-rl" ? 1 : Math.sin(a);
  const vx = -uy,
    vy = ux,
    us = corners.map(([x, y]) => x * ux + y * uy),
    vs = corners.map(([x, y]) => x * vx + y * vy);
  return {
    o,
    u: Math.min(...us),
    end: Math.max(...us),
    v: Math.min(...vs),
    bottom: Math.max(...vs),
    base:
      d.writingMode === "vertical-rl"
        ? -o.matrix[4]
        : o.matrix[4] * vx + (h - o.matrix[5]) * vy,
  };
}
// A style change creates another PDF text object, not another line or column.
export function visualRows(items, d, gapEm = 2.1) {
  // Floating point text matrices on one baseline may differ by 1e-4 pt.
  // Cluster before horizontal ordering; otherwise a suffix is visited first.
  const bands = [];
  for (const item of [...items].sort((a, b) => a.base - b.base)) {
    let band = bands.at(-1);
    if (!band || item.base - band.base > 0.2) {
      band = { base: item.base, items: [] };
      bands.push(band);
    }
    band.items.push(item);
  }
  items = bands.flatMap((b) =>
    b.items.sort((a, b) => a.u - b.u || a.o.index - b.o.index),
  );
  const rows = [];
  for (const p of items) {
    const size = p.o.size;
    let row = rows
      .slice(-32)
      .find(
        (r) =>
          Math.abs(r.base - p.base) <= Math.max(1, size * 0.22) &&
          p.u >= r.end - size * 0.3 &&
          p.u - r.end <= Math.max(3, size * gapEm),
      );
    if (!row) {
      row = { base: p.base, u: p.u, end: p.end, size, parts: [], d };
      rows.push(row);
    }
    row.parts.push(p);
    row.end = Math.max(row.end, p.end);
    row.size = Math.max(row.size, size);
  }
  return rows.sort((a, b) => a.base - b.base || a.u - b.u);
}
// Before gutters are known, a two-em join can bridge a newspaper column.
// Use sub-em continuity for evidence; paragraph assembly uses established lanes.
export function horizontalRows(objects, h) {
  const d = {
    writingMode: "horizontal-tb",
    direction: "ltr",
    rotation: 0,
    supported: true,
  };
  return visualRows(
    objects
      .filter(
        (o) =>
          o.type === "text" &&
          o.flowEditable &&
          o.text?.trim() &&
          o.size > 0 &&
          textDirection(o).rotation === 0 &&
          textDirection(o).writingMode === "horizontal-tb",
      )
      .map((o) => project(o, h, d)),
    d,
    0.9,
  );
}
export function connectedParagraphs(objects, h, barriers = objects) {
  const buckets = new Map();
  for (const o of objects) {
    if (
      o.type !== "text" ||
      !o.flowEditable ||
      !o.text?.trim() ||
      !o.bounds?.every(Number.isFinite) ||
      !o.matrix?.every(Number.isFinite) ||
      !(o.size > 0)
    )
      continue;
    const d = textDirection(o),
      key = JSON.stringify(d);
    if (!buckets.has(key)) buckets.set(key, { d, items: [] });
    buckets.get(key).items.push(project(o, h, d));
  }
  const rules = barriers
    .filter(
      (o) =>
        o.type === "path" &&
        o.bounds?.every(Number.isFinite) &&
        o.bounds[3] - o.bounds[1] < 2,
    )
    .map((o) => ({ ...o, y: h - o.bounds[3] }))
    .sort((a, b) => a.y - b.y);
  const barrier = (last, row, s, d) => {
    if (d.rotation || d.writingMode !== "horizontal-tb") return false;
    let lo = 0,
      hi = rules.length;
    while (lo < hi) {
      let mid = (lo + hi) >> 1;
      if (rules[mid].y <= last.base) lo = mid + 1;
      else hi = mid;
    }
    for (
      let i = lo;
      i < Math.min(rules.length, lo + 64) && rules[i].y < row.base;
      i++
    ) {
      const b = rules[i].bounds;
      if (b[2] - b[0] > s * 2 && b[0] < row.end && b[2] > row.u) return true;
    }
    return false;
  };
  const output = [];
  for (const { d, items } of buckets.values()) {
    const rows = visualRows(items, d);
    const paragraphs = [];
    for (const row of rows) {
      row.parts.sort((a, b) => a.u - b.u || a.o.index - b.o.index);
      row.text = row.parts
        .map((p) => p.o.text)
        .join("")
        .trim();
      const letters = row.parts.reduce((n, p) => n + p.o.text.trim().length, 0);
      row.code =
        row.parts.reduce(
          (n, p) =>
            n +
            (/Mono|Courier|Consolas|CMTT/i.test(p.o.fontName || "")
              ? p.o.text.trim().length
              : 0),
          0,
        ) >
        letters * 0.8;
      row.heavy =
        row.parts.reduce(
          (n, p) => n + (p.o.bold ? p.o.text.trim().length : 0),
          0,
        ) >
        letters * 0.8;
      let parent = null;
      if (!item.test(row.text) && !heading.test(row.text) && d.supported) {
        for (const p of paragraphs.slice(-32).reverse()) {
          const last = p.rows.at(-1),
            gap = row.base - last.base,
            s = Math.max(row.size, last.size);
          if (
            gap <= s * 0.65 ||
            gap > s * 2.3 ||
            Math.abs(row.size - last.size) > s * 0.25
          )
            continue;
          if (item.test(last.text) || heading.test(last.text)) continue;
          if (row.code !== last.code || row.heavy !== last.heavy) continue;
          if (
            !row.code &&
            (/[:：]$/.test(last.text) ||
              (row.heavy && last.text.length < 32 && row.text.length < 32))
          )
            continue;
          // A short preceding line is a boundary, not a bridge to a wider block.
          if (
            !row.code &&
            last.end - last.u < Math.min(6 * s, (row.end - row.u) * 0.65)
          )
            continue;
          if (Math.abs(p.u - row.u) > s * 2.2 || last.end < p.end - s * 2)
            continue;
          if (p.gap && Math.abs(gap - p.gap) > s * 0.45) continue;
          if (barrier(last, row, s, d)) continue;
          parent = p;
          break;
        }
      }
      if (!parent) {
        parent = { rows: [], u: row.u, end: row.end, gap: 0 };
        paragraphs.push(parent);
      }
      if (parent.rows.length) parent.gap = row.base - parent.rows.at(-1).base;
      parent.rows.push(row);
      parent.u = Math.min(parent.u, row.u);
      parent.end = Math.max(parent.end, row.end);
    }
    for (const p of paragraphs) {
      const src = p.rows.flatMap((r) => r.parts.map((p) => p.o));
      let text = "",
        lineStarts = [];
      for (const row of p.rows) {
        if (text) text += "\n";
        lineStarts.push(text.length);
        row.parts.forEach((p, i) => {
          const prev = row.parts[i - 1];
          if (
            prev &&
            !(prev.o.textSpacingExplicit && p.o.textSpacingExplicit &&
              p.o.index === prev.o.index + 1) &&
            p.u - prev.end > p.o.size * 0.2 &&
            /[A-Za-z0-9]$/.test(text) &&
            /^[A-Za-z0-9]/.test(p.o.text)
          )
            text += " ";
          text += p.o.text.replace(/[\r\n]+/g, "");
        });
      }
      const bounds = src.reduce(
        (b, o) => [
          Math.min(b[0], o.bounds[0]),
          Math.min(b[1], o.bounds[1]),
          Math.max(b[2], o.bounds[2]),
          Math.max(b[3], o.bounds[3]),
        ],
        [Infinity, Infinity, -Infinity, -Infinity],
      );
      output.push({
        id: "paragraph-" + output.length,
        text,
        lineStarts,
        hardLineBreaks: p.rows.every((r) => r.code),
        ...d,
        sources: src.map((o) => ({ index: o.index, signature: o.signature })),
        bounds,
        size: src[0].size,
        frame: {
          x: bounds[0],
          y: h - bounds[3],
          width: Math.max(10, bounds[2] - bounds[0] + 1),
          height: Math.max(10, bounds[3] - bounds[1] + src[0].size * 0.5),
        },
      });
    }
  }
  return output.sort((a, b) =>
    a.writingMode === "vertical-rl" && b.writingMode === "vertical-rl"
      ? b.frame.x - a.frame.x || a.frame.y - b.frame.y
      : a.frame.y - b.frame.y || a.frame.x - b.frame.x,
  );
}

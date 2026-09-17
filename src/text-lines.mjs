import { groupRows, columnCuts, appendLine } from "./line-geometry.mjs";
import { ocrPage } from "./ocr-data.mjs";
import { normalizeTitle } from "./bookmark-tools.mjs";
// Geometry-aware extraction shared by generation and target calibration.
export async function extractLines(
  pdf,
  page,
  rotation,
  {
    ocr = [],
    source = "auto",
    right = "",
    left: leftBound = "",
    joinLines = false,
    visualRows = false,
    gapFactor = 2,
    lineMode = "auto",
    lineTolerance = 0.4,
  } = {},
) {
  const p = await pdf.getPage(page),
    vp = p.getViewport({ scale: 1, rotation });
  const blocks = ocrPage(ocr, page).filter((b) => !b.excluded && b.text);
  const useOCR = source === "ocr";
  let fragments = [];
  if (useOCR) {
    fragments = blocks.map((b) => {
      const q = b.quad.map((q) => vp.convertToViewportPoint(...q));
      return {
        text: b.text,
        left: Math.min(...q.map((q) => q[0])),
        top: Math.min(...q.map((q) => q[1])),
        right: Math.max(...q.map((q) => q[0])),
        bottom: Math.max(...q.map((q) => q[1])),
        source: "OCR",
      };
    });
  } else {
    const t = await p.getTextContent();
    fragments = t.items
      .filter((i) => i.str?.trim())
      .map((i) => {
        const tr = i.transform,
          h = Math.max(1, Math.hypot(tr[2], tr[3]) || i.height || 10);
        const len = Math.hypot(tr[0], tr[1]) || 1,
          dx = tr[0] / len,
          dy = tr[1] / len;
        const pts = [
          [0, 0],
          [i.width, 0],
          [i.width, h],
          [0, h],
        ].map(([x, y]) =>
          vp.convertToViewportPoint(
            tr[4] + dx * x - dy * y,
            tr[5] + dy * x + dx * y,
          ),
        );
        const origin = vp.convertToViewportPoint(tr[4], tr[5]),
          next = vp.convertToViewportPoint(tr[4] + dx, tr[5] + dy);
        return {
          text: i.str,
          left: Math.min(...pts.map((p) => p[0])),
          right: Math.max(...pts.map((p) => p[0])),
          top: Math.min(...pts.map((p) => p[1])),
          bottom: Math.max(...pts.map((p) => p[1])),
          baseline: origin[1],
          angle: Math.round(
            (Math.atan2(next[1] - origin[1], next[0] - origin[0]) * 180) /
              Math.PI,
          ),
          source: "PDF",
        };
      });
  }
  if (source === "auto" && blocks.length) {
    const of = blocks.map((b) => {
      const q = b.quad.map((q) => vp.convertToViewportPoint(...q));
      return {
        text: b.text,
        left: Math.min(...q.map((q) => q[0])),
        top: Math.min(...q.map((q) => q[1])),
        right: Math.max(...q.map((q) => q[0])),
        bottom: Math.max(...q.map((q) => q[1])),
        source: "OCR",
      };
    });
    fragments = fragments
      .filter(
        (f) =>
          !of.some((o) => {
            const overlap =
              Math.max(
                0,
                Math.min(f.right, o.right) - Math.max(f.left, o.left),
              ) *
              Math.max(
                0,
                Math.min(f.bottom, o.bottom) - Math.max(f.top, o.top),
              );
            return (
              overlap / Math.max(1, (f.right - f.left) * (f.bottom - f.top)) >
              0.5
            );
          }),
      )
      .concat(of);
  }
  fragments = fragments
    .filter(
      (f) =>
        (right === "" || f.left <= +right) &&
        (leftBound === "" || f.right >= +leftBound),
    )
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const unique = [],
    seen = new Map();
  for (const f of fragments) {
    const key = normalizeTitle(f.text),
      bucket = seen.get(key) || [];
    if (
      bucket.some(
        (u) => Math.abs(u.left - f.left) < 2 && Math.abs(u.top - f.top) < 2,
      )
    )
      continue;
    bucket.push(f);
    seen.set(key, bucket);
    unique.push(f);
  }
  const rows = groupRows(unique, { mode: lineMode, tolerance: lineTolerance });
  const cuts = columnCuts(unique, vp.width);
  const lines = [];
  const emit = (group) => {
    const f = group[0],
      x = f.left,
      y = Math.min(...group.map((f) => f.top)),
      q = vp.convertToPdfPoint(x, y),
      up = vp.convertToPdfPoint(x, y - 1);
    let text = "";
    const segments = [];
    for (let i = 0; i < group.length; i++) {
      const fragment = group[i],
        prev = group[i - 1],
        gap = prev ? fragment.left - prev.right : 0;
      const threshold = Math.max(
        24,
        (fragment.bottom - fragment.top) *
          Math.max(0.5, Number(gapFactor) || 2),
      );
      const sep =
        !i || /\s$/u.test(text) || /^\s/u.test(fragment.text)
          ? ""
          : gap > threshold
            ? "  "
            : gap > Math.max(1, (fragment.bottom - fragment.top) * 0.18)
              ? " "
              : "";
      text += sep;
      segments.push({
        ...fragment,
        start: text.length,
        end: text.length + fragment.text.length,
        point: vp.convertToPdfPoint(fragment.left, fragment.top),
      });
      text += fragment.text;
    }
    lines.push({
      page,
      text,
      segments,
      x: q[0],
      y: q[1],
      upX: up[0] - q[0],
      upY: up[1] - q[1],
      left: x,
      right: Math.max(...group.map((f) => f.right)),
      top: y,
      bottom: Math.max(...group.map((f) => f.bottom)),
      height: vp.height,
      source: f.source,
    });
  };
  for (const row of rows) {
    row.sort((a, b) => a.left - b.left);
    let group = [];
    for (const f of row) {
      const prev = group.at(-1);
      if (
        !visualRows &&
        prev &&
        (f.left - prev.right > Math.max(24, (f.bottom - f.top) * 2) ||
          cuts.some((c) => prev.right < c && f.left > c))
      ) {
        emit(group);
        group = [];
      }
      group.push(f);
    }
    if (group.length) emit(group);
  }
  lines.sort((a, b) => a.top - b.top || a.left - b.left);
  // Split two clearly separated columns, read each from top to bottom.
  const middle = vp.width / 2,
    left = lines.filter((l) => l.right < middle + 8),
    rightCol = lines.filter((l) => l.left > middle - 8);
  if (!visualRows && left.length >= 3 && rightCol.length >= 3) {
    const wide = lines.filter(
      (l) => !left.includes(l) && !rightCol.includes(l),
    );
    const ordered = [];
    let pending = [...lines];
    for (const band of [...wide, { top: Infinity }]) {
      const part = pending.filter((l) => l !== band && l.top < band.top);
      ordered.push(
        ...part.filter((l) => l.left < middle),
        ...part.filter((l) => l.left >= middle),
      );
      if (band.top !== Infinity) ordered.push(band);
      pending = pending.filter((l) => l.top > band.top);
    }
    lines.splice(0, lines.length, ...ordered);
  }
  if (joinLines) {
    const merged = [];
    for (let i = 0; i < lines.length; i++) {
      const l = { ...lines[i] };
      let j = i;
      while (j + 1 < lines.length && j - i < 2) {
        const n = lines[j + 1],
          h = l.bottom - l.top;
        if (
          Math.abs(n.left - l.left) > 12 ||
          n.top - l.bottom > Math.max(8, h * 0.7) ||
          n.top < l.top
        )
          break;
        Object.assign(l, appendLine(l, n));
        j++;
      }
      merged.push(l);
      i = j;
    }
    return merged;
  }
  return lines;
}

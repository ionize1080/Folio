import { caretRect, hitOffset } from "./flow-page-model.mjs";

// The textarea has no visual wrapping. Navigate the rendered PDF lines instead,
// including empty lines, while retaining the preferred X across short lines.
export function visualCaretMove({
  glyphs,
  anchors = [],
  model,
  start,
  end,
  direction = "forward",
  key,
  shift = false,
  preferredX = null,
}) {
  const offset = direction === "backward" ? start : end;
  const caret = anchors[offset] || caretRect(glyphs, offset, model);
  const lines = new Map();
  for (const g of glyphs) {
    if (!lines.has(g.line)) lines.set(g.line, { glyphs: [], offsets: [] });
    lines.get(g.line).glyphs.push(g);
  }
  // Native Story marks empty paragraphs with line -1; browser anchors may not
  // carry a line id. Resolve these by geometry, not by a shared sentinel id.
  lines.delete(-1);
  const anchorRows = new Map();
  const glyphAt = new Map(glyphs.map((g) => [g.start, g]));
  for (const [at, a] of Object.entries(anchors)) {
    if (!a) continue;
    const g = glyphAt.get(Number(at));
    let row = g
      ? lines.get(g.line)
      : [...lines.values()].find((r) =>
          r.glyphs.some(
            (g) =>
              Math.abs((g.baseline ?? g.y + g.h) - (a.y + a.h * 0.85)) <
              Math.max(1, a.h * 0.25),
          ),
        );
    if (!row) {
      const key = "blank:" + a.y;
      if (!lines.has(key)) lines.set(key, { glyphs: [], offsets: [], y: a.y });
      row = lines.get(key);
    }
    row.offsets.push(Number(at));
    anchorRows.set(Number(at), row);
  }
  const current = anchorRows.get(offset) || lines.get(caret.line);
  let next = offset;
  if (key === "Home" || key === "End") {
    const offsets = current?.glyphs.length
      ? current.glyphs.flatMap((g) => [g.start, g.end])
      : current?.offsets || [offset];
    next = key === "Home" ? Math.min(...offsets) : Math.max(...offsets);
    // A hard newline belongs to the line before it, never select past it.
    if (key === "End" && next > 0 && model.text[next - 1] === "\n") next--;
    preferredX = null;
  } else {
    preferredX ??= caret.x;
    const order = [...lines.values()].sort(
      (a, b) => (a.y ?? a.glyphs[0]?.y ?? 0) - (b.y ?? b.glyphs[0]?.y ?? 0),
    );
    const row = order[order.indexOf(current) + (key === "ArrowDown" ? 1 : -1)];
    if (row) {
      const ink = row.glyphs.filter(
        (g) => g.w > 0.05 && model.text.slice(g.start, g.end) !== "\n",
      );
      next = ink.length
        ? hitOffset(ink, preferredX, ink[0].y + ink[0].h / 2)
        : Math.min(...row.offsets, ...row.glyphs.map((g) => g.start));
    } else next = key === "ArrowDown" ? model.text.length : 0;
  }
  next = Math.max(0, Math.min(model.text.length, next));
  const anchor = shift ? (direction === "backward" ? end : start) : next;
  return {
    start: Math.min(anchor, next),
    end: Math.max(anchor, next),
    direction: next < anchor ? "backward" : "forward",
    preferredX,
  };
}

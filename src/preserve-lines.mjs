// Keep untouched physical lines when a local edit fits its original line.
// Added/deleted hard breaks, changed formatting or insufficient space use the
// normal paragraph layout; never force characters into overlapping slots.
export function preserveLine(model, glyphs, anchors) {
  const original = model.originalLayout,
    old = original?.text,
    text = model.text;
  if (
    !original ||
    old === text ||
    model.layoutMode === "reflow" ||
    model.rotation ||
    model.writingMode?.startsWith("vertical") ||
    model.align !== "left"
  )
    return false;
  const geometry = [
    "size",
    "align",
    "lineHeight",
    "charSpacing",
    "wordSpacing",
    "firstIndent",
    "paragraphBefore",
    "paragraphGap",
  ];
  if (
    !geometry.every((k) => model[k] === original.settings?.[k]) ||
    !["x", "y", "width", "height"].every(
      (k) => Math.abs(model.frame[k] - original.frame[k]) < 0.01,
    )
  )
    return false;
  const source = original.glyphs;
  if (source.map((g) => g.text).join("") !== old) return false;
  let a = 0,
    b = 0;
  while (a < old.length && a < text.length && old[a] === text[a]) a++;
  while (
    b < old.length - a &&
    b < text.length - a &&
    old.at(-1 - b) === text.at(-1 - b)
  )
    b++;
  if (
    /[\r\n\t]/.test(
      old.slice(a, old.length - b) + text.slice(a, text.length - b),
    )
  )
    return false;
  const first = source.findIndex((g) => g.end > a);
  const start = first < 0 ? source.length - 1 : first;
  const last = source.findIndex(
    (g) => g.end >= Math.max(a + 1, old.length - b),
  );
  const end = last < 0 ? source.length - 1 : last;
  if (
    !source[start] ||
    Math.abs(source[start].baseline - source[end].baseline) > 0.5
  )
    return false;
  let lo = start,
    hi = end;
  while (
    lo > 0 &&
    source[lo - 1].text !== "\n" &&
    Math.abs(source[lo - 1].baseline - source[start].baseline) < 0.5
  )
    lo--;
  while (
    hi + 1 < source.length &&
    source[hi].text !== "\n" &&
    Math.abs(source[hi + 1].baseline - source[start].baseline) < 0.5
  )
    hi++;
  const from = source[lo].start,
    oldEnd = source[hi].end,
    delta = text.length - old.length,
    to = oldEnd + delta;
  const byOffset = new Map(source.map((g) => [g.start, g]));
  const sameStyle = (g, s) =>
    (g.sourceFontKey || g.fontKey) === s.style?.fontKey &&
    g.size === s.style?.size &&
    Math.abs(g.scale - (s.style?.horizontalScale ?? 100) / 100) < 0.001;
  const placements = [];
  let x = source[lo].originX;
  const right = Math.max(
    model.frame.x + model.frame.width,
    ...source.slice(lo, hi + 1).map((g) => g.x + g.w),
  );
  for (const g of glyphs) {
    const oldAt =
      g.start < a
        ? g.start
        : g.start >= text.length - b
          ? g.start - delta
          : null;
    const before = oldAt == null ? null : byOffset.get(oldAt);
    if (before && (!sameStyle(g, before) || before.text !== g.text))
      return false;
    if (g.start < from || g.start >= to) {
      if (!before) return false;
      placements.push({
        g,
        x: before.originX,
        y: before.baseline,
        source: before,
      });
    } else {
      const ox = g.start < a && before ? before.originX : x;
      if (g.text !== "\n" && ox + (g.x - g.originX) + g.w > right + 0.25)
        return false;
      placements.push({ g, x: ox, y: source[lo].baseline, source: before });
      const next = before && byOffset.get(before.end);
      x =
        ox +
        (next && Math.abs(next.baseline - before.baseline) < 0.5
          ? Math.max(0, next.originX - before.originX)
          : g.advance);
    }
  }
  for (const { g, x, y, source: s } of placements) {
    const ink = s || g,
      dx = x - ink.originX,
      dy = y - ink.baseline;
    Object.assign(g, {
      x: ink.x + dx,
      y: ink.y + dy,
      w: ink.w,
      h: ink.h,
      originX: x,
      baseline: y,
      line: y,
    });
    anchors[g.start] = {
      x,
      y: y - g.size * 0.85,
      h: g.size,
      w: 1,
      vertical: false,
    };
  }
  const lastGlyph = glyphs.at(-1);
  if (lastGlyph)
    anchors[text.length] = {
      x: lastGlyph.originX + lastGlyph.advance,
      y: lastGlyph.baseline - lastGlyph.size * 0.85,
      h: lastGlyph.size,
      w: 1,
      vertical: false,
    };
  return true;
}

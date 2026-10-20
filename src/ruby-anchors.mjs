// Separate pronunciation labels must remain over their original Han character.
// Keep these geometric limits in sync with native/ruby_anchors.py.
const han = /[\u3400-\u9fff\u{20000}-\u{3134f}]/u;
const latin = /^[A-Za-z\u00c0-\u024f\u0300-\u036f\u02c7\u02c9-\u02cb\s]+$/u;
export function rubyAnchors(objects, ids, height) {
  const bases = objects
    .filter((o) => ids.has(o.index))
    .flatMap((o) =>
      (o.glyphs || []).map((g) => ({
        ...g,
        em:
          (o.size || 0) * Math.hypot(o.matrix?.[2] || 0, o.matrix?.[3] ?? 1) ||
          Math.max(g.w, g.h),
      })),
    )
    .filter((g) => han.test(g.text || "") && g.w >= 2 && g.em >= 7);
  const anchors = [];
  for (const o of objects) {
    const text = o.text?.trim();
    if (
      o.type !== "text" ||
      ids.has(o.index) ||
      !text ||
      text.length > 12 ||
      !latin.test(text)
    )
      continue;
    const [x0, bottom, x1, top] = o.bounds,
      y0 = height - top,
      y1 = height - bottom;
    const width = x1 - x0,
      h = y1 - y0,
      center = (x0 + x1) / 2;
    if (h < 2.5 || width <= 0) continue;
    const matches = bases.filter(
      (g) =>
        h <= g.em * 0.85 &&
        width <= g.em * 2.5 &&
        y1 <= g.y + 0.5 &&
        y1 >= g.y - g.em * 0.8 &&
        Math.abs(center - (g.x + g.w / 2)) <= g.em * 0.6,
    );
    matches.sort(
      (a, b) =>
        Math.abs(center - a.x - a.w / 2) - Math.abs(center - b.x - b.w / 2),
    );
    if (matches.length)
      anchors.push({
        annotation: o.index,
        bounds: [x0, y0, x1, y1],
        glyph: matches[0],
      });
  }
  return anchors;
}

export function rubyConflicts(model, objects, glyphs) {
  if (!glyphs) return [];
  const ids = new Set(model.sources.map((s) => s.index));
  return rubyAnchors(objects, ids, model.pageHeight)
    .filter(
      ({ glyph: old }) =>
        !glyphs.some(
          (g) =>
            (g.text ?? model.text.slice(g.start, g.end)) === old.text &&
            Math.abs(g.originX - old.originX) <= 0.75 &&
            Math.abs(g.baseline - old.baseline) <= 0.75,
        ),
    )
    .map((a) => ({
      kind: "annotation",
      bounds: a.bounds,
      message: `“${a.glyph.text}”上方有独立注音，本次排版会使注音错位；请保留该字原位，草稿已保留`,
    }));
}

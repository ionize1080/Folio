// Conservative whitespace cuts: full columns first, then separated sections.
// Ambiguous overlapping layouts retain top-to-bottom ordering for review.
function readingOrder(blocks) {
  const pages = new Map();
  for (const b of blocks) {
    const q = b.quad,
      xs = q.map((p) => p[0]),
      ys = q.map((p) => -p[1]);
    const item = {
      b,
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
    };
    if (!pages.has(b.page)) pages.set(b.page, []);
    pages.get(b.page).push(item);
  }
  function cut(items, depth = 0) {
    if (items.length < 2 || depth > 32) return items;
    const heights = items.map((i) => i.y1 - i.y0).sort((a, b) => a - b),
      em = Math.max(2, heights[Math.floor(heights.length / 2)]);
    for (const [lo, hi, threshold] of [
      ["x0", "x1", em * 1.5],
      ["y0", "y1", em * 0.85],
    ]) {
      const sorted = [...items].sort((a, b) => a[lo] - b[lo]);
      let end = sorted[0][hi],
        best = 0,
        at = 0;
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i][lo] - end;
        if (gap > threshold && gap > best) {
          best = gap;
          at = i;
        }
        end = Math.max(end, sorted[i][hi]);
      }
      if (at)
        return [
          ...cut(sorted.slice(0, at), depth + 1),
          ...cut(sorted.slice(at), depth + 1),
        ];
    }
    return [...items].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  }
  return [...pages]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, items]) => cut(items).map((i) => i.b));
}
module.exports = { readingOrder };

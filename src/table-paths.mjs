// Only proven cell-grid geometry is replaced. Decorations, checkmarks and
// arrows retain their original operators, even when color and width match.
export function isTableGridPath(o, table, pageHeight) {
  if (o.type !== "path" || !o.segments?.length) return false;
  const xs = [
    ...new Set(table.cells.flatMap((c) => [c.bounds[0], c.bounds[2]])),
  ];
  const ys = [
    ...new Set(table.cells.flatMap((c) => [c.bounds[1], c.bounds[3]])),
  ];
  const near = (a, b) => Math.abs(a - b) < 0.5;
  const on = (v, grid) => grid.some((n) => near(v, n));
  const [a, b, c, d, e, f] = o.matrix;
  const point = (s) => [
    a * s.x + c * s.y + e,
    pageHeight - (b * s.x + d * s.y + f),
  ];
  let start,
    prev,
    count = 0;
  const line = (p, q) => {
    count++;
    return (
      (near(p[0], q[0]) && on(p[0], xs) && on(p[1], ys) && on(q[1], ys)) ||
      (near(p[1], q[1]) && on(p[1], ys) && on(p[0], xs) && on(q[0], xs))
    );
  };
  for (const s of o.segments) {
    const p = point(s);
    if (s.type === 2) start = p;
    else if (s.type !== 0 || !prev || !line(prev, p)) return false;
    if (s.close && (!start || !line(p, start))) return false;
    prev = p;
  }
  return count > 0;
}

export function hasTableGridSegment(o, table, pageHeight) {
  if (o.type !== "path") return false;
  let start, prev;
  const matches = (a, b) =>
    a &&
    b &&
    isTableGridPath(
      {
        ...o,
        segments: [
          { ...a, type: 2, close: false },
          { ...b, type: 0, close: false },
        ],
      },
      table,
      pageHeight,
    );
  for (const s of o.segments || []) {
    if (s.type === 2) start = s;
    else if (s.type === 0 && matches(prev, s)) return true;
    if (s.close && matches(s, start)) return true;
    prev = s;
  }
  return false;
}

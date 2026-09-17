// Content-independent geometry: do not infer titles or hierarchy from words.
const mid = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)] || 0;
const h = (f) => Math.max(1, f.bottom - f.top);
const y = (f) => f.baseline ?? f.bottom;
const overlap = (a, b) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) /
  Math.max(1, Math.min(a.right - a.left, b.right - b.left));
export function columnCuts(fragments, width) {
  const lanes = [];
  for (const f of fragments.filter(
    (f) => f.right - f.left > width * 0.14 && f.right - f.left < width * 0.48,
  )) {
    let l = lanes.find((l) => Math.abs(l.x - f.left) < h(f) * 1.5);
    if (!l) lanes.push((l = { x: f.left, left: [], right: [] }));
    l.left.push(f.left);
    l.right.push(f.right);
  }
  const strong = lanes
    .filter((l) => l.left.length >= 3)
    .sort((a, b) => a.x - b.x);
  return strong.slice(1).flatMap((l, i) => {
    const r = mid(strong[i].right),
      left = mid(l.left);
    return left > r + 3 ? [(r + left) / 2] : [];
  });
}
export function groupRows(fragments, { mode = "auto", tolerance = 0.4 } = {}) {
  const rows = [];
  for (let i = 0; i < fragments.length; i++) {
    const f = fragments[i],
      height = h(f),
      baseline = y(f);
    const nearby = [];
    for (let j = i - 1; j >= 0 && j >= i - 160; j--) {
      const b = fragments[j];
      if (f.top - b.top > height * 5) break;
      nearby.push(b);
    }
    for (let j = i + 1; j < fragments.length && j < i + 160; j++) {
      const b = fragments[j];
      if (b.top - f.top > height * 5) break;
      nearby.push(b);
    }
    const offsets = [],
      pitch = [];
    for (const b of nearby) {
      if (
        (b.angle || 0) !== (f.angle || 0) ||
        h(b) / height < 0.8 ||
        h(b) / height > 1.25
      )
        continue;
      const d = Math.abs(y(b) - baseline),
        hh = Math.min(height, h(b));
      if (overlap(b, f) > 0.5) {
        if (d > hh * 0.55 && d < hh * 2.5) pitch.push(d);
      } else {
        const gap = Math.max(b.left, f.left) - Math.min(b.right, f.right);
        if (gap >= 0 && gap < 8 * hh && d > 0.05 * hh && d < 0.45 * hh)
          offsets.push(d / hh);
      }
    }
    offsets.sort((a, b) => a - b);
    const factor =
      mode === "strict"
        ? 0.2
        : mode === "manual"
          ? Math.max(0.05, Math.min(1, Number(tolerance) || 0.4))
          : Math.min(
              mode === "relaxed" ? 0.55 : 0.45,
              Math.max(
                0.25,
                (offsets[Math.floor((offsets.length - 1) * 0.9)] || 0) + 0.04,
              ),
            );
    const limit = Math.min(
      height * factor,
      pitch.length ? Math.min(...pitch) * 0.45 : Infinity,
    );
    const candidates = rows
      .slice(-40)
      .filter((r) => {
        if ((r[0].angle || 0) !== (f.angle || 0)) return false;
        const base = mid(r.map(y));
        return (
          Math.abs(base - baseline) <= limit &&
          !r.some(
            (b) =>
              overlap(b, f) > 0.5 &&
              Math.abs(y(b) - baseline) > 0.2 * Math.min(height, h(b)),
          ) &&
          Math.max(...r.map(y), baseline) - Math.min(...r.map(y), baseline) <=
            limit * 1.5
        );
      })
      .sort(
        (a, b) =>
          Math.abs(mid(a.map(y)) - baseline) -
          Math.abs(mid(b.map(y)) - baseline),
      );
    if (candidates.length) candidates[0].push(f);
    else rows.push([f]);
  }
  return rows;
}
export function appendLine(a, b) {
  const shift = a.text.length + 1;
  return {
    ...a,
    text: a.text + " " + b.text,
    bottom: Math.max(a.bottom, b.bottom),
    right: Math.max(a.right, b.right),
    segments: [
      ...(a.segments || []),
      ...(b.segments || []).map((s) => ({
        ...s,
        start: s.start + shift,
        end: s.end + shift,
      })),
    ],
  };
}

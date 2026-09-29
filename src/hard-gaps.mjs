// Large positional gaps separate fixed spans, even inside one PDF TJ operator.
export function hardGapStarts(glyphs) {
  const starts = new Set();
  let previous;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    if (!g.text.trim()) continue;
    if (
      previous &&
      Math.abs(previous.baseline - g.baseline) < 0.5 &&
      g.originX - (previous.x + previous.w) >
        Math.max(12, (g.style?.size || g.size || 12) * 1.5)
    )
      starts.add(i);
    previous = g;
  }
  return starts;
}

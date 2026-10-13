// Preserve a verified source ligature while retaining every logical caret offset.
const pairs = [
  ["ffi", "\ufb03"],
  ["ffl", "\ufb04"],
  ["ff", "\ufb00"],
  ["fi", "\ufb01"],
  ["fl", "\ufb02"],
  ["st", "\ufb06"],
];
export const ligatureCoverage = new Set(
  pairs.map(([, scalar]) => scalar.codePointAt(0)),
);
const fields = [
  "fontKey",
  "size",
  "scale",
  "color",
  "rotation",
  "bold",
  "italic",
  "fontBold",
  "fontItalic",
  "strokeWidth",
];
export function sourceLigature(glyphs, index, coverage) {
  const first = glyphs[index];
  for (const [text, scalar] of pairs) {
    const group = glyphs.slice(index, index + text.length);
    if (
      group.length !== text.length ||
      group.map((g) => g.text).join("") !== text ||
      !coverage?.has(scalar.codePointAt(0))
    )
      continue;
    if (
      group.some(
        (g, i) =>
          g.synthetic ||
          fields.some((k) => g[k] !== first[k]) ||
          Math.abs(g.originX - first.originX) > 0.001 ||
          Math.abs(g.baseline - first.baseline) > 0.001 ||
          (i && group[i - 1].end !== g.start),
      )
    )
      continue;
    return { text: scalar, count: group.length };
  }
  return { text: first.text, count: 1 };
}

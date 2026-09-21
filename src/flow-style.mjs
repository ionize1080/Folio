// Keep UTF-16 style runs with the same text offsets used by the native input.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function sourceStyles(model, objects) {
  const sources = new Set(model.sources.map((s) => s.index));
  let cursor = 0;
  const runs = [],
    glyphs = [];
  const order = new Map(model.sources.map((s, i) => [s.index, i]));
  const src = objects
    .filter((o) => sources.has(o.index))
    .sort((a, b) => order.get(a.index) - order.get(b.index));
  for (const o of src) {
    const text = o.text.replace(/[\r\n]+/g, "");
    if (!text) continue;
    while (
      cursor < model.text.length &&
      /\s/.test(model.text[cursor]) &&
      !model.text.startsWith(text, cursor)
    )
      cursor++;
    const start = cursor;
    if (!model.text.startsWith(text, start)) {
      model.runs = [];
      delete model.fontKey;
      model.fontResolution = "unresolved";
      model.fontOriginalName = "对象样式映射不完整";
      delete model.originalLayout;
      model.styleMappingWarning = "原文对象顺序与文字不一致，请检查字体";
      return model;
    }
    const fill = o.fill || [32, 32, 32];
    const style = {
      fontKey: o.fontKey || null,
      fontName: o.fontName || "内置替代字体",
      fontOriginalName: o.fontOriginalName || o.fontName,
      fontResolution:
        o.fontResolution || (o.fontKey ? "embedded" : "unresolved"),
      fontFallback: o.fontFallback || "",
      size: o.size,
      bold: !!o.bold || o.renderMode === 2,
      italic: !!o.italic,
      syntheticBold: o.renderMode === 2,
      syntheticItalic: !!o.syntheticItalic,
      strokeWidth: o.renderMode === 2 ? o.strokeWidth || 0 : 0,
      strokeColor: o.strokeColor,
      fontBold: !!o.fontBold,
      fontItalic: !!o.fontItalic,
      color:
        "#" +
        fill
          .slice(0, 3)
          .map((v) => Math.round(v).toString(16).padStart(2, "0"))
          .join(""),
      charSpacing: o.charSpacing || 0,
      wordSpacing: o.wordSpacing || 0,
      horizontalScale:
        ((o.horizontalScale || 100) * Math.hypot(o.matrix[0], o.matrix[1])) /
        Math.hypot(o.matrix[2], o.matrix[3]),
    };
    // PDFium may omit nonpainting spaces from its glyph list. Keep real
    // anchors and fill only missing whitespace below, rather than dropping
    // the whole object's geometry because a trailing space has no glyph.
    let objectOffset = 0;
    const captured = [];
    let aligned = true;
    for (const g of o.glyphs || []) {
      if (/[\r\n]/.test(g.text)) continue;
      while (
        objectOffset < text.length &&
        text[objectOffset] === " " &&
        g.text !== " "
      )
        objectOffset++;
      if (!text.startsWith(g.text, objectOffset)) {
        aligned = false;
        break;
      }
      captured.push({
        ...g,
        start: start + objectOffset,
        end: start + objectOffset + g.text.length,
        style: { ...style },
      });
      objectOffset += g.text.length;
    }
    if (aligned && !text.slice(objectOffset).trim()) glyphs.push(...captured);
    runs.push({ start, end: start + text.length, ...style });
    cursor = start + text.length;
  }
  model.runs = runs;
  const weights = new Map();
  for (const r of runs) {
    const key = JSON.stringify([
      r.fontKey,
      r.fontName,
      r.size,
      r.bold,
      r.italic,
    ]);
    const entry = weights.get(key) || { run: r, count: 0 };
    entry.count += r.end - r.start;
    weights.set(key, entry);
  }
  const main = [...weights.values()].sort((a, b) => b.count - a.count)[0]?.run;
  if (main) {
    model.fontKey = main.fontKey;
    model.fontName = main.fontName;
    model.fontResolution = main.fontResolution;
    model.fontOriginalName = main.fontOriginalName;
    model.charSpacing = main.charSpacing;
    model.wordSpacing = main.wordSpacing;
    model.bold = main.bold;
    model.italic = main.italic;
  }
  const byOffset = new Map(glyphs.map((g) => [g.start, g]));
  let glyphCursor = 0;
  let position = 0,
    prev = null;
  const complete = [];
  for (const ch of model.text) {
    while (glyphCursor < glyphs.length && glyphs[glyphCursor].start <= position)
      glyphCursor++;
    let g = byOffset.get(position);
    if (!g && (ch === " " || ch === "\n") && prev) {
      const next = glyphs[glyphCursor],
        x = prev.x + prev.w;
      g = {
        text: ch,
        start: position,
        end: position + 1,
        originX: x,
        baseline: prev.baseline,
        x,
        y: prev.y,
        w:
          next && Math.abs(next.baseline - prev.baseline) < 0.5
            ? Math.max(0, next.originX - x)
            : 0,
        h: prev.h,
        style: { ...prev.style },
        synthetic: true,
      };
    }
    if (g) complete.push(g);
    prev = g || prev;
    position += ch.length;
  }
  glyphs.splice(0, glyphs.length, ...complete);
  if (
    glyphs.length &&
    src.every(
      (o) =>
        [0, 2].includes(o.renderMode ?? 0) && (!o.fill || o.fill[3] === 255),
    ) &&
    glyphs.map((g) => g.text).join("") === model.text
  ) {
    model.layoutMode = "preserve";
    model.originalLayout = {
      text: model.text,
      glyphs,
      frame: { ...model.frame },
      settings: Object.fromEntries(
        [
          "size",
          "align",
          "lineHeight",
          "charSpacing",
          "wordSpacing",
          "bold",
          "italic",
          "syntheticBold",
          "syntheticItalic",
          "strokeWidth",
          "strokeColor",
          "fontBold",
          "fontItalic",
          "horizontalScale",
          "firstIndent",
          "paragraphBefore",
          "paragraphGap",
        ].map((k) => [k, model[k]]),
      ),
    };
  }
  return model;
}
export function editStyles(runs, oldText, newText, base = {}) {
  base = Object.fromEntries(
    [
      "fontKey",
      "fontName",
      "fontOriginalName",
      "fontResolution",
      "fontFallback",
      "size",
      "color",
      "charSpacing",
      "wordSpacing",
      "bold",
      "italic",
      "syntheticBold",
      "syntheticItalic",
      "strokeWidth",
      "strokeColor",
      "fontBold",
      "fontItalic",
      "horizontalScale",
      "latinFontKey",
      "latinFontName",
      "cjkFontKey",
      "cjkFontName",
    ].map((k) => [k, base[k]]),
  );
  let a = 0,
    b = 0;
  while (a < oldText.length && a < newText.length && oldText[a] === newText[a])
    a++;
  while (
    b < oldText.length - a &&
    b < newText.length - a &&
    oldText.at(-1 - b) === newText.at(-1 - b)
  )
    b++;
  // The native input uses UTF-16, but a style range must never bisect a
  // supplementary character when two emoji share their high/low surrogate.
  if (a > 0 && /[\uDC00-\uDFFF]/.test(oldText[a] || newText[a] || "")) a--;
  if (b > 0 && /[\uDC00-\uDFFF]/.test(oldText[oldText.length - b] || "")) b--;
  const oldEnd = oldText.length - b,
    newEnd = newText.length - b,
    delta = newEnd - oldEnd;
  const at = oldEnd > a ? a : Math.max(0, a - 1);
  const style = runs.find((r) => r.start <= at && r.end > at) || base;
  const out = [];
  for (const r of runs)
    if (r.start < a) out.push({ ...r, end: Math.min(a, r.end) });
  if (newEnd > a) out.push({ ...style, start: a, end: newEnd });
  for (const r of runs)
    if (r.end > oldEnd)
      out.push({
        ...r,
        start: Math.max(oldEnd, r.start) + delta,
        end: r.end + delta,
      });
  const merged = [];
  for (const r of out) {
    const { start, end, ...style } = r,
      last = merged.at(-1);
    if (last) {
      const { start: ls, end: le, ...prev } = last;
      if (le === start && same(prev, style)) {
        last.end = end;
        continue;
      }
    }
    if (end > start) merged.push(r);
  }
  return merged;
}

export function editSoftBreaks(breaks, oldText, newText) {
  let a = 0,
    b = 0;
  while (a < oldText.length && a < newText.length && oldText[a] === newText[a])
    a++;
  while (
    b < oldText.length - a &&
    b < newText.length - a &&
    oldText.at(-1 - b) === newText.at(-1 - b)
  )
    b++;
  const oldEnd = oldText.length - b,
    delta = newText.length - oldText.length;
  return (breaks || [])
    .filter((n) => n < a || n >= oldEnd)
    .map((n) => (n < a ? n : n + delta))
    .filter((n) => newText[n] === "\n");
}

// Apply only the explicit selection. A collapsed caret sets the typing style.
export function rangeStyle(model, start, end, patch) {
  if (patch.fontKey || patch.latinFontKey || patch.cjkFontKey)
    patch = { ...patch, fontResolution: "user-selected", fontFallback: "" };
  if (start === end) {
    model.typingStyle = { ...(model.typingStyle || {}), ...patch };
    return;
  }
  if (
    /[\uD800-\uDBFF]/.test(model.text[start - 1] || "") &&
    /[\uDC00-\uDFFF]/.test(model.text[start] || "")
  )
    start--;
  if (
    /[\uD800-\uDBFF]/.test(model.text[end - 1] || "") &&
    /[\uDC00-\uDFFF]/.test(model.text[end] || "")
  )
    end++;
  const runs = model.runs || [],
    edges = [
      ...new Set([
        0,
        model.text.length,
        start,
        end,
        ...runs.flatMap((r) => [r.start, r.end]),
      ]),
    ].sort((a, b) => a - b);
  model.runs = edges
    .slice(0, -1)
    .map((a, i) => {
      const b = edges[i + 1],
        r = runs.find((r) => r.start <= a && r.end > a) || model;
      const keys = [
        "fontKey",
        "fontName",
        "fontOriginalName",
        "fontResolution",
        "fontFallback",
        "latinFontKey",
        "latinFontName",
        "cjkFontKey",
        "cjkFontName",
        "size",
        "color",
        "charSpacing",
        "wordSpacing",
        "bold",
        "italic",
        "syntheticBold",
        "syntheticItalic",
        "strokeWidth",
        "strokeColor",
        "fontBold",
        "fontItalic",
        "horizontalScale",
      ];
      return {
        ...Object.fromEntries(
          keys.filter((k) => r[k] != null).map((k) => [k, r[k]]),
        ),
        start: a,
        end: b,
        ...(a >= start && b <= end ? patch : {}),
      };
    })
    .filter((r) => r.end > r.start);
}

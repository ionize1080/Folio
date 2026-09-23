import { sourceLigature } from "./ligatures.mjs";
import { preserveLine } from "./preserve-lines.mjs";
// Deterministic browser layout. O(characters + runs); measuring is cached by face,
// size and character. Hard source line breaks are retained in the text model.
const unsupported = /[\p{Mark}\u0590-\u109f\u200c\u200d]/u;
export function canFast(m) {
  return (
    m.directionSupported !== false &&
    m.direction !== "rtl" &&
    !unsupported.test(m.text) &&
    !m.frames &&
    (m.columns || 1) === 1 &&
    !m.behindPage &&
    m.layerOrder == null &&
    !m.tableGrowth &&
    !["down", "right", "auto"].includes(m.growth)
  );
}
export function fastLayout(m, measure) {
  if (!canFast(m)) throw Error("此文字需要复杂字形排版，使用精排模式");
  const f = m.frame,
    vertical = m.writingMode?.startsWith("vertical"),
    angle = m.rotation || 0,
    rl = m.writingMode !== "vertical-lr";
  if (angle && !vertical) {
    const swap = angle === 90 || angle === 270;
    const local = {
      ...m,
      rotation: 0,
      originalLayout: undefined,
      originalBaseline: undefined,
      baselineOffset: undefined,
      frame: {
        x: 0,
        y: 0,
        width: swap ? f.height : f.width,
        height: swap ? f.width : f.height,
      },
    };
    const r = fastLayout(local, measure);
    const point = (x, y) =>
      angle === 90
        ? [f.x + f.width - y, f.y + x]
        : angle === 180
          ? [f.x + f.width - x, f.y + f.height - y]
          : [f.x + y, f.y + f.height - x];
    r.glyphs = r.glyphs.map((g) => {
      const [originX, baseline] = point(g.originX, g.baseline),
        pts = [
          [g.x, g.y],
          [g.x + g.w, g.y],
          [g.x, g.y + g.h],
          [g.x + g.w, g.y + g.h],
        ].map((p) => point(...p));
      const xs = pts.map((p) => p[0]),
        ys = pts.map((p) => p[1]);
      return {
        ...g,
        originX,
        baseline,
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
        rotation: angle,
        vertical: swap,
      };
    });
    r.anchors = r.anchors.map((a) => {
      if (!a) return a;
      const [x, y] = point(a.x, a.y);
      return { ...a, x, y, vertical: swap, w: swap ? a.h : 1 };
    });
    return r;
  }
  const runs = m.runs || [],
    gs = [],
    anchors = [],
    original = m.originalLayout?.glyphs || [],
    oldText = m.originalLayout?.text;
  const unchanged = oldText === m.text;
  const byOffset = new Map(original.map((g) => [g.start, g]));
  let slotCompatible =
    typeof oldText === "string" && oldText.length === m.text.length;
  if (slotCompatible) {
    let at = 0;
    for (const ch of m.text) {
      const old = byOffset.get(at);
      if (
        !old ||
        (ch === "\n" && old.text !== "\n") ||
        (old.text === "\n" && ch !== "\n")
      ) {
        slotCompatible = false;
        break;
      }
      if (ch !== old.text) {
        const next = byOffset.get(at + ch.length);
        const available =
          next && Math.abs(next.baseline - old.baseline) < 0.5
            ? next.originX - old.originX
            : f.x + f.width - old.originX;
        const st = { ...m, ...old.style };
        if (
          (measure(ch, st).width * (st.horizontalScale || 100)) / 100 >
          available + 0.25
        ) {
          slotCompatible = false;
          break;
        }
      }
      at += ch.length;
    }
  }
  const geometryKeys = [
    "size",
    "fontKey",
    "charSpacing",
    "wordSpacing",
    "horizontalScale",
  ];
  const geometryValue = (style, key, parent = {}) =>
    style?.[key] ??
    parent[key] ??
    { charSpacing: 0, wordSpacing: 0, horizontalScale: 100, fontKey: null }[
      key
    ];
  // Formatting a paragraph adds runs for its nonpainting newline separators.
  // Compare the actual glyphs and effective defaults, not just run boundaries.
  let geometryRun = 0;
  const stylesKeepGeometry = original.every((g) => {
    if (g.text === "\n" || g.text === "\r") return true;
    while (geometryRun < runs.length && runs[geometryRun].end <= g.start)
      geometryRun++;
    const run = runs[geometryRun]?.start <= g.start ? runs[geometryRun] : null;
    return geometryKeys.every(
      (k) => geometryValue(run, k, m) === geometryValue(g.style, k),
    );
  });
  const geometrySame =
    slotCompatible &&
    m.originalLayout &&
    [
      "size",
      "align",
      "lineHeight",
      "charSpacing",
      "wordSpacing",
      "firstIndent",
      "paragraphBefore",
      "paragraphGap",
    ].every((k) => m[k] === m.originalLayout.settings?.[k]) &&
    ["x", "y", "width", "height"].every(
      (k) => Math.abs(f[k] - m.originalLayout.frame[k]) < 0.01,
    ) &&
    stylesKeepGeometry;
  let ri = 0,
    offset = 0,
    line = 0,
    x = f.x + (m.firstIndent || 0),
    base =
      f.y +
      (m.baselineOffset ??
        (m.originalBaseline != null
          ? m.originalBaseline - (m.originalLayout?.frame.y ?? f.y)
          : m.size * 0.85)) +
      (m.paragraphBefore || 0),
    pen = vertical ? f.y : x;
  let col = rl ? f.x + f.width - m.size : f.x,
    step = m.size * (m.lineHeight || 1.4),
    lineStart = 0,
    lineSize = m.size;
  const details = [],
    close = /[，。！？；：、）】》〉」』,.!?;:%\)\]]/u,
    open = /[（【《〈「『\(\[]/u;
  const tokens = Array.from(m.text);
  const softBreaks = new Set(m.softBreaks || []);
  let previous = "",
    cachedRun = null,
    cachedStyle = null;
  function alignLine(end, hard) {
    if (vertical || end <= lineStart) return;
    const list = gs.slice(lineStart, end).filter((g) => g.text !== "\n");
    if (!list.length) return;
    const left = list[0].originX,
      right = list.at(-1).originX + list.at(-1).advance,
      space = Math.max(0, f.x + f.width - right);
    const shift = geometrySame
      ? 0
      : m.align === "center"
        ? space / 2
        : m.align === "right"
          ? space
          : 0;
    let extra =
      !geometrySame && m.align === "justify" && !hard && list.length > 1
        ? space / (list.length - 1)
        : 0;
    list.forEach((g, i) => {
      g.x += shift + i * extra;
      g.originX += shift + i * extra;
      anchors[g.start] = {
        x: g.originX,
        y: g.baseline - g.size * 0.85,
        h: g.size,
      };
    });
  }
  function nextLine(hard = false) {
    alignLine(gs.length, hard);
    line++;
    base +=
      Math.max(step, lineSize * (m.lineHeight || 1.4)) +
      (hard ? m.paragraphGap || 0 : 0);
    col += (rl ? -1 : 1) * Math.max(step, lineSize * (m.lineHeight || 1.4));
    pen = vertical ? f.y : f.x;
    lineStart = gs.length;
    lineSize = m.size;
  }
  for (let ti = 0; ti < tokens.length; ti++) {
    const ch = tokens[ti];
    const soft =
      ch === "\n" &&
      softBreaks.has(offset) &&
      (!geometrySame || m.layoutMode === "reflow");
    while (ri < runs.length && runs[ri].end <= offset) ri++;
    const run = runs[ri]?.start <= offset ? runs[ri] : null;
    if (cachedStyle === null || cachedRun !== run) {
      cachedStyle = { ...m, ...run };
      cachedRun = run;
    }
    const style = cachedStyle,
      size = style.size || m.size;
    const measured =
      ch === "\n"
        ? {
            width:
              soft &&
              /[A-Za-z0-9]/.test(tokens[ti - 1] || "") &&
              /[A-Za-z0-9]/.test(tokens[ti + 1] || "")
                ? measure(" ", style).width
                : 0,
            fontKey: null,
          }
        : ch === "\t"
          ? { ...measure(" ", style), width: measure(" ", style).width * 4 }
          : measure(ch, style);
    const scale = (style.horizontalScale || 100) / 100,
      width = measured.width * scale;
    const advance =
      ch === "\n"
        ? width
        : (vertical ? size : width) +
          (style.charSpacing || 0) +
          (ch === " " ? style.wordSpacing || 0 : 0);
    if (
      ch !== "\n" &&
      pen + (vertical ? size : width) >
        (vertical ? f.y + f.height : f.x + f.width) + 0.25 &&
      pen > (vertical ? f.y : f.x) + 0.25 &&
      !close.test(ch)
    )
      nextLine();
    // Don't strand an opening bracket, or split an ASCII word when it fits a line.
    if (!vertical && ch !== "\n" && pen > f.x + 0.25) {
      let needed = width;
      if (open.test(ch) && tokens[ti + 1] && tokens[ti + 1] !== "\n")
        needed += measure(tokens[ti + 1], style).width * scale;
      if (/[A-Za-z0-9]/.test(ch) && !/[A-Za-z0-9]/.test(previous)) {
        let j = ti + 1;
        while (
          j < tokens.length &&
          j < ti + 128 &&
          /^[A-Za-z0-9]$/.test(tokens[j])
        ) {
          needed += measure(tokens[j], style).width * scale;
          j++;
        }
      }
      if (needed <= f.width && pen + needed > f.x + f.width + 0.25) nextLine();
    }
    const old =
      geometrySame && m.layoutMode !== "reflow" ? byOffset.get(offset) : null;
    let ox = vertical ? col + (size - width) / 2 : pen,
      by = vertical ? pen + size * 0.85 : base;
    // Reuse each original anchor only when all character/paragraph geometry is unchanged.
    const settings = m.originalLayout?.settings || {};
    const preserve =
      old &&
      m.layoutMode !== "reflow" &&
      [
        "size",
        "align",
        "lineHeight",
        "charSpacing",
        "wordSpacing",
        "firstIndent",
        "paragraphGap",
      ].every((k) => m[k] === settings[k]) &&
      Math.abs(f.x - m.originalLayout.frame.x) < 0.01 &&
      Math.abs(f.y - m.originalLayout.frame.y) < 0.01 &&
      Math.abs(f.width - m.originalLayout.frame.width) < 0.01 &&
      size === old.style?.size;
    if (preserve) {
      ox = old.originX;
      by = old.baseline;
    }
    const g = {
      text: ch,
      start: offset,
      end: offset + ch.length,
      originX: ox,
      baseline: by,
      // Advance includes trailing side bearings; only actual ink can overflow
      // the source's tight bounding box. Keep advance separately for the caret.
      x: ox - (vertical ? 0 : (measured.inkLeft || 0) * scale),
      y: by - (vertical ? size * 0.85 : (measured.ascent ?? size * 0.85)),
      w: vertical ? width : (measured.inkWidth ?? measured.width) * scale,
      h: vertical ? size : (measured.inkHeight ?? size),
      size,
      line,
      advance,
      fontKey: measured.fontKey,
      sourceFontKey: measured.fallback
        ? null
        : (ch.codePointAt(0) < 0x300 ? style.latinFontKey : style.cjkFontKey) ||
          style.fontKey,
      color: style.color || m.color,
      bold: !!style.bold,
      italic: !!style.italic,
      fontBold: measured.fontBold ?? !!style.fontBold,
      fontItalic: measured.fontItalic ?? !!style.fontItalic,
      strokeWidth: style.strokeWidth || 0,
      scale,
      rotation: 0,
      vertical: !!vertical,
    };
    if (
      preserve &&
      old.text === ch &&
      ["fontKey", "bold", "italic", "horizontalScale"].every(
        (k) => style[k] === old.style?.[k],
      )
    ) {
      // Preserve authoritative source ink for untouched glyphs. Browser
      // raster metrics may round a tight PDF edge outward by one pixel.
      g.x = old.x;
      g.y = old.y;
      g.w = old.w;
      g.h = old.h;
    }
    if (ch === "\n") {
      g.w = 0;
      g.fontKey = null;
    }
    gs.push(g);
    anchors[offset] = {
      x: vertical ? col : ox,
      y: vertical ? pen : by - size * 0.85,
      h: size,
      w: vertical ? size : 1,
      vertical: !!vertical,
    };
    offset += ch.length;
    lineSize = Math.max(lineSize, size);
    if (measured.fallback)
      details.push({
        start: g.start,
        end: g.end,
        text: ch,
        original: style.fontName,
        actual: measured.name,
        match: "fallback",
        confidence: 0,
      });
    if (ch === "\n" && !soft) nextLine(true);
    else pen += advance;
    previous = ch;
  }
  alignLine(gs.length, true);
  anchors[offset] = {
    x: vertical ? col : pen,
    y: vertical ? pen : base - m.size * 0.85,
    h: m.size,
    w: vertical ? m.size : 1,
    vertical: !!vertical,
  };
  const last = gs.at(-1);
  if (last && last.text !== "\n")
    anchors[offset] = {
      x: vertical ? last.x : last.originX + last.advance,
      y: vertical ? last.y + last.size : last.baseline - last.size * 0.85,
      h: last.size,
      w: vertical ? last.size : 1,
      vertical: !!vertical,
    };
  const localLine = !geometrySame && preserveLine(m, gs, anchors);
  const overflow = gs.some(
    (g) =>
      g.text.trim() &&
      (g.x < f.x - 0.5 ||
        g.y < f.y - 0.5 ||
        g.x + g.w > f.x + f.width + 0.5 ||
        g.y + g.h > f.y + f.height + 0.5),
  );
  return {
    version: 1,
    text: m.text,
    glyphs: gs,
    anchors,
    frameOverset: overflow,
    overflow: overflow && !m.allowOverflow,
    mappingComplete: true,
    fallbackCount: details.length,
    fallbackDetails: details,
    layoutMode: geometrySame
      ? "原始字位"
      : localLine
        ? "局部行重排"
        : "快速排版",
  };
}
const fontCache = new Map();
export class FastFonts {
  constructor(call) {
    this.call = call;
    this.fonts = new Map();
    this.widths = new Map();
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
  }
  async load(key) {
    if (!fontCache.has(key))
      fontCache.set(
        key,
        (async () => {
          const data = await this.call("font-fast", { fontKey: key });
          const family = "FolioFast_" + data.key;
          const face = new FontFace(
            family,
            Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0)),
          );
          await face.load();
          document.fonts.add(face);
          return {
            ...data,
            base64: undefined,
            family,
            coverage: new Set(data.coverage),
          };
        })().catch((e) => {
          // Content-keyed malformed fonts are deterministic failures. Retain
          // their rejection for this session instead of retransferring on keys.
          if (
            e?.name !== "SyntaxError" &&
            !/invalid font|OTS|font data/i.test(e?.message || "")
          )
            fontCache.delete(key);
          throw e;
        }),
      );
    const f = await fontCache.get(key);
    this.fonts.set(key, f);
    this.fonts.set(f.key, f);
    return f;
  }
  required(m) {
    const keys = new Set(
      [m, ...(m.runs || [])]
        .flatMap((r) => [r.fontKey, r.latinFontKey, r.cjkFontKey])
        .filter(Boolean),
    );
    let i = 0,
      offset = 0,
      run = null,
      style = m;
    const runs = m.runs || [];
    for (const ch of m.text) {
      while (i < runs.length && runs[i].end <= offset) i++;
      const next = runs[i]?.start <= offset ? runs[i] : null;
      if (next !== run) {
        run = next;
        style = { ...m, ...run };
      }
      offset += ch.length;
      if (ch === "\n" || ch === "\r") continue;
      const cp = ch === "\t" ? 32 : ch.codePointAt(0),
        key =
          (cp < 0x300 ? style.latinFontKey : style.cjkFontKey) || style.fontKey;
      let f = this.fonts.get(key);
      if (f?.systemKey && !f.coverage.has(cp)) {
        const system = this.fonts.get(f.systemKey);
        if (!system) {
          keys.add(f.systemKey);
          continue;
        }
        if (system.coverage.has(cp)) f = system;
      }
      if (
        !f?.coverage.has(cp) ||
        (f.fontBold && !style.bold) ||
        (f.fontItalic && !style.italic)
      ) {
        const primary =
          cp >= 0x2e80 && cp <= 0x9fff ? "builtin-cjk" : "builtin-latin";
        keys.add(primary);
        const face = this.fonts.get(primary);
        if (face && !face.coverage.has(cp))
          keys.add(primary === "builtin-cjk" ? "builtin-latin" : "builtin-cjk");
      }
    }
    return keys;
  }
  ready(m) {
    return [...this.required(m)].every((k) => this.fonts.has(k));
  }
  async prepare(m) {
    const keys = new Set(
      [m, ...(m.runs || [])]
        .flatMap((r) => [r.fontKey, r.latinFontKey, r.cjkFontKey])
        .filter(Boolean),
    );
    await Promise.all([...keys].map((k) => this.load(k)));
    // At most two fallback edges: original -> same-name system -> builtin.
    for (let pass = 0; pass < 3; pass++) {
      const missing = [...this.required(m)].filter((k) => !this.fonts.has(k));
      if (!missing.length) return;
      await Promise.all(missing.map((k) => this.load(k)));
    }
  }
  measure = (ch, s) => {
    const key =
      (ch.codePointAt(0) < 0x300 ? s.latinFontKey : s.cjkFontKey) || s.fontKey;
    let f = this.fonts.get(key),
      fallback = false;
    if (f?.systemKey && !f.coverage.has(ch.codePointAt(0))) {
      const system = this.fonts.get(f.systemKey);
      if (system?.coverage.has(ch.codePointAt(0))) {
        f = system;
        fallback = true;
      }
    }
    if (
      !f?.coverage.has(ch.codePointAt(0)) ||
      (f.fontBold && !s.bold) ||
      (f.fontItalic && !s.italic)
    ) {
      f = this.fonts.get(
        this.fonts.get("builtin-latin")?.coverage.has(ch.codePointAt(0))
          ? "builtin-latin"
          : "builtin-cjk",
      );
      fallback = true;
    }
    if (!f?.coverage.has(ch.codePointAt(0)))
      throw Error("字体缺少字符：" + ch + "；请选择覆盖此字符的字体");
    const cache = f.key + ":" + s.size + ":" + ch;
    let metrics = this.widths.get(cache);
    if (metrics == null) {
      this.ctx.font = `${s.size}px "${f.family}"`;
      const t = this.ctx.measureText(ch);
      metrics = {
        // PDF advances are unhinted. Chromium may round small embedded
        // TrueType widths to whole pixels; never use those for PDF placement.
        width: (f.advances?.[ch.codePointAt(0)] ?? t.width / s.size) * s.size,
        inkLeft: t.actualBoundingBoxLeft,
        inkWidth: t.actualBoundingBoxLeft + t.actualBoundingBoxRight,
        ascent: t.actualBoundingBoxAscent,
        inkHeight: t.actualBoundingBoxAscent + t.actualBoundingBoxDescent,
      };
      this.widths.set(cache, metrics);
      if (this.widths.size > 20000)
        this.widths.delete(this.widths.keys().next().value);
    }
    return {
      ...metrics,
      fontKey: f.key,
      fallback,
      name: f.name,
      fontBold: f.fontBold,
      fontItalic: f.fontItalic,
    };
  };
  paint(canvas, layout, w, h, scale, clipFrame = null) {
    let l = w,
      t = h,
      r = 0,
      b = 0;
    for (const g of layout.glyphs) {
      if (!g.text.trim()) continue;
      l = Math.min(l, g.x - g.size * 0.4);
      t = Math.min(t, g.y - g.size * 0.25);
      r = Math.max(r, g.x + g.w + g.size * 0.4);
      b = Math.max(b, g.y + g.h + g.size * 0.25);
    }
    if (clipFrame) {
      l = Math.max(l, clipFrame.x);
      t = Math.max(t, clipFrame.y);
      r = Math.min(r, clipFrame.x + clipFrame.width);
      b = Math.min(b, clipFrame.y + clipFrame.height);
    }
    if (r <= l || b <= t) {
      canvas.width = 1;
      canvas.height = 1;
      return;
    }
    // The page edge is a warning, not an editing clip. Keep the canvas and caret
    // reachable on the pasteboard; the PDF page retains its physical bounds.
    const cw = Math.max(1, r - l),
      ch = Math.max(1, b - t),
      z = Math.min(
        scale * (devicePixelRatio || 1),
        3,
        Math.sqrt(8000000 / (cw * ch)),
      );
    const iw = Math.ceil(cw * z),
      ih = Math.ceil(ch * z);
    if (canvas.width !== iw) canvas.width = iw;
    if (canvas.height !== ih) canvas.height = ih;
    canvas.style.inset = "auto";
    canvas.style.left = (l / w) * 100 + "%";
    canvas.style.top = (t / h) * 100 + "%";
    canvas.style.width = (cw / w) * 100 + "%";
    canvas.style.height = (ch / h) * 100 + "%";
    const c = canvas.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, iw, ih);
    c.scale(z, z);
    c.translate(-l, -t);
    c.save();
    if (clipFrame) {
      c.beginPath();
      c.rect(clipFrame.x, clipFrame.y, clipFrame.width, clipFrame.height);
      c.clip();
    }
    for (let index = 0; index < layout.glyphs.length; index++) {
      const g = layout.glyphs[index];
      if (
        clipFrame &&
        (g.y > b + g.size ||
          g.y + g.h < t - g.size ||
          g.x > r + g.size ||
          g.x + g.w < l - g.size)
      )
        continue;
      if (!g.text.trim()) continue;
      const f = this.fonts.get(g.fontKey);
      if (!f) continue;
      const cluster = sourceLigature(layout.glyphs, index, f.coverage);
      index += cluster.count - 1;
      c.save();
      c.translate(g.originX, g.baseline);
      c.rotate((g.rotation * Math.PI) / 180);
      c.transform(g.scale, 0, g.italic && !g.fontItalic ? -0.22 : 0, 1, 0, 0);
      c.font = `${g.size}px "${f.family}"`;
      c.fillStyle = g.color;
      c.strokeStyle = g.color;
      c.fillText(cluster.text, 0, 0);
      if (g.bold && !g.fontBold) {
        c.lineWidth = g.strokeWidth || g.size * 0.025;
        c.strokeText(cluster.text, 0, 0);
      }
      c.restore();
    }
    c.restore();
  }
}

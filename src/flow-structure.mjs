const clone = (x) => structuredClone(x);
export function unionFrames(frames) {
  const x = Math.min(...frames.map((f) => f.x)),
    y = Math.min(...frames.map((f) => f.y));
  return {
    x,
    y,
    width: Math.max(...frames.map((f) => f.x + f.width)) - x,
    height: Math.max(...frames.map((f) => f.y + f.height)) - y,
  };
}
export function joinModels(a, b, chain = false) {
  if (a.cell || b.cell) throw Error("表格单元格请使用表格结构工具");
  const own = new Set(a.sources.map((s) => s.index));
  if (b.sources.some((s) => own.has(s.index)))
    throw Error("这两个范围包含相同原文");
  const m = clone(a),
    offset = m.text.length + 1;
  m.text += "\n" + b.text;
  m.runs = [
    ...(a.runs || []),
    ...(b.runs || []).map((r) => ({
      ...r,
      start: r.start + offset,
      end: r.end + offset,
    })),
  ];
  m.sources.push(...clone(b.sources));
  if (chain) {
    m.frames = [...(a.frames || [a.frame]), ...(b.frames || [b.frame])].map(
      (f, i) => ({ ...clone(f), id: f.id || crypto.randomUUID() }),
    );
    m.columns = 1;
    m.growth = "fixed";
    m.frame = unionFrames(m.frames);
  } else {
    delete m.frames;
    m.frame = unionFrames([a.frame, b.frame]);
  }
  m.structureLocked = true;
  return m;
}
export function splitModel(m, at, glyphs = []) {
  if (!Number.isInteger(at) || at <= 0 || at >= m.text.length)
    throw Error("请将光标放在文字中间的拆分位置");
  if (m.cell) throw Error("请使用表格单元格拆分");
  if (
    /[\uD800-\uDBFF]/.test(m.text[at - 1]) &&
    /[\uDC00-\uDFFF]/.test(m.text[at])
  )
    throw Error("不能在一个字符内部拆分");
  const gs = glyphs.filter((g) => g.start >= at),
    y = gs.length
      ? Math.min(...gs.map((g) => g.y))
      : m.frame.y + m.frame.height / 2;
  const parts = [clone(m), clone(m)];
  for (let i = 0; i < 2; i++) {
    const start = i ? at : 0,
      end = i ? m.text.length : at,
      p = parts[i];
    p.text = m.text.slice(start, end);
    p.runs = (m.runs || [])
      .filter((r) => r.end > start && r.start < end)
      .map((r) => ({
        ...r,
        start: Math.max(r.start, start) - start,
        end: Math.min(r.end, end) - start,
      }));
    delete p.frames;
    delete p.typingStyle;
    p.columns = 1;
    p.structureLocked = true;
    p.growth = "fixed";
    p.allowOverflow = false;
  }
  parts[0].frame = { ...m.frame, height: Math.max(10, y - m.frame.y) };
  parts[1].frame = {
    ...m.frame,
    y: Math.max(m.frame.y, y),
    height: Math.max(10, m.frame.y + m.frame.height - y),
  };
  parts[1].sources = [];
  if (m.frames?.length > 1) {
    const next = m.frames.findIndex((f) =>
      gs.some(
        (g) =>
          g.x >= f.x - 1 &&
          g.x < f.x + f.width &&
          g.y >= f.y - 1 &&
          g.y < f.y + f.height,
      ),
    );
    if (next > 0) {
      parts[0].frames = clone(m.frames.slice(0, next));
      parts[1].frames = clone(m.frames.slice(next));
      for (const p of parts) p.frame = unionFrames(p.frames);
    }
  }
  return parts;
}

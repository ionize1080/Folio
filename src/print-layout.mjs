export const MM = 72 / 25.4;
export const PAPER_SIZES = {
  A3: [297 * MM, 420 * MM],
  A4: [210 * MM, 297 * MM],
  A5: [148 * MM, 210 * MM],
  Letter: [612, 792],
  Legal: [612, 1008],
};
const finite = (value, fallback, min, max, name) => {
  const n = value == null ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    throw Error(`${name}超出有效范围`);
  return n;
};

// All geometry is in PDF points, with a top-left origin. The preview and print
// renderer consume this same plan so dragging never changes a separate model.
export function planPrint(pages, options = {}, adjustments = {}) {
  if (!pages.length) throw Error("请选择至少一页");
  for (const p of pages)
    if (![p.width, p.height].every((n) => Number.isFinite(n) && n > 0))
      throw Error("页面尺寸无效");
  const mode = options.mode || "single";
  if (!["single", "nup", "booklet"].includes(mode)) throw Error("打印模式无效");
  const rows =
    mode === "booklet"
      ? 1
      : mode === "single"
        ? 1
        : finite(options.rows, 2, 1, 10, "行数");
  const cols =
    mode === "booklet"
      ? 2
      : mode === "single"
        ? 1
        : finite(options.cols, 2, 1, 10, "列数");
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows * cols > 100)
    throw Error("行列数必须是整数，合计不超过 100 页");
  const margin =
    finite(options.margin, mode === "single" ? 0 : 10, 0, 200, "页边距") * MM;
  const gapX =
    finite(options.gapX, mode === "booklet" ? 0 : 6, 0, 200, "水平间距") * MM;
  const gapY = finite(options.gapY, 6, 0, 200, "垂直间距") * MM;
  const percent = finite(options.percent, 100, 1, 1000, "缩放比例") / 100;
  const subWidth = finite(options.subWidth, 0, 0, 2000, "子页面宽度") * MM;
  const subHeight = finite(options.subHeight, 0, 0, 2000, "子页面高度") * MM;
  const signature = finite(options.signature, 0, 0, 10000, "书帖页数");
  if (signature && (!Number.isInteger(signature) || signature % 4))
    throw Error("书帖页数须为 4 的倍数");
  const groups = [];
  let blanks = 0;
  if (mode === "booklet") {
    const span = signature || Math.ceil(pages.length / 4) * 4;
    for (let start = 0; start < pages.length; start += span) {
      const chunk = pages.slice(start, start + span),
        total = Math.ceil(chunk.length / 4) * 4;
      blanks += total - chunk.length;
      const index = (n) => (n < chunk.length ? start + n : null);
      for (let i = 0; i < total / 4; i++) {
        const sheet = groups.length / 2 + 1;
        const front = [index(total - 1 - 2 * i), index(2 * i)],
          back = [index(2 * i + 1), index(total - 2 - 2 * i)];
        if (options.binding === "right") {
          front.reverse();
          back.reverse();
        }
        groups.push(
          { indices: front, side: "front", sheet },
          { indices: back, side: "back", sheet },
        );
      }
    }
  } else {
    for (let i = 0; i < pages.length; i += rows * cols)
      groups.push({
        indices: pages.slice(i, i + rows * cols).map((_, j) => i + j),
        side: "single",
        sheet: groups.length + 1,
      });
  }
  let chosen = groups.filter(
    (g) =>
      mode !== "booklet" ||
      !options.sides ||
      options.sides === "both" ||
      options.sides === g.side,
  );
  if (options.reverseSheets) chosen = chosen.reverse();
  const sheets = chosen.map((group) => {
    const first = pages[group.indices.find((i) => i != null)] || pages[0];
    let [width, height] =
      options.paper === "source" && mode === "single"
        ? [first.width, first.height]
        : PAPER_SIZES[options.paper || "A4"] || [
            finite(options.paperWidth, 210, 10, 2000, "纸张宽度") * MM,
            finite(options.paperHeight, 297, 10, 2000, "纸张高度") * MM,
          ];
    if (options.paper !== "source") {
      const landscape =
        options.orientation === "landscape" ||
        (options.orientation !== "portrait" &&
          (mode === "booklet" || cols > rows));
      [width, height] = landscape
        ? [Math.max(width, height), Math.min(width, height)]
        : [Math.min(width, height), Math.max(width, height)];
    }
    const cellW = (width - 2 * margin - (cols - 1) * gapX) / cols,
      cellH = (height - 2 * margin - (rows - 1) * gapY) / rows;
    if (Math.min(cellW, cellH) < 5)
      throw Error("页边距或间距过大，请为子页面留出空间");
    if (subWidth > cellW + 0.01 || subHeight > cellH + 0.01)
      throw Error("子页面大小超过可用区域，请减少大小或间距");
    const slots = group.indices.map((index, position) => {
      let row, col;
      if ((options.order || "row").startsWith("column")) {
        row = position % rows;
        col = Math.floor(position / rows);
      } else {
        row = Math.floor(position / cols);
        col = position % cols;
      }
      if ((options.order || "").endsWith("reverse")) col = cols - 1 - col;
      const cw = subWidth || cellW,
        ch = subHeight || cellH;
      const cell = {
        x: margin + col * (cellW + gapX) + (cellW - cw) / 2,
        y: margin + row * (cellH + gapY) + (cellH - ch) / 2,
        width: cw,
        height: ch,
      };
      if (index == null) return { number: null, cell };
      const source = pages[index],
        fit = Math.min(cw / source.width, ch / source.height),
        rotatedFit = Math.min(cw / source.height, ch / source.width);
      const rotation =
        options.autoRotate !== false && rotatedFit > fit + 1e-6 ? 90 : 0;
      const sw = rotation ? source.height : source.width,
        sh = rotation ? source.width : source.height;
      let scale = Math.min(cw / sw, ch / sh);
      if (options.scaling === "shrink") scale = Math.min(1, scale);
      else if (options.scaling === "actual") scale = 1;
      else if (options.scaling === "custom") scale = percent;
      const adjustment = adjustments[source.number] || {},
        factor = finite(adjustment.scale, 1, 0.05, 20, "单页缩放");
      scale *= factor;
      const w = sw * scale,
        h = sh * scale;
      const rect = {
        x:
          cell.x +
          (cw - w) / 2 +
          finite(adjustment.x, 0, -14400, 14400, "水平偏移"),
        y:
          cell.y +
          (ch - h) / 2 +
          finite(adjustment.y, 0, -14400, 14400, "垂直偏移"),
        width: w,
        height: h,
      };
      const clipped =
        rect.x < cell.x - 0.1 ||
        rect.y < cell.y - 0.1 ||
        rect.x + w > cell.x + cw + 0.1 ||
        rect.y + h > cell.y + ch + 0.1;
      return {
        number: source.number,
        index,
        sourceWidth: source.width,
        sourceHeight: source.height,
        cell,
        rect,
        scale,
        rotation,
        clipped,
      };
    });
    return { width, height, slots, side: group.side, sheet: group.sheet };
  });
  return {
    sheets,
    blanks,
    sourceCount: pages.length,
    clipped: sheets.some((s) => s.slots.some((p) => p.clipped)),
    mode,
    border: !!options.border,
  };
}

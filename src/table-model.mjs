const clone = (x) => structuredClone(x);
export function validateGrid(t) {
  if (
    !Number.isInteger(t.rows) ||
    !Number.isInteger(t.columns) ||
    t.rows < 1 ||
    t.columns < 1 ||
    t.rows * t.columns > 1000
  )
    throw Error("表格结构限 1–1,000 格");
  const occupied = new Set();
  for (const c of t.cells) {
    const rs = c.rowSpan || 1,
      cs = c.colSpan || 1;
    for (let y = c.row; y < c.row + rs; y++)
      for (let x = c.column; x < c.column + cs; x++) {
        const k = y + ":" + x;
        if (y < 0 || x < 0 || y >= t.rows || x >= t.columns || occupied.has(k))
          throw Error("合并单元格结构不完整或重叠");
        occupied.add(k);
      }
  }
  if (occupied.size !== t.rows * t.columns) throw Error("表格存在空缺结构");
  return t;
}
export function gridOperation(
  table,
  op,
  { row = 0, column = 0, endRow = row, endColumn = column, width } = {},
) {
  const t = clone(table);
  validateGrid(t);
  if (op === "merge") {
    const picked = t.cells.filter(
      (c) =>
        c.row >= row &&
        c.column >= column &&
        c.row + (c.rowSpan || 1) - 1 <= endRow &&
        c.column + (c.colSpan || 1) - 1 <= endColumn,
    );
    if (
      picked.reduce((s, c) => s + (c.rowSpan || 1) * (c.colSpan || 1), 0) !==
      (endRow - row + 1) * (endColumn - column + 1)
    )
      throw Error("请选择完整矩形区域，不要跨过现有合并单元格");
    const first = picked[0];
    if (!first) throw Error("请先选择单元格");
    const cell = clone(first),
      texts = picked.sort((a, b) => a.row - b.row || a.column - b.column);
    let offset = 0;
    cell.model.text = "";
    cell.model.runs = [];
    texts.forEach((c, i) => {
      if (i) {
        cell.model.text += "\n";
        offset++;
      }
      cell.model.text += c.model.text;
      cell.model.runs.push(
        ...(c.model.runs || []).map((r) => ({
          ...r,
          start: r.start + offset,
          end: r.end + offset,
        })),
      );
      offset += c.model.text.length;
    });
    cell.row = row;
    cell.column = column;
    cell.rowSpan = endRow - row + 1;
    cell.colSpan = endColumn - column + 1;
    t.cells = t.cells.filter((c) => !picked.includes(c));
    t.cells.push(cell);
  } else if (op === "split") {
    const c = t.cells.find((c) => c.row === row && c.column === column);
    if (!c) throw Error("请选择合并单元格的左上角");
    t.cells = t.cells.filter((x) => x !== c);
    for (let r = c.row; r < c.row + (c.rowSpan || 1); r++)
      for (let col = c.column; col < c.column + (c.colSpan || 1); col++) {
        const n = clone(c);
        n.row = r;
        n.column = col;
        n.rowSpan = n.colSpan = 1;
        if (r !== c.row || col !== c.column) {
          n.model.text = "";
          n.model.runs = [];
        }
        t.cells.push(n);
      }
  } else if (op === "width") {
    if (!Number.isFinite(width) || width < 12) throw Error("列宽至少 12 pt");
    const old = t.widths[column],
      next = column === t.columns - 1 ? column - 1 : column + 1;
    if (next < 0) throw Error("单列表格宽度由表格范围控制");
    if (t.widths[next] - (width - old) < 12) throw Error("相邻列剩余宽度不足");
    t.widths[column] = width;
    t.widths[next] -= width - old;
  } else {
    if (t.cells.some((c) => (c.rowSpan || 1) > 1 || (c.colSpan || 1) > 1))
      throw Error("请先拆开合并单元格，再插入或删除行列");
    const isRow = op.endsWith("row"),
      insert = op.startsWith("insert"),
      key = isRow ? "row" : "column",
      count = isRow ? "rows" : "columns",
      index = isRow ? row : column,
      other = isRow ? "column" : "row";
    if (index < 0 || index > t[count] || (!insert && index === t[count]))
      throw Error("行列位置超出范围");
    if (!insert && t[count] === 1) throw Error("至少保留一行一列");
    if (insert) {
      const template = t.cells.filter(
        (c) => c[key] === Math.min(index, t[count] - 1),
      );
      for (const c of t.cells) if (c[key] >= index) c[key]++;
      for (const c of template) {
        const n = clone(c);
        n[key] = index;
        n.model.text = "";
        n.model.runs = [];
        t.cells.push(n);
      }
      t[count]++;
    } else {
      t.cells = t.cells.filter((c) => c[key] !== index);
      for (const c of t.cells) if (c[key] > index) c[key]--;
      t[count]--;
    }
    const values = isRow ? t.heights : t.widths,
      total = values.reduce((a, b) => a + b, 0);
    if (insert) values.splice(index, 0, total / t[count]);
    else values.splice(index, 1);
    const sum = values.reduce((a, b) => a + b, 0);
    for (let i = 0; i < values.length; i++) values[i] *= total / sum;
  }
  return validateGrid(t);
}
export function cellFrames(t) {
  const [x, y] = t.bounds,
    xs = [x],
    ys = [y];
  t.widths.forEach((w) => xs.push(xs.at(-1) + w));
  t.heights.forEach((h) => ys.push(ys.at(-1) + h));
  return t.cells.map((c) => ({
    ...c,
    bounds: [
      xs[c.column],
      ys[c.row],
      xs[c.column + (c.colSpan || 1)],
      ys[c.row + (c.rowSpan || 1)],
    ],
  }));
}

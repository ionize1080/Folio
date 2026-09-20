function validateModel(m) {
  if (!m || typeof m.text !== "string" || m.text.length > 100000)
    throw Error("单个文本流限 100,000 字符");
  const n = (v, lo, hi, label) => {
    if (!Number.isFinite(v) || v < lo || v > hi)
      throw Error(label + "超出范围");
    return v;
  };
  const width = n(m.pageWidth, 36, 14400, "页面宽度"),
    height = n(m.pageHeight, 36, 14400, "页面高度");
  const f = m.frame;
  if (!f) throw Error("缺少文本框");
  n(f.x, -14400, 14400, "文本框 X");
  n(f.y, -14400, 14400, "文本框 Y");
  n(f.width, 10, 14400, "文本框宽度");
  n(f.height, 10, 14400, "文本框高度");

  n(m.paragraphGap ?? 0, 0, 100, "段后间距");
  const columns = n(m.columns || 1, 1, 3, "栏数");
  if (!Number.isInteger(columns)) throw Error("栏数须为整数");
  n(m.gap ?? 18, 0, 200, "栏间距");
  n(m.size, 4, 150, "字号");
  n(m.lineHeight, 1, 3, "行高");
  if ((f.width - (columns - 1) * (m.gap ?? 18)) / columns <= 0)
    throw Error("栏间距占满了文本框，请减少栏数或栏间距");
  if (!["left", "center", "right", "justify"].includes(m.align))
    throw Error("对齐方式无效");
  if (!/^#[0-9a-f]{6}$/i.test(m.color)) throw Error("文字颜色无效");
  if (!["sans", "serif"].includes(m.font || "sans")) throw Error("字体无效");
  return { ...m, columns };
}

module.exports = { validateModel };

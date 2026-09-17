export function fontLabel(name = "") {
  const clean = name.replace(/^[A-Z]{6}\+/, "");
  if (/[\u3400-\u9fff]/u.test(clean)) return clean;
  const labels = [
    [/^NotoSerifCJKsc/i, "Noto 宋体（简体中文）"],
    [/^NotoSansCJKsc/i, "Noto 黑体（简体中文）"],
    [/^NotoSansSC/i, "Noto 黑体（简体中文）"],
    [/^SimSun$/i, "宋体"],
    [/^NSimSun$/i, "新宋体"],
    [/^SimHei$/i, "黑体"],
    [/^KaiTi(?:_GB2312)?/i, "楷体"],
    [/^FangSong(?:_GB2312)?/i, "仿宋"],
    [/^MicrosoftYaHei/i, "微软雅黑"],
    [/^DengXian/i, "等线"],
  ];
  const hit = labels.find(([re]) => re.test(clean));
  if (!hit) return clean;
  const style = /BoldItalic/i.test(clean)
    ? "粗斜体"
    : /Bold/i.test(clean)
      ? "粗体"
      : /Italic/i.test(clean)
        ? "斜体"
        : /Light/i.test(clean)
          ? "细体"
          : /Regular/i.test(clean)
            ? "常规"
            : "";
  return hit[1] + (style ? " · " + style : "");
}

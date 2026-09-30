export const IDENTITY = [
  [0, 0],
  [255, 255],
];
export function curveLUT(points, smooth = true) {
  const x = points.map((p) => p[0]),
    y = points.map((p) => p[1]),
    h = x.slice(1).map((v, i) => v - x[i]),
    d = h.map((v, i) => (y[i + 1] - y[i]) / v),
    m = x.map(() => 0);
  m[0] = d[0];
  m[m.length - 1] = d[d.length - 1];
  for (let i = 1; i < m.length - 1; i++)
    if (d[i - 1] * d[i] > 0) {
      const a = 2 * h[i] + h[i - 1],
        b = h[i] + 2 * h[i - 1];
      m[i] = (a + b) / (a / d[i - 1] + b / d[i]);
    }
  let j = 0;
  return Array.from({ length: 256 }, (_, v) => {
    if (v <= x[0]) return y[0];
    if (v >= x[x.length - 1]) return y[y.length - 1];
    while (j < x.length - 2 && v > x[j + 1]) j++;
    const t = (v - x[j]) / h[j];
    return Math.max(
      0,
      Math.min(
        255,
        smooth
          ? (2 * t ** 3 - 3 * t * t + 1) * y[j] +
              (t ** 3 - 2 * t * t + t) * h[j] * m[j] +
              (-2 * t ** 3 + 3 * t * t) * y[j + 1] +
              (t ** 3 - t * t) * h[j] * m[j + 1]
          : y[j] + t * (y[j + 1] - y[j]),
      ),
    );
  });
}
export function parseCube(text) {
  if (text.length > 4 * 1024 * 1024) throw Error("LUT 文件限 4 MB");
  let size,
    data = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.replace(/#.*/, "").trim();
    if (!s || s.startsWith("TITLE")) continue;
    const p = s.split(/\s+/);
    if (p[0] === "LUT_3D_SIZE") {
      size = +p[1];
      if (!Number.isInteger(size) || size < 2 || size > 33)
        throw Error("3D LUT 边长限 2–33");
    } else if (p[0] === "DOMAIN_MIN" || p[0] === "DOMAIN_MAX") {
      const expected = p[0] === "DOMAIN_MIN" ? 0 : 1;
      if (p.length !== 4 || p.slice(1).some((x) => +x !== expected))
        throw Error("LUT 仅支持 0–1 输入域");
    } else if (
      p.length === 3 &&
      p.every((x) => Number.isFinite(+x) && +x >= 0 && +x <= 1)
    )
      data.push(...p.map(Number));
    else throw Error("不支持的 .cube 内容");
  }
  if (!size || data.length !== size ** 3 * 3) throw Error("LUT 数据量不完整");
  return { size, data };
}
export const controls = [
  [
    "light",
    "亮度 / 对比度",
    [
      ["brightness", "亮度", -100, 100, 1, 0],
      ["contrast", "对比度", -100, 100, 1, 0],
    ],
  ],
  [
    "color",
    "颜色 / 自然饱和度",
    [
      ["temperature", "色温", -100, 100, 1, 0],
      ["tint", "色调", -100, 100, 1, 0],
      ["vibrance", "自然饱和度", -100, 100, 1, 0],
    ],
  ],
  [
    "detail",
    "清晰度 / 去除薄雾",
    [
      ["clarity", "清晰度", -100, 100, 1, 0],
      ["dehaze", "去除薄雾", -100, 100, 1, 0],
      ["blur", "高斯模糊（像素）", 0, 30, 0.1, 0],
      ["sharpen", "锐化（%）", 0, 300, 5, 0],
    ],
  ],
  ["grain", "颗粒", [["grain", "颗粒强度", 0, 100, 1, 0]]],
  [
    "exposure",
    "曝光度",
    [
      ["exposure", "曝光（EV）", -10, 10, 0.1, 0],
      ["offset", "位移", -0.5, 0.5, 0.005, 0],
      ["exposureGamma", "曝光灰度系数", 0.1, 10, 0.05, 1],
    ],
  ],
  [
    "hsl",
    "色相 / 饱和度",
    [
      ["hue", "色相", -180, 180, 1, 0],
      ["saturation", "饱和度", -100, 100, 1, 0],
      ["lightness", "明度", -100, 100, 1, 0],
    ],
  ],
  ["photo", "照片滤镜", [["photoDensity", "浓度（%）", 0, 100, 1, 0]]],
  ["poster", "色调分离", [["posterize", "色阶数", 2, 256, 1, 256]]],
  ["threshold", "阈值", [["threshold", "阈值", 0, 255, 1, 128]]],
];

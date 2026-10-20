import test from "node:test";
import assert from "node:assert/strict";
import { pageCandidates } from "../src/flow-page-model.mjs";

const row = (index, text, y, width = 450, size = 10.5, x = 72) => ({
  index,
  type: "text",
  text,
  size,
  flowEditable: true,
  editable: true,
  signature: String(index),
  fontKey: "test",
  fontName: "SimSun",
  matrix: [1, 0, 0, 1, x, 842 - y],
  bounds: [x, 842 - y - 2, x + width, 842 - y + size * 0.8],
});
const models = (objects) =>
  pageCandidates(objects, 595, 842).map((c) => c.model);

test("repeated 27pt leading in 10.5pt prose joins wraps but keeps a 33pt paragraph gap", () => {
  const result = models([
    row(
      0,
      "十五五规划最重要的信号不在于它推动了哪些产业，而在于结构性重排序",
      155,
    ),
    row(1, "驱动发展置于第二篇；十五五则将建设现代产业体系提升至该位置", 182),
    row(2, "创新现在服务于产业现代化，而非相", 209),
    row(3, "反。", 236, 21),
    row(4, "最大的惊喜来自未被大力推动的行业，低空经济在十四五中未被强调", 269),
    row(5, "但进入估值和市场体制与政策方向同样重要。", 296, 250),
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].sources.length, 4);
  assert.equal(result[1].sources.length, 2);
  assert.equal(result[0].lineHeight, 27 / 10.5);
  assert.equal(result[0].softBreaks.length, 3);
});

test("a colon at the end of a full-width wrapped line continues the paragraph", () => {
  const result = models([
    row(0, "核心结论：当前配置存在不可接受的集中度风险", 155),
    row(1, "跨境基金流动并冲击所持资产。最优路径：", 182, 443),
    row(2, "建立有意义的仓位，维持纪律性风控框架。", 209, 359),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].sources.length, 3);
});

test("a short standalone colon label remains separate from subsequent prose", () => {
  const result = models([
    row(0, "核心工具：", 155, 60),
    row(1, "创业板人工智能ETF覆盖全链，权重在算力基础设施", 173),
    row(2, "直接受益于国产GPU放量和存储价格上涨。", 191),
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, "核心工具：");
});

test("six-digit fund codes at the start of a wrap are not numbered headings", () => {
  const result = models([
    row(0, "电网设备ETF过去一年回报增长，储能电池ETF", 155),
    row(1, "（159305）捕捉早期储能复苏，与AI不同估值合理", 182),
    row(2, "——这是一个逆向早周期操作。", 209, 180),
    row(3, "1、风险提示", 250, 100),
    row(4, "下一个独立段落需要单独编辑。", 270, 200),
  ]);
  assert.equal(result.length, 3);
  assert.equal(result[0].sources.length, 3);
  assert.equal(result[1].text, "1、风险提示");
});

test("repeated widely spaced labels or complete statements do not establish body leading", () => {
  for (const [width, text] of [
    [70, "独立标签"],
    [450, "这是独立完整的一句说明。"],
  ]) {
    const result = models(
      [0, 1, 2, 3].map((i) => row(i, text, 155 + i * 27, width)),
    );
    assert.equal(result.length, 4);
  }
});

test("wide leading retains simultaneous column boundaries and footer isolation", () => {
  const objects = [];
  for (let i = 0; i < 4; i++) {
    objects.push(
      row(objects.length, `左栏正文连续行${i}`, 155 + i * 27, 220, 10.5, 50),
    );
    objects.push(
      row(objects.length, `右栏正文连续行${i}`, 155 + i * 27, 220, 10.5, 310),
    );
  }
  objects.push(row(objects.length, "— 3 —", 800, 30, 8, 280));
  const result = models(objects);
  assert.equal(result.length, 3);
  assert(result.some((m) => m.sources.length === 4 && m.text.includes("左栏")));
  assert(result.some((m) => m.sources.length === 4 && m.text.includes("右栏")));
  assert(
    !result.some((m) => m.text.includes("左栏") && m.text.includes("右栏")),
  );
});

test("short textbook dialogue and repeated first-line indents remain independent paragraphs", () => {
  const result = models([
    row(0, "前一段的首行从缩进开始，后面的内容延续", 100, 380, 14, 96),
    row(1, "正文续行与正文左边界对齐，提供清晰的缩进证据", 124.5, 407, 14, 68),
    row(2, "第二个正文续行保持相同宽度，结束本段。", 149, 407, 14, 68),
    row(3, "我说：“是的。”", 173.5, 87, 14, 96),
    row(
      4,
      "我看祖父还在笑，就说：“你不信，我到屋里拿来给你看。”",
      198,
      352,
      14,
      96,
    ),
    row(
      5,
      "我跑到屋里拿了一个谷穗，远远地抛给祖父，说：“这不是一",
      222.5,
      380,
      14,
      96,
    ),
    row(6, "样的吗？”", 247, 58, 14, 68),
  ]);
  assert.equal(result.length, 4);
  assert.equal(result[1].text, "我说：“是的。”");
  assert.equal(result[2].sources.length, 1);
  assert.equal(result[3].sources.length, 2);
});

test("diamond exercise items split at each marker while retaining their physical continuation lines", () => {
  const result = models([
    row(0, "◇ 这是第一个独立练习项目，其说明需要折行", 100, 300, 13, 80),
    row(1, "折行仍然属于第一个项目。", 122, 235, 13, 94),
    row(2, "◆ 这是第二个独立练习项目，也有一行续文", 144, 300, 13, 80),
    row(3, "不能把这个项目挤到前一个末行。", 166, 250, 13, 94),
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((m) => m.sources.length),
    [2, 2],
  );
  assert.equal(result[0].softBreaks.length, 1);
  assert.equal(result[1].softBreaks.length, 1);
});

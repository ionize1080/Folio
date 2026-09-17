import { clone, validate } from "./model.mjs";
const names = {
  XYZ: ["左侧 X", "顶部 Y", "缩放"],
  FitH: ["顶部 Y"],
  FitBH: ["顶部 Y"],
  FitV: ["左侧 X"],
  FitBV: ["左侧 X"],
  FitR: ["左侧", "底部", "右侧", "顶部"],
  Fit: [],
  FitB: [],
};
export function describeChanges(before, after, rule = {}) {
  const old = new Map(before.map((n) => [n.id, n]));
  return after
    .map((n) => {
      const b = old.get(n.id);
      if (!b)
        return {
          id: n.id,
          title: n.title,
          fields: [
            { name: "书签", before: null, after: n.title, operation: "新增" },
          ],
        };
      const fields = [];
      const add = (name, a, c, operation = "替换") => {
        if (JSON.stringify(a) !== JSON.stringify(c))
          fields.push({ name, before: a, after: c, operation });
      };
      for (const [key, label] of Object.entries({
        title: "标题",
        parent: "父级",
        bold: "粗体",
        italic: "斜体",
        color: "颜色",
        open: "默认展开",
      }))
        add(label, b[key], n[key]);
      add("目标类型", b.target.kind, n.target.kind, "显式转换");
      add("物理页码", b.target.page, n.target.page);
      add("视图模式", b.target.mode, n.target.mode);
      for (
        let i = 0;
        i < Math.max(b.target.args?.length || 0, n.target.args?.length || 0);
        i++
      ) {
        const op = rule.edits?.[i];
        add(
          names[n.target.mode]?.[i] || "参数 " + (i + 1),
          b.target.args?.[i],
          n.target.args?.[i],
          op?.op === "relative"
            ? `原值 ${Number(op.value) >= 0 ? "+" : "−"} ${Math.abs(Number(op.value))}`
            : op?.op === "null"
              ? "设为 null"
              : rule.op === "whitespace"
                ? rule.description
                : "设为绝对值",
        );
      }
      return {
        id: n.id,
        title: n.title,
        before: b.target,
        after: n.target,
        fields,
      };
    })
    .filter((n) => n.fields.length);
}
export function adjustWhitespace(
  nodes,
  ids,
  { amount, unit = "mm", convert = false, rotations = {} },
  pages,
) {
  const delta = Number(amount) * (unit === "mm" ? 72 / 25.4 : 1);
  if (!Number.isFinite(delta) || Math.abs(delta) > 1000)
    throw Error("留白偏移超出范围");
  const out = clone(nodes),
    skipped = [];
  for (const n of out) {
    if (!ids.has(n.id)) continue;
    const t = n.target,
      p = pages[t.page - 1],
      r = (((rotations[t.page] ?? p?.rotation ?? 0) % 360) + 360) % 360;
    let reason = !p
      ? "不是本地页面目标"
      : t.kind === "preserve" && !convert
        ? "原始动作需要允许转换"
        : !["XYZ", "FitH", "FitBH"].includes(t.mode)
          ? "此模式没有顶部定位"
          : "";
    if (reason) {
      skipped.push({ title: n.title, reason });
      continue;
    }
    let a = clone(t.args),
      mode = t.mode;
    const top = mode === "XYZ" ? a[1] : a[0];
    if (top == null) {
      skipped.push({ title: n.title, reason: "顶部为 null，缺少绝对锚点" });
      continue;
    }
    if (r % 180 && mode !== "XYZ") {
      if (!convert) {
        skipped.push({ title: n.title, reason: "旋转页需转换为 XYZ" });
        continue;
      }
      mode = "XYZ";
      a = [p.box.x, top, null];
    }
    const i = mode === "XYZ" ? (r % 180 ? 0 : 1) : 0;
    if (a[i] == null) {
      skipped.push({ title: n.title, reason: "偏移方向坐标为 null" });
      continue;
    }
    a[i] += delta * ([0, 270].includes(r) ? 1 : -1);
    n.target = { kind: "dest", page: t.page, mode, args: a };
  }
  validate(out, pages.length);
  return { nodes: out, skipped, delta };
}

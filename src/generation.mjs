import { normalizeTitle, duplicatePlan } from "./bookmark-tools.mjs";
import { makeNode, validate, clone } from "./model.mjs";
export function pageRange(text, count, parity = "all") {
  const pages = new Set();
  for (const part of text.split(/[,，]/)) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw Error("页码格式：1-5,8,12-20");
    const a = +m[1],
      b = +(m[2] || m[1]);
    if (a < 1 || b > count || a > b) throw Error("页码超出范围");
    for (let p = a; p <= b; p++)
      if (parity === "all" || p % 2 === (parity === "odd" ? 1 : 0))
        pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}
export const defaultRules = [
  {
    name: "第 1 层",
    level: 1,
    pattern: "^第[一二三四五六七八九十百零〇0-9]+[章节篇部].*",
    template: "$0",
    bold: true,
    italic: false,
    color: "#263449",
    offset: 16,
    enabled: true,
  },
];
export const industryRules = [
  {
    name: "门类",
    level: 1,
    pattern: "^([A-Z])\\s+(.+?)(?= {2,}|$)",
    template: "$1 $2",
    bold: true,
  },
  {
    name: "大类",
    level: 2,
    pattern: "^(\\d{2})\\s+(.+?)(?= {2,}|$)",
    template: "$1 $2",
    bold: true,
  },
  {
    name: "中类",
    level: 3,
    pattern: "^(\\d{3})\\s+(.+?)(?= {2,}|$)",
    template: "$1 $2",
  },
  {
    name: "小类",
    level: 4,
    pattern: "^(\\d{4})\\s+(.+?)(?= {2,}|$)",
    template: "$1 $2",
  },
].map((r) => ({
  enabled: true,
  italic: false,
  color: "#263449",
  offset: 16,
  ...r,
}));
export function generateRules({
  lines,
  rules,
  pageCount,
  header = 0,
  footer = 0,
  unit = "pt",
  dedupe = true,
  conflict = "first",
  orphan = "skip",
}) {
  if (!Array.isArray(rules) || !rules.length || rules.length > 10000)
    throw Error("请至少添加一个层级（资源上限 10,000 条规则）");
  const active = rules
    .filter((r) => r.enabled)
    .map((r, activeIndex) => {
      if (!Number.isInteger(+r.level) || r.level < 1 || r.level > 10000)
        throw Error("层级必须为正整数（上限 10,000）");
      if (!Number.isFinite(+r.offset) || Math.abs(+r.offset) > 1000)
        throw Error("留白超出范围");
      return { ...r, re: new RegExp(r.pattern, "du") };
    });
  const nodes = [],
    parents = [],
    diagnostics = [],
    seen = new Map();
  let ignored = 0,
    conflicts = 0,
    orphans = 0;
  for (const l of lines) {
    if (l.top < header || l.bottom > l.height - footer) {
      ignored++;
      if (diagnostics.length < 1000)
        diagnostics.push({
          page: l.page,
          text: l.text,
          reason: "页眉 / 页脚排除",
        });
      continue;
    }
    const matches = active
      .map((r) => ({ r, m: r.re.exec(l.text) }))
      .filter((x) => x.m);
    if (!matches.length) {
      ignored++;
      if (diagnostics.length < 1000)
        diagnostics.push({ page: l.page, text: l.text, reason: "未命中规则" });
      continue;
    }
    if (matches.length > 1) {
      conflicts++;
      diagnostics.push({
        page: l.page,
        text: l.text,
        reason: "多规则冲突：" + matches.map((x) => x.r.name).join(" / "),
      });
      if (conflict === "skip") continue;
    }
    const { r, m } = matches[0];
    let level = +r.level;
    if (level > 1 && !parents[level - 2]) {
      orphans++;
      diagnostics.push({
        page: l.page,
        text: l.text,
        reason: `缺少第 ${level - 1} 级父项（已跳过）`,
      });
      parents.length = Math.min(parents.length, level - 1);
      if (orphan === "skip") continue;
      level = Math.min(level, parents.length + 1);
    }
    const needed = [...(r.template || "$0").matchAll(/\$(\d+)/g)].map(
      (x) => +x[1],
    );
    const absent =
      r.titleMode !== "line" &&
      r.titleMode !== "match" &&
      r.requireGroups !== false &&
      needed.find((i) => i > 0 && !m[i]?.trim());
    if (absent) {
      ignored++;
      if (diagnostics.length < 3000)
        diagnostics.push({
          page: l.page,
          text: l.text,
          reason: `标题缺少第 ${absent} 组`,
          groups: m.slice(1),
        });
      continue;
    }
    let title = (
      r.titleMode === "line"
        ? l.text
        : r.titleMode === "match"
          ? m[0]
          : (r.template || "$0")
              .replace(/\$(\d+)/g, (_, i) => m[+i] || "")
              .replaceAll("{page}", String(l.page))
    )
      .replace(/\s+/gu, " ")
      .trim();
    if (!title) {
      ignored++;
      continue;
    }
    const targetIndex = m.indices?.[+r.targetGroup || 0]?.[0] ?? m.index ?? 0;
    const at = l.segments?.find((s) => s.end > targetIndex);
    const point = at?.point || [l.x, l.y];
    const n = makeNode(title, l.page, level > 1 ? parents[level - 2] : null),
      offset = +r.offset * (unit === "mm" ? 72 / 25.4 : 1);
    // dx/dy is the native PDF vector pointing towards the top of the displayed page.
    n.target.args = [
      point[0] + (l.upX || 0) * offset,
      point[1] + (l.upY ?? 1) * offset,
      null,
    ];
    Object.assign(n, {
      bold: !!r.bold,
      italic: !!r.italic,
      color: r.color || "#263449",
    });
    n.origin = {
      page: l.page,
      text: l.text,
      source: l.source || "PDF",
      rule: r.name,
      groups: m.slice(1),
      segments: l.segments || [],
      titleSegments: (l.segments || []).filter((s) => {
        const ranges =
          r.titleMode === "line"
            ? [[0, l.text.length]]
            : r.titleMode === "match"
              ? [m.indices[0]]
              : (needed.length ? needed : [0])
                  .map((i) => m.indices[i])
                  .filter(Boolean);
        return ranges.some(([a, b]) => s.start < b && s.end > a);
      }),
    };
    const key = JSON.stringify([
      n.parent,
      normalizeTitle(n.title),
      n.target.page,
    ]);
    if (dedupe && seen.has(key)) {
      ignored++;
      parents.length = level - 1;
      parents[level - 1] = seen.get(key);
      continue;
    }
    seen.set(key, n.id);
    parents.length = level - 1;
    parents[level - 1] = n.id;
    nodes.push(n);
    if (diagnostics.length < 3000)
      diagnostics.push({
        page: l.page,
        text: l.text,
        reason: r.name,
        groups: m.slice(1),
        title,
        level,
        x: n.target.args[0],
        y: n.target.args[1],
      });
  }
  return {
    nodes: validate(nodes, pageCount),
    diagnostics,
    ignored,
    conflicts,
    orphans,
  };
}
export function insertGenerated(existing, generated, where, selectedId) {
  if (where === "replace") return clone(generated);
  const nodes = clone(existing),
    chunk = clone(generated),
    ref = nodes.find((n) => n.id === selectedId);
  if (!ref || where === "append") return validate([...nodes, ...chunk]);
  let at = nodes.indexOf(ref);
  if (where === "child") at++;
  else if (where === "after") {
    at++;
    const sub = new Set([ref.id]);
    while (at < nodes.length && sub.has(nodes[at].parent)) {
      sub.add(nodes[at].id);
      at++;
    }
  }
  for (const n of chunk)
    if (n.parent === null) n.parent = where === "child" ? ref.id : ref.parent;
  nodes.splice(at, 0, ...chunk);
  return validate(nodes);
}

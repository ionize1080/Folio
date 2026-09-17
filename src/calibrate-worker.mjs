import { normalizeTitle } from "./bookmark-tools.mjs";
export function matchTargets({
  nodes,
  pages,
  loose = true,
  strip = "",
  header = 0,
  footer = 0,
  offset = 5,
  unit = "mm",
  radius = 0,
}) {
  const re = strip ? new RegExp(strip, "gu") : null,
    results = [];
  if (!Number.isFinite(offset) || Math.abs(offset) > 1000)
    throw Error("留白数值无效");
  for (const n of nodes) {
    const title = normalizeTitle(re ? n.title.replace(re, "") : n.title, loose),
      candidates = [];
    if (!title) {
      results.push({
        id: n.id,
        title: n.title,
        candidates,
        reason: "标题处理后为空",
      });
      continue;
    }
    const base = n.target.page,
      order = [base];
    for (let i = 1; i <= radius; i++) order.push(base - i, base + i);
    for (const page of order) {
      for (const l of pages[page] || []) {
        if (l.top < header || l.bottom > l.height - footer) continue;
        if (!normalizeTitle(l.text, loose).includes(title)) continue;
        const delta = offset * (unit === "mm" ? 72 / 25.4 : 1);
        const start = normalizeTitle(l.text, loose).indexOf(title);
        const fragment = l.segments?.find(
          (s) => normalizeTitle(l.text.slice(0, s.end), loose).length > start,
        );
        const point =
          fragment?.point || (!l.segments?.length ? [l.x, l.y] : null);
        if (!point) continue;
        const normalized = normalizeTitle(l.text, loose);
        const matchedSegments = (l.segments || []).filter(
          (s) =>
            normalizeTitle(l.text.slice(0, s.end), loose).length > start &&
            normalizeTitle(l.text.slice(0, s.start), loose).length <
              start + title.length,
        );
        const bounded = [
          ...l.text.matchAll(/[【〔「『]([^】〕」』]+)[】〕」』]/gu),
        ].some((m) => normalizeTitle(m[1], loose) === title);
        const score =
          (normalized === title ? 100 : 0) +
          (bounded ? 90 : 0) +
          (start === 0 ? 25 : 0) +
          Math.min(15, (15 * title.length) / normalized.length);

        candidates.push({
          page,
          score,
          evidence: bounded
            ? "明确标题边界"
            : normalized === title
              ? "整行标题"
              : start === 0
                ? "行首匹配"
                : "正文包含",
          segments: matchedSegments,
          text: l.text,
          source: l.source,
          top: l.top,
          target: {
            kind: "dest",
            page,
            mode: "XYZ",
            args: [
              point[0] + l.upX * delta,
              point[1] + l.upY * delta,
              n.target.mode === "XYZ" ? (n.target.args?.[2] ?? null) : null,
            ],
          },
        });
      }
      if (candidates.length) break;
    }
    candidates.sort((a, b) => b.score - a.score || a.top - b.top);
    for (let i = candidates.length - 1; i > 0; i--)
      if (
        candidates
          .slice(0, i)
          .some(
            (c) =>
              c.page === candidates[i].page &&
              Math.hypot(
                c.target.args[0] - candidates[i].target.args[0],
                c.target.args[1] - candidates[i].target.args[1],
              ) < 1,
          )
      )
        candidates.splice(i, 1);
    results.push({
      id: n.id,
      title: n.title,
      before: n.target,
      candidates,
      reason: candidates.length ? "已匹配" : "未找到，保留原目标",
    });
  }
  return results;
}
if (typeof self !== "undefined")
  self.onmessage = (e) => {
    try {
      self.postMessage({ results: matchTargets(e.data) });
    } catch (e) {
      self.postMessage({ error: e.message });
    }
  };

import { connectedParagraphs } from "./flow-regions.mjs";
export const paragraphCandidates = connectedParagraphs;
export function mergeCandidates(candidates, pageWidth, pageHeight) {
  const first = candidates[0];
  if (
    candidates.some(
      (p) =>
        (p.writingMode || "horizontal-tb") !==
          (first.writingMode || "horizontal-tb") ||
        (p.rotation || 0) !== (first.rotation || 0) ||
        (p.direction || "ltr") !== (first.direction || "ltr"),
    )
  )
    throw Error("不同阅读方向的文字需要分别编辑");
  const sorted = [...candidates].sort((a, b) => {
    if (a.writingMode === "vertical-rl")
      return b.frame.x - a.frame.x || a.frame.y - b.frame.y;
    if (a.writingMode === "vertical-lr")
      return a.frame.x - b.frame.x || a.frame.y - b.frame.y;
    const overlap =
      Math.min(a.frame.x + a.frame.width, b.frame.x + b.frame.width) -
      Math.max(a.frame.x, b.frame.x);
    return overlap > Math.min(a.frame.width, b.frame.width) * 0.3
      ? a.frame.y - b.frame.y || a.frame.x - b.frame.x
      : a.frame.x - b.frame.x || a.frame.y - b.frame.y;
  });
  // Selection order is visible and editable; separated columns are read left to right.
  const x = Math.min(...sorted.map((p) => p.frame.x)),
    y = Math.min(...sorted.map((p) => p.frame.y));
  return {
    text: sorted.map((p) => p.text).join("\n"),
    writingMode: sorted[0].writingMode || "horizontal-tb",
    direction: sorted[0].direction || "ltr",
    rotation: sorted[0].rotation || 0,
    directionSupported: sorted.every((p) => p.supported !== false),
    lineStarts: sorted.length === 1 ? sorted[0].lineStarts : undefined,
    softBreaks: (() => {
      let offset = 0;
      const breaks = [];
      for (const p of sorted) {
        for (const n of p.hardLineBreaks ? [] : p.lineStarts?.slice(1) || [])
          breaks.push(offset + n - 1);
        offset += p.text.length + 1;
      }
      return breaks;
    })(),
    sources: sorted.flatMap((p) => p.sources),
    pageWidth,
    pageHeight,
    frame: {
      x,
      y,
      width: Math.min(
        pageWidth - x,
        Math.max(...sorted.map((p) => p.frame.x + p.frame.width)) - x,
      ),
      height: Math.min(
        pageHeight - y,
        Math.max(...sorted.map((p) => p.frame.y + p.frame.height)) - y,
      ),
    },
    size: Math.round(sorted[0].size * 10) / 10,
    lineHeight: 1.4,
    paragraphGap: 0,
    columns: 1,
    gap: 18,
    align: "left",
    color: "#202020",
    font: "sans",
    bold: false,
    italic: false,
  };
}
export function flowHTML(model) {
  const esc = (s) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  return (
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Folio 文本流</title><style>body{max-width:48em;margin:2em auto;line-height:1.6;white-space:pre-wrap}</style><main>' +
    model.text
      .split("\n")
      .map((t) => "<p>" + esc(t) + "</p>")
      .join("") +
    "</main></html>"
  );
}

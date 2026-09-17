// Conservative native-text paragraph candidates; no generative rewriting of source text.
export function paragraphCandidates(objects, pageHeight) {
  const rows = [];
  for (const o of objects
    .filter(
      (o) =>
        o.type === "text" &&
        o.flowEditable &&
        o.text?.trim() &&
        Math.abs(o.matrix[1]) < 0.001 &&
        Math.abs(o.matrix[2]) < 0.001 &&
        o.matrix[0] > 0 &&
        o.matrix[3] > 0,
    )
    .sort((a, b) => b.matrix[5] - a.matrix[5] || a.bounds[0] - b.bounds[0])) {
    let row = rows
      .slice(-5)
      .find(
        (r) =>
          Math.abs(r.base - o.matrix[5]) < Math.max(2, o.size * 0.22) &&
          Math.abs(r.size - o.size) < Math.max(1.2, o.size * 0.35) &&
          o.bounds[0] - r.right < Math.max(20, o.size * 2),
      );
    if (!row) {
      row = {
        base: o.matrix[5],
        size: o.size,
        objects: [],
        left: o.bounds[0],
        right: o.bounds[2],
      };
      rows.push(row);
    }
    row.objects.push(o);
    row.left = Math.min(row.left, o.bounds[0]);
    row.right = Math.max(row.right, o.bounds[2]);
  }
  rows.sort((a, b) => b.base - a.base || a.left - b.left);
  const paragraphs = [];
  for (const row of rows) {
    let previous = paragraphs.slice(-8).find((p) => {
      const last = p.rows.at(-1),
        dy = last.base - row.base;
      return (
        !/^[\s]*[·•▪●]/u.test(row.objects.map((o) => o.text).join("")) &&
        dy > row.size * 0.6 &&
        dy < row.size * 2.6 &&
        Math.abs(last.size - row.size) < Math.max(0.8, row.size * 0.1) &&
        Math.abs(p.left - row.left) < row.size * 2.8 &&
        !(row.left - p.left > row.size * 1.3 && p.rows.length > 1) &&
        last.right >= p.right - row.size * 2
      );
    });
    if (!previous) {
      previous = { rows: [], left: row.left, right: row.right };
      paragraphs.push(previous);
    }
    previous.rows.push(row);
    previous.left = Math.min(previous.left, row.left);
    previous.right = Math.max(previous.right, row.right);
  }
  return paragraphs.map((p, i) => {
    const source = p.rows.flatMap((r) => r.objects),
      bounds = [
        Math.min(...source.map((o) => o.bounds[0])),
        Math.min(...source.map((o) => o.bounds[1])),
        Math.max(...source.map((o) => o.bounds[2])),
        Math.max(...source.map((o) => o.bounds[3])),
      ];
    const lineText = (r) =>
      r.objects
        .sort((a, b) => a.bounds[0] - b.bounds[0])
        .map(
          (o, i, a) =>
            (i &&
            o.bounds[0] - a[i - 1].bounds[2] > o.size * 0.2 &&
            !/[\u2e80-\u9fff\uff00-\uffef]$/.test(a[i - 1].text) &&
            !/^[\u2e80-\u9fff\uff00-\uffef]/.test(o.text)
              ? " "
              : "") + o.text.replace(/[\r\n]+/g, ""),
        )
        .join("");
    let text = "";
    for (const row of p.rows) {
      const t = lineText(row);
      text +=
        (text && /[A-Za-z0-9]$/.test(text) && /^[A-Za-z0-9]/.test(t)
          ? " "
          : "") + t;
    }
    return {
      id: "paragraph-" + i,
      text,
      sources: source.map((o) => ({ index: o.index, signature: o.signature })),
      bounds,
      size: source[0].size,
      frame: {
        x: bounds[0],
        y: Math.max(0, pageHeight - bounds[3]),
        width: bounds[2] - bounds[0] + 1,
        height: Math.min(
          pageHeight - (pageHeight - bounds[3]),
          bounds[3] - bounds[1] + source[0].size * 0.5,
        ),
      },
    };
  });
}
export function mergeCandidates(candidates, pageWidth, pageHeight) {
  const sorted = [...candidates].sort((a, b) => {
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

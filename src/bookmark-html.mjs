import { validate, depths } from "./model.mjs";
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// Standalone, script-free outline. Relative links work beside the source PDF.
export function bookmarkHTML(nodes, sourceName, labels = {}) {
  validate(nodes);
  const name = String(sourceName).split(/[\\/]/).pop() || "document.pdf";
  const file = "./" + encodeURIComponent(name).replace(/'/g, "%27");
  const levels = depths(nodes),
    parts = [];
  let previous = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i],
      level = levels.get(n.id);
    if (!i) parts.push("<ol>");
    else if (level > previous) parts.push("<ol>");
    else {
      parts.push("</li>");
      for (let d = previous; d > level; d--) parts.push("</ol></li>");
    }
    const style = `color:${n.color};font-weight:${n.bold ? 700 : 400};font-style:${n.italic ? "italic" : "normal"}`;
    const text = esc(n.title),
      page = n.target.page;
    const local = Number.isInteger(page) && page > 0 && !n.target.external;
    parts.push(
      `<li><span style="${style}">${local ? `<a href="${esc(file)}#page=${page}">${text}</a>` : text}</span>${local ? `<small> ${esc(labels.page || "Page")} ${page}</small>` : ""}`,
    );
    previous = level;
  }
  if (nodes.length) {
    parts.push("</li>");
    for (let d = previous; d > 0; d--) parts.push("</ol></li>");
    parts.push("</ol>");
  }
  return `<!doctype html><html lang="${esc(labels.lang || "en")}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:70rem;margin:3rem auto;padding:0 1.5rem}ol{padding-left:1.6rem}li{margin:.4rem 0;overflow-wrap:anywhere}a{color:inherit}small{color:#667085}h1{overflow-wrap:anywhere}@media print{a{text-decoration:none}}</style><h1>${esc(name)}</h1><p>${esc(labels.help || "Place this HTML file beside the named PDF. Links open local page destinations; external and unresolved actions are shown as text.")}</p>${parts.join("")}</html>`;
}

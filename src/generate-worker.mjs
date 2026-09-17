import { generateRules } from "./generation.mjs";
import { makeNode, validate } from "./model.mjs";
onmessage = (e) => {
  try {
    if (e.data.mode === "multi") {
      postMessage(generateRules(e.data));
      return;
    }
    const { lines, mode, minSize, pattern, maxLevels, pageCount } = e.data,
      nodes = [],
      parents = [],
      sizes = [
        ...new Set(
          lines
            .filter((l) => l.size >= minSize)
            .map((l) => Math.round(l.size * 2) / 2),
        ),
      ]
        .sort((a, b) => b - a)
        .slice(0, maxLevels);
    let re = mode === "regex" ? new RegExp(pattern, "u") : null;
    for (const l of lines) {
      if (l.text.length > 240 || l.text.trim().length < 2) continue;
      let depth = 0;
      if (mode === "font") {
        if (l.size < minSize) continue;
        depth = Math.max(0, sizes.indexOf(Math.round(l.size * 2) / 2));
        if (!sizes.includes(Math.round(l.size * 2) / 2)) continue;
      } else {
        if (!re.test(l.text)) continue;
        const m = l.text.match(/^(\d+(?:\.\d+)*)[\s、.]/);
        depth = m ? m[1].split(".").length - 1 : 0;
      }
      depth = Math.min(depth, parents.length, maxLevels - 1);
      const n = makeNode(l.text, l.page, depth ? parents[depth - 1] : null);
      n.target.args = [l.x, l.y + Math.max(2, l.size), null];
      parents.length = depth;
      parents.push(n.id);
      nodes.push(n);
    }
    postMessage({ nodes: validate(nodes, pageCount) });
  } catch (err) {
    postMessage({ error: err.message });
  }
};

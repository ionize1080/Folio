// Turns the many client rects of a text selection into one clean, non-overlapping band per line.
// getClientRects() returns nested duplicates and rects whose heights differ between Latin and CJK
// runs; highlighting them one by one stacks translucent colour (darker patches) and leaves seams.
export function selectionLineRects(rects, { gapRatio = 1.5, lineGapRatio = 0.9 } = {}) {
  const input = rects
    .filter((r) => r && r.right - r.left > 0 && r.bottom - r.top > 0)
    .map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
  if (!input.length) return [];
  // 1. Group rects into lines by vertical overlap with the line's current extent.
  input.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines = [];
  for (const r of input) {
    const h = r.bottom - r.top;
    const line = lines.find((l) => {
      const overlap = Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top);
      return overlap > Math.min(h, l.bottom - l.top) * 0.5;
    });
    if (line) {
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
      line.items.push(r);
    } else lines.push({ top: r.top, bottom: r.bottom, items: [r] });
  }
  // 2. Within a line, union horizontally; a selection is contiguous, so only a big gap splits it.
  const out = [];
  for (const line of lines) {
    const h = line.bottom - line.top;
    const items = line.items.sort((a, b) => a.left - b.left);
    let cur = null;
    for (const r of items) {
      if (cur && r.left <= cur.right + h * gapRatio) cur.right = Math.max(cur.right, r.right);
      else out.push((cur = { left: r.left, right: r.right, top: line.top, bottom: line.bottom }));
    }
  }
  // 3. Make adjacent lines meet at their midpoint so the band is continuous and never overlaps.
  const byTop = [...out].sort((a, b) => a.top - b.top);
  for (let i = 0; i < byTop.length; i++) {
    for (let j = i + 1; j < byTop.length; j++) {
      const a = byTop[i], b = byTop[j];
      if (b.top >= a.bottom + (a.bottom - a.top) * lineGapRatio) break;
      if (b.right <= a.left || b.left >= a.right) continue;
      if (b.top < a.top + (a.bottom - a.top) * 0.5) continue; // same line, handled above
      const mid = (a.bottom + b.top) / 2;
      a.bottom = mid;
      b.top = mid;
    }
  }
  return out;
}

// Read only the selected glyphs on this page. Block and canvas client rects can cover a whole page.
export function selectedPageBands(range, textLayer, bounds) {
  if (!range.intersectsNode(textLayer)) return { text: "", bands: [] };
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  const piece = document.createRange(), rects = [], fragments = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    piece.selectNodeContents(node);
    if (node === range.startContainer) piece.setStart(node, range.startOffset);
    if (node === range.endContainer) piece.setEnd(node, range.endOffset);
    if (piece.collapsed) continue;
    fragments.push(piece.toString());
    for (const rect of piece.getClientRects()) {
      const left = Math.max(bounds.left, rect.left), right = Math.min(bounds.right, rect.right);
      const top = Math.max(bounds.top, rect.top), bottom = Math.min(bounds.bottom, rect.bottom);
      if (right > left && bottom > top) rects.push({ left, right, top, bottom });
    }
  }
  return { text: fragments.join("").trim().slice(0, 400), bands: selectionLineRects(rects) };
}

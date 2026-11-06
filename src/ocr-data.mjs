// Index immutable result versions once. Mutable drafts intentionally bypass the cache.
const indexes = new WeakMap();
export function pendingOCRReview(block) {
  return !block.excluded && block.needsReview && !block.corrected && !block.reviewAccepted && block.reviewSkipped !== true;
}
export function correctOCRBlocks(source, corrections = []) {
  if (!Array.isArray(corrections)) throw Error("文字修正无效");
  const blocks = structuredClone(source), seen = new Set();
  for (const correction of corrections) {
    const index = correction?.index, block = blocks[index];
    if (!Number.isInteger(index) || index < 0 || !block || seen.has(index) ||
      (correction.excluded !== undefined && typeof correction.excluded !== 'boolean') ||
      (correction.excluded !== true && (typeof correction.text !== 'string' || correction.text.length > 32768)))
      throw Error("文字修正无效");
    seen.add(index);
    if (correction.excluded === true) { block.excluded = true; continue; }
    block.originalText ??= block.text;
    block.text = correction.text;
    block.corrected = true;
    block.reviewAccepted = true;
  }
  return blocks;
}
export function ocrPage(blocks = [], page) {
  if (!Object.isFrozen(blocks)) return blocks.filter((b) => b.page === page);
  let index = indexes.get(blocks);
  if (!index) {
    index = new Map();
    for (const b of blocks) {
      if (!index.has(b.page)) index.set(b.page, []);
      index.get(b.page).push(b);
    }
    for (const group of index.values()) Object.freeze(group);
    indexes.set(blocks, index);
  }
  return index.get(page) || [];
}

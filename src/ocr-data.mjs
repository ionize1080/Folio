// Index immutable result versions once. Mutable drafts intentionally bypass the cache.
const indexes = new WeakMap();
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

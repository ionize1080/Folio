export const paperSizes = Object.freeze({
  A3: [841.8898, 1190.5512], A4: [595.2756, 841.8898], A5: [419.5276, 595.2756],
  B5: [498.8976, 708.6614], Letter: [612, 792], Legal: [612, 1008],
});
export const unitScale = Object.freeze({pt: 1, mm: 72 / 25.4, in: 72});

// Resolve every field before mutating the organizer so invalid input is atomic.
export function blankPagePlan(options, pageCount, referenceSize) {
  const count = Number(options.count), page = Number(options.page);
  if (!Number.isInteger(count) || count < 1 || count > 1000 || pageCount + count > 100000)
    throw Error('空白页数量应为 1–1000，文档最多 100000 页');
  if (!Number.isInteger(page) || page < 1 || page > pageCount)
    throw Error('插入目标页码超出范围');
  if (!['before', 'after'].includes(options.position)) throw Error('请选择插入位置');
  let size;
  if (options.mode === 'standard') size = paperSizes[options.paper];
  else if (options.mode === 'custom') {
    const scale = unitScale[options.unit];
    size = scale && [Number(options.width) * scale, Number(options.height) * scale];
  } else if (['position', 'page'].includes(options.mode)) size = referenceSize;
  if (!Array.isArray(size) || size.length !== 2 || !size.every(v => Number.isFinite(v) && v >= 1 && v <= 14400))
    throw Error('页面宽高应为 1–14400 pt');
  let [width, height] = size;
  if (options.orientation === 'portrait') [width, height] = [Math.min(width, height), Math.max(width, height)];
  else if (options.orientation === 'landscape') [width, height] = [Math.max(width, height), Math.min(width, height)];
  else if (options.orientation !== 'keep') throw Error('请选择页面方向');
  return {count, at: page - 1 + (options.position === 'after' ? 1 : 0), width, height};
}

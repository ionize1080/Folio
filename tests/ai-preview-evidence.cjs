const assert = require('node:assert/strict');

function validateImagePreviewIteration(trace) {
  // Tool errors and target-selection replies are recoverable attempts, not
  // visual evidence. Keep them in the original trace for diagnostics.
  const previews = trace.filter(t => t.name === 'folio_image' &&
    t.arguments?.action === 'preview' && !t.error && Array.isArray(t.images) &&
    t.images.some(image => typeof image.mime === 'string' && image.mime.startsWith('image/') &&
      Number.isInteger(image.bytes) && image.bytes > 0));
  assert(previews.length >= 2, 'At least two successful image previews must return actual image content');

  let overview = false, detail = false;
  for (const preview of previews) {
    assert(Array.isArray(preview.dimensions) && preview.dimensions.length === 2 &&
      preview.dimensions.every(n => Number.isInteger(n) && n > 0 && n <= 1200),
    'Every successful image preview must have positive integer dimensions within 1200 pixels');
    const region = preview.arguments.region ?? [0, 0, 1, 1];
    assert(Array.isArray(region) && region.length === 4 &&
      region.every(n => Number.isFinite(n) && n >= 0 && n <= 1) &&
      region[2] > 0 && region[3] > 0 &&
      region[0] + region[2] <= 1.000001 && region[1] + region[3] <= 1.000001,
    'Successful image preview region must be a valid normalized rectangle');
    if (region[0] === 0 && region[1] === 0 && region[2] === 1 && region[3] === 1) overview = true;
    else detail = true;
  }
  assert(overview && detail, 'Successful image previews must include both an overview and a cropped detail');
  return previews;
}

module.exports = { validateImagePreviewIteration };

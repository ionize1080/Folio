import test from 'node:test';
import assert from 'node:assert/strict';
import evidence from './ai-preview-evidence.cjs';
const { validateImagePreviewIteration } = evidence;

const crop = [0.1, 0.2, 0.4, 0.3];
function preview(region, overrides = {}) {
  return { name: 'folio_image', arguments: { action: 'preview', ...(region ? { region } : {}) },
    images: [{ mime: 'image/png', bytes: 4096 }], dimensions: [640, 426], ...overrides };
}

test('failed preview attempts can recover without counting as visual evidence or losing diagnostics', () => {
  const trace = [
    preview(undefined, { error: 'Image unavailable', images: [], dimensions: undefined }),
    preview(crop, { error: 'Image unavailable', images: [], dimensions: undefined }),
    preview(crop, { error: 'Image unavailable', images: [], dimensions: undefined }),
    preview(), preview(crop, { images: [{ mime: 'image/jpeg', bytes: 8192 }], dimensions: [1200, 900] }),
  ];
  const original = structuredClone(trace);
  assert.deepEqual(validateImagePreviewIteration(trace), trace.slice(3));
  assert.deepEqual(trace, original);
});

test('all failed attempts cannot satisfy preview coverage even if they contain image metadata', () => {
  assert.throws(() => validateImagePreviewIteration([
    preview(undefined, { error: 'Image unavailable' }), preview(crop, { error: 'Image unavailable' }),
  ]), /At least two successful/);
});

test('missing or empty image content and unrelated tool calls cannot count as successful previews', () => {
  for (const images of [undefined, [], [{ mime: 'text/plain', bytes: 100 }], [{ mime: 'image/png', bytes: 0 }]]) {
    assert.throws(() => validateImagePreviewIteration([preview(), preview(crop, { images })]), /At least two successful/);
  }
  assert.throws(() => validateImagePreviewIteration([
    preview(), preview(crop, { name: 'folio_render' }),
    preview(crop, { arguments: { action: 'apply', region: crop } }),
  ]), /At least two successful/);
});

test('successful overview and cropped detail are both required; failed detail attempts do not count', () => {
  assert.throws(() => validateImagePreviewIteration([preview(), preview([0, 0, 1, 1])]), /both an overview and a cropped detail/);
  assert.throws(() => validateImagePreviewIteration([preview(crop), preview(crop)]), /both an overview and a cropped detail/);
  assert.throws(() => validateImagePreviewIteration([
    preview(), preview(), preview(crop, { error: 'Image unavailable' }),
  ]), /both an overview and a cropped detail/);
  assert.equal(validateImagePreviewIteration([preview([0, 0, 1, 1]), preview(crop)]).length, 2);
});

test('every successful preview needs exactly two positive integer dimensions', () => {
  for (const dimensions of [undefined, [], [640], [640, 426, 1], [0, 426], [-1, 426],
    [640.5, 426], [NaN, 426], [Infinity, 426], ['640', 426]]) {
    assert.throws(() => validateImagePreviewIteration([
      preview(), preview(crop), preview(crop, { dimensions }),
    ]), /positive integer dimensions/);
  }
});

test('oversized successful previews fail instead of being filtered out', () => {
  for (const dimensions of [[1201, 800], [800, 1201]]) {
    assert.throws(() => validateImagePreviewIteration([
      preview(), preview(crop), preview(crop, { dimensions }),
    ]), /within 1200 pixels/);
  }
  assert.equal(validateImagePreviewIteration([preview(), preview(crop, { dimensions: [1200, 1200] })]).length, 2);
});

test('a truthy malformed region cannot masquerade as cropped visual evidence', () => {
  for (const region of [[], [0, 0, 0, 1], [0, 0, 1, -0.5], [0.8, 0, 0.4, 1], ['0', 0, 0.5, 1]]) {
    assert.throws(() => validateImagePreviewIteration([preview(), preview(region)]), /valid normalized rectangle/);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {pageCandidates} from '../src/flow-page-model.mjs';

test('editable runs on either side of a raised footnote retain measured column width', () => {
  const row = (index, text, x, y, right, size, extra) => ({
    index, text, type: 'text', size, flowEditable: true, editable: true,
    signature: String(index), fontKey: 'test', fontName: 'Regular',
    matrix: [1, 0, 0, 1, x, 800 - y], bounds: [x, 798 - y, right, 808 - y], ...extra,
  });
  const rows = [
    row(0, 'First part of the tagged paragraph', 40, 100, 235, 10, {structureOwner: 0, structureParagraph: 0}),
    row(1, '1', 236, 97, 240, 6, {}),
    row(2, 'Remaining part of the same paragraph.', 40, 116, 248, 10, {structureOwner: 0, structureParagraph: 1}),
    row(3, 'Independent paragraph.', 310, 100, 480, 10, {structureOwner: 1, structureParagraph: 2}),
  ];
  const models = pageCandidates(rows, 600, 800).map(c => c.model);
  const before = models.find(m => m.text === rows[0].text);
  assert.deepEqual(before.sources.map(s => s.index), [0]);
  assert.equal(before.frame.x + before.frame.width, 248);
  assert.ok(models.some(m => m.text === '1' && m.sources.length === 1));
});

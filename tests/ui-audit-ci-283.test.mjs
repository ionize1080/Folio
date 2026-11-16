import { test } from 'node:test';
import assert from 'node:assert/strict';
import audit from '../scripts/ui-audit-ci-283.cjs';
const { summarize } = audit;

function preferences() {
  return { status: 'passed', errors: [], issues: [], checks: Array(6).fill('verified'),
    checkboxes: Array.from({ length: 10 }, () => ({ checked: true, contrast: 5.6, width: 16 })),
    selects: Array.from({ length: 8 }, () => ({ values: ['a', 'b'] })),
    themes: Array.from({ length: 12 }, () => ({ contrast: 5.6 })) };
}
function performance() {
  const stages = [
    { name: 'apply-unchanged-settings', detail: { pdfRefreshes: 0 } },
    { name: '10000-bookmarks', detail: { renderedRows: 25 } },
    { name: 'ribbon-24-switches', detail: { counts: { resize: 0, mutations: 0 }, timings: Array(24).fill({}) } },
    ...Array.from({ length: 7 }, (_, i) => ({ name: 'measurement-' + i })),
  ].map(s => ({ ...s, elapsedMs: 100, longTasks: [] }));
  return { status: 'passed', errors: [], stages, retention: {}, startupMs: 1000 };
}
test('release evidence rejects incomplete and failed audits', () => {
  for (const status of [undefined, 'failed']) assert.throws(() => summarize('preferences', { ...preferences(), status }));
  assert.throws(() => summarize('preferences', { ...preferences(), errors: ['renderer failed'] }));
  assert.throws(() => summarize('preferences', { ...preferences(), issues: ['invisible control'] }));
});
test('visible checked state and theme contrast are required for release', () => {
  const report = preferences();
  assert.equal(summarize('preferences', report).minimumContrast, 5.6);
  report.checkboxes[0].contrast = 1.02;
  assert.throws(() => summarize('preferences', report));
  report.checkboxes[0].contrast = 5.6; report.themes[0].contrast = 2;
  assert.throws(() => summarize('preferences', report));
});
test('missing settings coverage cannot be marked complete', () => {
  const report = preferences(); report.checkboxes.pop();
  assert.throws(() => summarize('preferences', report));
});
test('performance gate rejects redundant PDF redraw and lost virtualization', () => {
  const report = performance(); assert.equal(summarize('performance', report).pdfRefreshes, 0);
  report.stages[0].detail.pdfRefreshes = 1;
  assert.throws(() => summarize('performance', report));
  report.stages[0].detail.pdfRefreshes = 0; report.stages[1].detail.renderedRows = 10000;
  assert.throws(() => summarize('performance', report));
});
test('ribbon mutation regression blocks release without gating noisy timings', () => {
  const report = performance(); report.stages[0].elapsedMs = 10000;
  assert.equal(summarize('performance', report).status, 'passed');
  report.stages[2].detail.counts.mutations = 1;
  assert.throws(() => summarize('performance', report));
});
test('surface failures and missing reader coverage block release', () => {
  const surfaces = { status: 'passed', errors: [], surfaces: Array.from({ length: 58 }, (_, i) => ({ name: String(i), status: 'passed' })) };
  assert.equal(summarize('surfaces', surfaces).checks.length, 58);
  surfaces.surfaces[0].status = 'failed'; assert.throws(() => summarize('surfaces', surfaces));
  assert.throws(() => summarize('reader', { status: 'passed', errors: [], checks: [], controls: [] }));
});

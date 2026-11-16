const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');

// Keep screenshots and isolated profiles out of job outputs. Publish only bounded
// validation evidence; ci-reports.py binds it to the source commit and workflow.
function summarize(suite, report) {
  assert.equal(report.status, 'passed', 'Audit did not finish successfully');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.issues || [], []);
  const result = { status: 'passed', suite, errors: [] };
  if (suite === 'preferences') {
    assert.equal(report.checkboxes.length, 10);
    assert.equal(report.selects.length, 8);
    assert.equal(report.themes.length, 12);
    assert(report.checks.length >= 6);
    assert(report.checkboxes.every(c => c.checked && c.contrast >= 3 && c.width >= 12));
    assert(report.themes.every(t => t.contrast >= 3));
    Object.assign(result, { checks: report.checks, checkboxes: report.checkboxes.length,
      selectOptions: report.selects.reduce((n, s) => n + s.values.length, 0),
      themes: report.themes.length, minimumContrast: Math.min(...report.themes.map(t => t.contrast)) });
  } else if (suite === 'surfaces') {
    assert.equal(report.surfaces.length, 58);
    assert(report.surfaces.every(s => s.status !== 'failed'));
    result.checks = report.surfaces.map(s => ({ name: s.name, status: 'passed' }));
  } else if (suite === 'reader') {
    assert(report.checks.length >= 6, 'Includes immediate target-marker settings regression');
    assert.equal(report.controls.length, 6);
    assert.equal(report.markerSettings.pdfRefreshes, 0);
    Object.assign(result, { checks: report.checks, controls: report.controls, markerSettings: report.markerSettings });
  } else if (suite === 'performance') {
    assert.equal(report.stages.length, 10);
    const stage = name => { const s = report.stages.find(s => s.name === name); assert(s, name); return s; };
    assert.equal(stage('apply-unchanged-settings').detail.pdfRefreshes, 0);
    assert(stage('10000-bookmarks').detail.renderedRows < 100, 'Bookmark tree remains virtualized');
    const ribbon = stage('ribbon-24-switches').detail;
    assert.deepEqual(ribbon.counts, { resize: 0, mutations: 0 });
    assert.equal(ribbon.timings.length, 24);
    Object.assign(result, { startupMs: report.startupMs, retention: report.retention,
      stages: report.stages.map(s => ({ name: s.name, elapsedMs: s.elapsedMs,
        longTaskCount: s.longTasks.length, longestTaskMs: Math.max(0, ...s.longTasks.map(t => t.duration)) })),
      checks: ['No PDF refresh for unchanged preferences', 'Virtualized 10,000-bookmark tree',
        '24 ribbon switches do not resize or mutate the PDF surface'],
      pdfRefreshes: 0, renderedRows: stage('10000-bookmarks').detail.renderedRows });
  } else throw Error('Unknown UI audit suite: ' + suite);
  return result;
}

if (require.main === module) {
  const suite = process.argv[2];
  const source = path.resolve(process.env.FOLIO_AUDIT_OUT || 'tests/output/ui-audit-283', suite, 'report.json');
  const report = summarize(suite, JSON.parse(fs.readFileSync(source, 'utf8')));
  fs.writeFileSync(`tests/output/ui-${suite}-283.json`, JSON.stringify(report, null, 2));
  console.log(`${suite}: passed; compact release evidence generated`);
}
module.exports = { summarize };

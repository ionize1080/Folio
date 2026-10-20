// Keep preview operations, committed final states and re-open edits separate.
const fs = require("node:fs"), path = require("node:path");
const source = path.resolve(process.argv[2] || path.join(__dirname, "output/packaged-deep-v191/report.json"));
const report = JSON.parse(fs.readFileSync(source, "utf8"));
const targets = report.pages.flatMap(page => page.targets.map(target => ({...target, page: page.id})));
const operations = targets.flatMap(target => target.operations.map(operation => ({...operation, page: target.page, position: target.position})));
const summarize = values => {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b), n = sorted.length;
  if (!n) return {n:0};
  const percentile = p => sorted[Math.max(0,Math.ceil(n*p)-1)];
  const median = n % 2 ? sorted[(n-1)/2] : (sorted[n/2-1]+sorted[n/2])/2;
  return {n,min:sorted[0],median,p95:percentile(.95),max:sorted[n-1]};
};
const latency = entries => ({
  fastMs:summarize(entries.map(o=>o.inputToFastMs)),
  preciseMs:summarize(entries.map(o=>o.inputToPreciseMs)),
  missingFast:entries.filter(o=>!Number.isFinite(o.inputToFastMs)).length,
  missingPrecise:entries.filter(o=>!Number.isFinite(o.inputToPreciseMs)).length,
});
const verified = entry => entry?.exactPageCharacters && entry?.adjacentPagePixelsUnchanged &&
  ["MuPDF", "PDFium"].every(engine => entry.glyphGeometry?.[engine]?.checkedHanGlyphs > 0 && entry.glyphGeometry[engine].collapsedPairCount === 0) &&
  entry.styleAudit?.retainedCharacters > 0 &&
  ["boldDifferences", "italicDifferences", "sizeDifferences", "outlineDifferences"].every(key=>entry.styleAudit[key]===0);
const styleSummary = entries => Object.fromEntries([
  "retainedCharacters", "boldCharacters", "italicCharacters", "boldDifferences", "italicDifferences",
  "sizeDifferences", "outlineCharacters", "outlineUnavailableCharacters", "outlineDifferences",
].map(key=>[key,entries.reduce((sum,entry)=>sum+(entry?.styleAudit?.[key]||0),0)]));
const labels = ["insert-short","insert-long","delete-long","delete-short","undo","redo","reopened-delete"];
const byOperation = Object.fromEntries(labels.map(label => {
  const entries=operations.filter(o=>o.label===label);
  return [label,{count:entries.length,statusErrors:entries.filter(o=>o.statusError).length,
    warnings:entries.filter(o=>o.warning).map(o=>({page:o.page,position:o.position,message:o.warning})),
    preciseFailures:entries.filter(o=>/精排未通过|精排暂不可用/.test(o.refineText||"")).length,
    otherNonReady:entries.filter(o=>!/预览精排|精排未通过|精排暂不可用/.test(o.refineText||"")).length,
    ...latency(entries)}];
}));
const summary = {
  source, startedAt:report.startedAt, finishedAt:report.finishedAt, runtime:report.runtime,
  exeSha256:report.exeSha256, asarSha256:report.asarSha256, nativeSha256:report.nativeSha256, timingEnvironment:report.timingEnvironment,
  pages:report.pages.map(p=>({id:p.id,status:p.status,positions:p.targets.length})),
  targets:{count:targets.length,passed:targets.filter(t=>t.status==="passed").length,failed:targets.filter(t=>t.status==="failed").map(t=>({page:t.page,position:t.position,error:t.error}))},
  typedOperations:latency(operations.filter(o=>labels.slice(0,4).includes(o.label))),
  byOperation, coldEntry:latency(targets.map(t=>t.activate||{})),warmEntry:latency(targets.filter(t=>t.warmActivation).map(t=>t.warmActivation)),
  firstSave:{verified:targets.filter(t=>verified(t.verification)).length,ms:summarize(targets.map(t=>t.saveMs)),styleAudit:styleSummary(targets.map(t=>t.verification))},
  reopenDeleteSave:{verified:targets.filter(t=>verified(t.secondVerification)).length,ms:summarize(targets.map(t=>t.secondSaveMs)),styleAudit:styleSummary(targets.map(t=>t.secondVerification))},
  rendererErrors:report.errors,
  timingValidity:{fastPreview:false,precisePreview:false,reason:"Status observations are not bound to the current edit revision. A separate foreground spot-check demonstrated capture of a stale pre-input completion state. This full run lacks status history needed to correct those measurements. Preview values are retained for audit only, not valid current-edit layout or presentation latencies."},
  timingScope:"fastMs and preciseMs are unvalidated first DOM-status observations, not current-edit layout completion or screen-pixel presentation times. The observer can capture a stale state; precision can return a failure or another non-ready state before a later preview. Missing measurements are counted separately and not replaced with zero. Entry is cold per renderer; native-worker caches may be reused across targets. Click and save intervals include automation action waits and scheduling; the window was hidden with background throttling disabled.",
  saveScope:"Long insertions are tested as previews and then deleted. First saves contain the net short insertion and short deletion; second saves contain one further deletion after reopening. This suite does not claim that long-insertion states were saved.",
};
const output=path.join(path.dirname(source),"ui-summary.json");
fs.writeFileSync(output,JSON.stringify(summary,null,2));
console.log(JSON.stringify({output,targets:summary.targets,typedOperations:summary.typedOperations,firstSave:summary.firstSave,reopenDeleteSave:summary.reopenDeleteSave},null,2));

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
  return {n,min:sorted[0],median:percentile(.5),p95:percentile(.95),max:sorted[n-1]};
};
const latency = entries => ({fastMs:summarize(entries.map(o=>o.inputToFastMs)),preciseMs:summarize(entries.map(o=>o.inputToPreciseMs))});
const labels = ["insert-short","insert-long","delete-long","delete-short","undo","redo","reopened-delete"];
const byOperation = Object.fromEntries(labels.map(label => {
  const entries=operations.filter(o=>o.label===label);
  return [label,{count:entries.length,errors:entries.filter(o=>o.statusError).length,
    warnings:entries.filter(o=>o.warning).map(o=>({page:o.page,position:o.position,message:o.warning})),
    preciseFailures:entries.filter(o=>/精排未通过|精排暂不可用/.test(o.refineText||"")).length,...latency(entries)}];
}));
const summary = {
  source, startedAt:report.startedAt, finishedAt:report.finishedAt, runtime:report.runtime,
  exeSha256:report.exeSha256, asarSha256:report.asarSha256, timingEnvironment:report.timingEnvironment,
  pages:report.pages.map(p=>({id:p.id,status:p.status,positions:p.targets.length})),
  targets:{count:targets.length,passed:targets.filter(t=>t.status==="passed").length,failed:targets.filter(t=>t.status==="failed").map(t=>({page:t.page,position:t.position,error:t.error}))},
  typedOperations:latency(operations.filter(o=>labels.slice(0,4).includes(o.label))),
  byOperation, coldEntry:latency(targets.map(t=>t.activate||{})),warmEntry:latency(targets.map(t=>t.warmActivation||{})),
  firstSave:{verified:targets.filter(t=>t.verification?.exactPageCharacters&&t.verification?.adjacentPagePixelsUnchanged).length,ms:summarize(targets.map(t=>t.saveMs))},
  reopenDeleteSave:{verified:targets.filter(t=>t.secondVerification?.exactPageCharacters&&t.secondVerification?.adjacentPagePixelsUnchanged).length,ms:summarize(targets.map(t=>t.secondSaveMs))},
  rendererErrors:report.errors,
  saveScope:"Long insertions are tested as previews and then deleted. First saves contain the net short insertion and short deletion; second saves contain one further deletion after reopening. This suite does not claim that long-insertion states were saved.",
};
const output=path.join(path.dirname(source),"ui-summary.json");
fs.writeFileSync(output,JSON.stringify(summary,null,2));
console.log(JSON.stringify({output,targets:summary.targets,typedOperations:summary.typedOperations,firstSave:summary.firstSave,reopenDeleteSave:summary.reopenDeleteSave},null,2));

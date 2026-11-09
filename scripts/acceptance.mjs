import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const manifest = JSON.parse(
  readFileSync(new URL("./acceptance.json", import.meta.url)),
);
const mode = process.argv[2] || "quick";
const stages = mode === "full" ? ["quick", "native", "browser"] : [mode];
const shard=process.env.FOLIO_TEST_SHARD?.match(/^([1-9]\d*)\/([1-9]\d*)$/);
if(process.env.FOLIO_TEST_SHARD&&(!shard||+shard[1]>+shard[2]||+shard[2]>32))throw Error('FOLIO_TEST_SHARD must be index/count, 1–32');
for (const stage of stages) {
  if (!manifest[stage]) throw Error("Unknown acceptance stage: " + stage);
  const cases=manifest[stage].filter((_,i)=>!shard||i % +shard[2]===+shard[1]-1),checks=[];
  for (const item of cases) {
    const started=Date.now();
    console.log("Acceptance:", item.capability);
    const command =
      item.runtime === "node"
        ? process.execPath
        : process.env.FOLIO_PYTHON ||
          process.env.CODEX_PRIMARY_RUNTIME_PYTHON ||
          (process.platform === "win32" ? "python" : "python3");
    let args = [
      ...item.args,
      ...(item.unitGlob
        ? readdirSync("tests")
            .filter((n) => n.endsWith(".test.mjs"))
            .map((n) => "tests/" + n)
        : []),
    ];
    if (item.runtime === "python" && args[0]?.endsWith(".py")) {
      // Embedded Python uses isolated paths; make sibling test helpers
      // available just as they are with a regular Python script invocation.
      args = [
        "-c",
        "import os,sys,runpy;sys.argv=sys.argv[1:];sys.path.insert(0,os.path.join(os.getcwd(),'native','vendor'));sys.path.insert(0,os.path.dirname(os.path.abspath(sys.argv[0])));runpy.run_path(sys.argv[0],run_name='__main__')",
        ...args,
      ];
    }
    const p = spawnSync(command, args, { stdio: "inherit" });
    if (p.error) throw p.error;
    checks.push({capability:item.capability,args:item.args,status:p.status===0?'passed':'failed',elapsedMs:Date.now()-started});
  }
  mkdirSync('tests/output',{recursive:true});
  const report={status:checks.every(c=>c.status==='passed')?'passed':'failed',stage,shard:shard?+shard[1]:1,shards:shard?+shard[2]:1,totalCases:manifest[stage].length,checks};
  writeFileSync(`tests/output/${stage}${shard?'-'+shard[1]:''}-regression-report.json`,JSON.stringify(report,null,2));
  if(report.status!=='passed')process.exitCode=1;
}

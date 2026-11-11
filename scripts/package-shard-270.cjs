const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const groups=[
 // Keep the long embedded-editor sweep independent. Balance the other jobs
 // using measured package acceptance durations; keep workflow verification
 // immediately after the workflow that produces its PDF.
 ['creative-embedded.cjs'],
 ['design-251.cjs','organizer-ui.cjs','printing-270.cjs','workbench-ui.cjs','engineering-ui.cjs','studio-canvas-270.cjs','close-251.cjs','conversion-scan.cjs','pdf-loading-packaged.cjs'],
 ['refinements-251.cjs','creative-ui.cjs','graphics-220.cjs','selection-270.cjs','package-ai.cjs','organizer-geometry.cjs','export-review-251.cjs'],
 ['creative-experience.cjs','creative-engines.cjs','image-provider-settings.cjs','workflow-250.cjs','workflow-250-verify.py','workspace-210.cjs','studio-270-ui.cjs','image-studio-ui.cjs'],
];
async function main(){const shard=Number(process.argv[2]);if(!Number.isInteger(shard)||!groups[shard-1])throw Error('Invalid package shard');if(!process.env.FOLIO_EXE)throw Error('Packaged executable is required');
 const checks=[];for(const name of groups[shard-1]){const start=Date.now(),task='tests/'+name,python=process.env.FOLIO_PYTHON||path.resolve('native/runtime/python.exe');const p=spawnSync(name.endsWith('.py')?python:process.execPath,[task],{stdio:'inherit',windowsHide:true,env:process.env,timeout:name==='creative-embedded.cjs'?1200000:600000});checks.push({task,status:!p.error&&p.status===0?'passed':'failed',elapsedMs:Date.now()-start});}
 const file='deliverables/Folio-PDF-Studio-2.7.0-portable-win-x64.zip',hash=createHash('sha256');for await(const b of fs.createReadStream(file))hash.update(b);
 const status=checks.every(c=>c.status==='passed')?'passed':'failed';fs.writeFileSync(`tests/output/packaged-${shard}-270.json`,JSON.stringify({status,shard,checks,sourceCommit:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,packageSha256:hash.digest('hex')}));if(status!=='passed')process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});module.exports={groups};

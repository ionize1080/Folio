const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const lanes=[['tests/workspace-210.cjs','tests/graphics-220.cjs','tests/package-ai.cjs','tests/creative-engines.cjs','tests/creative-embedded.cjs'],['tests/workbench-ui.cjs','tests/engineering-ui.cjs','tests/conversion-scan.cjs','tests/creative-ui.cjs','tests/organizer-ui.cjs']];
async function runLanes(groups,execute){
  if(!Array.isArray(groups)||groups.length<1||groups.length>2)throw Error('At most two isolated application lanes are allowed');
  const rows=[];
  await Promise.all(groups.map(async(group,lane)=>{
    for(const task of group){const start=Date.now();let error;
      try{await execute(task,lane);}catch(e){error=String(e.message||e);}
      rows.push({task,lane,status:error?'failed':'passed',elapsedMs:Date.now()-start,...(error?{error}:{})});
    }
  }));
  return {status:rows.every(r=>r.status==='passed')?'passed':'failed',maxParallel:2,checks:rows};
}
function execute(task,lane){return new Promise((resolve,reject)=>{
  const file=path.resolve('tests/output/ci-'+path.basename(task)+'.log');
  const log=fs.openSync(file,'w');
  const child=spawn(process.execPath,[task],{env:process.env,windowsHide:true,stdio:['ignore',log,log]});
  fs.closeSync(log);let timedOut=false,launchError;
  const timer=setTimeout(()=>{timedOut=true;if(process.platform==='win32'&&child.pid)spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();},360000);
  child.on('error',e=>{launchError=e;});
  child.on('close',code=>{clearTimeout(timer);const ok=!launchError&&!timedOut&&code===0;
    console.log((ok?'PASS ':'FAIL ')+task+' (lane '+lane+')');
    const output=fs.readFileSync(file,'utf8');
    console.log(ok?output.split(/\r?\n/).filter(l=>/^PASS|^OCR incremental/.test(l)).join('\n'):output.slice(-12000));
    ok?resolve():reject(launchError||Error(timedOut?'Test process tree timed out':`Exit ${code}: ${task}`));
  });
});}
if(require.main===module){
  if(!process.env.FOLIO_EXE)throw Error('Packaged checks require FOLIO_EXE');
  fs.mkdirSync('tests/output',{recursive:true});
  const heartbeat=setInterval(()=>console.log('Packaged checks: bounded two-lane execution is active'),60000);
  runLanes(lanes,execute).then(report=>{
    fs.writeFileSync('tests/output/ci-packaged-report.json',JSON.stringify({...report,sourceCommit:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID},null,2));
    if(report.status!=='passed')process.exitCode=1;
  }).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>clearInterval(heartbeat));
}
module.exports={runLanes};

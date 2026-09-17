const {chromium}=require(process.env.FOLIO_PLAYWRIGHT||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');const fs=require('fs'),assert=require('assert/strict');const {makeHTML,measureOverflow}=require('../flow-layout.cjs');
(async()=>{let b;try{
 b=await chromium.launch({executablePath:process.env.FOLIO_BROWSER,headless:true,args:['--no-sandbox']});const p=await b.newPage();
 const model={pageWidth:595.28,pageHeight:841.89,frame:{x:60,y:120,width:460,height:480},text:'金融统计段落流式编辑测试，保留金额 00123.45 和百分比 3.50%。English words should wrap at word boundaries.\n第二段正文。'.repeat(8),size:12,lineHeight:1.5,columns:2,gap:20,align:'justify',color:'#202020',font:'sans'};
 const font=fs.readFileSync('native/fonts/NotoSansSC.ttf').toString('base64'),fallback=fs.readFileSync('native/fonts/DejaVuSans.ttf').toString('base64');
 const render=async(m)=>{const start=performance.now();fs.writeFileSync("tests/output/v6-layout-temp.html",makeHTML(m,font,fallback));await p.goto(require("node:url").pathToFileURL(require("node:path").resolve("tests/output/v6-layout-temp.html")).href);const stats=await p.evaluate(measureOverflow);return {...stats,elapsedMs:performance.now()-start};};
 const stats=await render(model);console.log(stats);await p.screenshot({path:"tests/output/v6-flow-layout.png",fullPage:true});assert(!stats.overflow);await p.pdf({path:'tests/output/v6-flow-fragment.pdf',printBackground:true,preferCSSPageSize:true,margin:{top:0,bottom:0,left:0,right:0},pageRanges:'1'});fs.writeFileSync('tests/output/v6-flow-model.json',JSON.stringify(model));console.log('PASS Chinese and English layout',stats);
 const overflow=await render({...model,frame:{...model.frame,height:20}});assert(overflow.overflow);console.log('PASS overflow detected');
 await render({...model,text:'中文更新。\n第三段测试。'});await p.pdf({path:'tests/output/v6-flow-short.pdf',printBackground:true,preferCSSPageSize:true});
 fs.writeFileSync('tests/output/v6-layout-report.json',JSON.stringify({browser:await b.version(),...stats,overflowBlocked:true,electronPrintTested:false},null,2));
 }finally{await b?.close();}})().catch(e=>{console.error(e);process.exitCode=1});

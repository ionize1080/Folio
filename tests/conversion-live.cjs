const {_electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 let app;const stamp=Date.now(),checks=[];
 try{
  app=await _electron.launch({args:[path.resolve('.')],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/conversion-live-'+stamp),FOLIO_CHATBOX_PROFILE:path.resolve('tests/output/conversion-chat-'+stamp)},timeout:60000});
  const host=await app.firstWindow();host.on('dialog',d=>d.accept());await host.waitForSelector('#document-utilities',{state:'attached'});
  await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root+'/conversion-table.pdf']});dialog.showSaveDialog=async(_win,o)=>({canceled:false,filePath:root+'/live-conversion-table-pdfa.pdf'});},path.resolve('tests/output'));
  await host.locator('[data-action="open"]').first().click();await host.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('conversion-table'));
  await host.evaluate(()=>window.desktop.aiOpen());
  const chat=app.context().pages().find(p=>p.url().includes('/renderer/index.html'));await chat.waitForSelector('textarea[placeholder]');
  const model=await require('./ai-live-support.cjs').configure(chat);
  const input=[...fs.readFileSync('tests/output/conversion-table.pdf')];
  const plan=await host.evaluate(bytes=>window.desktop.native({command:'document-utilities',action:'conversion-plan',bytes:new Uint8Array(bytes)}),input);
  const review=await host.evaluate(pages=>window.desktop.reviewConversion({kind:'office',pages}),plan.pages);
  assert(Array.isArray(review.pages));fs.writeFileSync('tests/output/conversion-live-review.json',JSON.stringify(review,null,2));
  for(const action of ['export-word','export-excel']){
   const r=await host.evaluate(({bytes,review,action})=>window.desktop.native({command:'document-utilities',action,bytes:new Uint8Array(bytes),options:{review,layout:'faithful'}}),{bytes:input,review,action});
   assert(r.aiReviewed);fs.writeFileSync('tests/output/live-conversion.'+r.extension,Buffer.from(r.bytes,'base64'));checks.push({action,metrics:r.metrics});
  }
  const typography=await host.evaluate(()=>window.desktop.reviewConversion({kind:'article',pages:{title:'Readable research',excerpt:'A long research article about accessibility, with diagrams and tables.'}}));assert(typography.fontSize>=10&&typography.fontSize<=14);checks.push({articleTypography:typography});
  if(fs.existsSync('tests/output/attention-paper.pdf')){
   const bytes=[...fs.readFileSync('tests/output/attention-paper.pdf')];const publicPlan=await host.evaluate(bytes=>window.desktop.native({command:'document-utilities',action:'conversion-plan',bytes:new Uint8Array(bytes),options:{pages:[6]}}),bytes);
   const review=await host.evaluate(pages=>window.desktop.reviewConversion({kind:'office',pages}),publicPlan.pages);
   for(const action of ['export-word','export-excel']){const r=await host.evaluate(({bytes,review,action})=>window.desktop.native({command:'document-utilities',action,bytes:new Uint8Array(bytes),options:{pages:[6],review,layout:'faithful'}}),{bytes,review,action});assert(r.aiReviewed);assert((r.metrics.textCoverage??r.metrics.sourceCoverage)>=.98);if(action==='export-excel')assert(r.metrics.tables>=1,'AI must reconstruct the public borderless comparison table');fs.writeFileSync('tests/output/live-public-research.'+r.extension,Buffer.from(r.bytes,'base64'));checks.push({publicResearch:action,metrics:r.metrics});}
  }
  await host.evaluate(()=>window.desktop.aiApproval(true));const before=await chat.evaluate(()=>window.folioProgress.status().completed);
  await chat.locator('textarea[placeholder]').first().fill('请用 folio_document 获取当前文档 revision，再调用 folio_document_utilities 的 pdfa 操作，将当前文档保存为 PDF/A-2b 归档副本。options.standard="2b"。这是测试样本，仅执行此转换，查看独立验证结果后停止。');await chat.locator('textarea[placeholder]').first().press('Enter');
  await chat.waitForFunction(n=>window.folioProgress.status().completed>n,before,{timeout:240000});
  const pdf=path.resolve('tests/output/live-conversion-table-pdfa.pdf');fs.writeFileSync('tests/output/conversion-live-transcript.txt',(await chat.locator('body').innerText()).slice(-18000));assert(fs.existsSync(pdf),'MCP must save PDF/A');
  const report=await host.evaluate(bytes=>window.desktop.native({command:'document-utilities',action:'validate-pdfa',bytes:new Uint8Array(bytes),options:{standard:'2b'}}),[...fs.readFileSync(pdf)]);assert(report.compliant);checks.push({mcpPdfa:true,validator:report.validator});
  const {execFileSync}=require('node:child_process');execFileSync(process.env.FOLIO_PYTHON||path.resolve('native/runtime/python.exe'),['-c',"from openpyxl import load_workbook;from docx import Document;w=load_workbook('tests/output/live-conversion.xlsx');s=w['Page 1 Table 1'];assert s['B2'].value==1200;assert s['B3'].value=='00123';assert s['A4'].value=='=1+1' and s['A4'].data_type=='s';d=Document('tests/output/live-conversion.docx');assert any(p.style.name=='Heading 1' for p in d.paragraphs)"]);
  fs.writeFileSync('tests/output/conversion-live-report.json',JSON.stringify({status:'passed',model,checks},null,2));console.log('PASS real AI Word/Excel reconstruction, article typography and MCP PDF/A');
 }finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

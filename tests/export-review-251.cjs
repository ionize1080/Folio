const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const {app,page}=await require('./creative-harness.cjs')();
 try{
  await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root+'/conversion-scan.pdf']});dialog.showSaveDialog=async(_w,o)=>({canceled:false,filePath:root+'/review-251-'+pathEnd(o.defaultPath)});function pathEnd(x){return x.split(/[\\/]/).pop();}},path.resolve('tests/output'));
  await page.locator('[data-action=open]').first().click();await page.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('conversion-scan'));await page.locator('#busy').waitFor({state:'hidden'});
  await app.evaluate(({ipcMain})=>{
   globalThis.reviewTest={ocr:0,skipped:0};const original=ipcMain._invokeHandlers.get('native');ipcMain.removeHandler('native');
   ipcMain.handle('native',async(e,args)=>{
    if(args.command==='apply'&&args.ocr?.length)globalThis.reviewTest.skipped=args.ocr.filter(b=>b.reviewSkipped===true).length;
    const r=await original(e,args);
    if(args.command==='ocr'){globalThis.reviewTest.ocr++;for(const b of r.blocks||[]){b.needsReview=true;b.reviewAccepted=false;b.corrected=false;}}
    return r;
   });
  });
  // UI has no revision guard; test the same installed runner through a standalone
  // instance with the real native bridge, immutable PDF and actual output writer.
  const results=await page.evaluate(async()=>{
   const {S}=await import('./app.mjs');const {installDocumentUtilities}=await import('./document-utilities-ui.mjs');
   const capture=S.pdf,outputs=[];
   const run=installDocumentUtilities({S,session:{capture:()=>capture,assert:x=>{if(x!==S.pdf)throw Error('Document changed');}},exportPDF:()=>S.pdf.getData(),writeFile:async(name,bytes)=>{outputs.push({name,size:bytes.length,signature:[...bytes.slice(0,4)]});return true;}});
   let blocked=false;try{await run({action:'export-word',options:{ai:false,layout:'flow'}});}catch(e){blocked=e.message.includes('OCR');}
   const skipped=await run({action:'export-word',options:{ai:false,layout:'flow',skipOCRReview:true}});
   const withoutOCR=await run({action:'export-excel',options:{ai:false,ocr:false}});
   return {blocked,saved:skipped.saved,withoutOCR:withoutOCR.saved,outputs,unchanged:S.pdf===capture,ocr:S.ocr.length};
  });
  assert(results.blocked);assert(results.saved&&results.withoutOCR&&results.unchanged);assert.equal(results.ocr,0);
  for(const o of results.outputs){assert(o.size>500);assert.deepEqual(o.signature.slice(0,2),[80,75]);}
  const trace=await app.evaluate(()=>globalThis.reviewTest);assert.equal(trace.ocr,2);assert(trace.skipped>0);
  fs.writeFileSync('tests/output/export-review-251.json',JSON.stringify({status:'passed',results,trace},null,2));console.log('PASS export OCR review skip, OCR bypass, and source preservation');
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

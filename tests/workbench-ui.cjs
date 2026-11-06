const {_electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{let app;try{
 app=await _electron.launch({...(process.env.FOLIO_EXE?{executablePath:process.env.FOLIO_EXE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.resolve('tests/output/workbench-ui-'+Date.now())},timeout:60000});
 const p=await app.firstWindow();p.setDefaultTimeout(30000);p.on('dialog',d=>d.accept());await p.waitForSelector('#document-assembly',{state:'attached'});await p.evaluate(async()=>{(await import('./i18n.mjs')).setLanguage('zh-Hans');});
 await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async(_win,o)=>({canceled:false,filePaths:o.properties.includes('multiSelections')?[root+'/import.docx',root+'/import.png',root+'/conversion-table.pdf']:[root+'/conversion-table.pdf']});dialog.showSaveDialog=async()=>({canceled:false,filePath:root+'/ui-mixed-merge.pdf'});},path.resolve('tests/output'));
 await p.keyboard.press('Control+Shift+k');await p.locator('.tool-library-search input').fill('PDF');assert(await p.locator('.tool-library-grid button:visible').count()>0);await p.locator('.tool-library-search input').fill('');await p.screenshot({path:'tests/output/workbench-library.png'});
 await p.locator('#document-assembly').click();await p.locator('[data-add]').click();await p.waitForFunction(()=>document.querySelectorAll('.merge-file-row').length===3);
 await p.locator('.merge-file-row').first().getByRole('button',{name:'下移',exact:true}).click();await p.locator('.merge-file-row input').first().fill('Cover image');
 assert((await p.locator('.merge-file-name').first().innerText()).includes('import.png'));
 await p.screenshot({path:'tests/output/workbench-merge.png'});await p.locator('.assembly-dialog [data-run]').click();await p.waitForFunction(()=>{const s=document.querySelector('.assembly-dialog [data-status]').textContent;return s&&s!=='正在处理…';},{},{timeout:240000});assert.match(await p.locator('.assembly-dialog [data-status]').innerText(),/已保存/);await p.locator('.assembly-dialog [data-close]').click();
 await p.locator('[data-action="open"]').first().click();await p.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('conversion-table'));
 await p.locator('.more-tools summary').click();await p.locator('#document-utilities').click();await p.waitForFunction(()=>!document.querySelector('.document-tools [data-run]').disabled);
 for(const action of ['export-word','export-excel','compress','pdfa']){
  await p.locator('[data-utility-action="'+action+'"]').click();
  for(const width of [800,1500]){
   await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,900),width);
   assert(await p.locator('.document-tools').evaluate(e=>e.scrollWidth<=e.clientWidth));
   await p.screenshot({path:`tests/output/workbench-${action}-${width}.png`});
  }
 }
 await p.evaluate(()=>document.body.classList.add('dark'));await p.screenshot({path:'tests/output/workbench-dark.png'});await p.keyboard.press('Escape');
 const {execFileSync}=require('node:child_process');execFileSync(process.env.FOLIO_PYTHON||path.resolve('native/runtime/python.exe'),['-c',"import fitz;d=fitz.open('tests/output/ui-mixed-merge.pdf');assert len(d)==3;assert 'Cover image'==d.get_toc()[0][1];assert 'Office import' in d[1].get_text();assert 'Quarterly performance' in d[2].get_text();assert any(x[0]==2 for x in d.get_toc())"]);
 fs.writeFileSync('tests/output/workbench-ui-report.json',JSON.stringify({status:'passed',emptyWorkspaceMerge:true,reordered:true,customBookmark:true,widths:[800,1500]},null,2));console.log('PASS workbench UI and mixed-format merge from empty workspace');
}finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}})().catch(e=>{console.error(e);process.exitCode=1});

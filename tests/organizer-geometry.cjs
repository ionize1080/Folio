const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {PDFDocument,PDFName,PDFNumber,degrees}=await import('../src/vendor/pdf-lib.js');
 const pdf=await PDFDocument.create(),p=pdf.addPage([600,800]);p.setMediaBox(100,200,600,800);p.setCropBox(150,250,500,700);p.setRotation(degrees(90));p.node.set(PDFName.of('UserUnit'),PDFNumber.of(2));p.drawRectangle({x:160,y:260,width:480,height:680});
 const file=path.resolve('tests/output/organizer-geometry-source.pdf'),output=path.resolve('tests/output/organizer-geometry.pdf');fs.writeFileSync(file,await pdf.save());
 const {app,page}=await require('./creative-harness.cjs')(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.evaluate(async()=>(await import('./i18n.mjs')).setLanguage('zh-Hans'));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},file);
  await page.locator('[data-action=open]').first().click();await page.waitForFunction(()=>document.querySelector('#doc-name').textContent.includes('organizer-geometry-source'));await page.locator('#busy').waitFor({state:'hidden'});
  await page.locator('#ribbon-tab-organize').click();await page.locator('[data-ribbon-command=page-organizer]').click();
  const org=page.locator('.organizer-dialog');await org.locator('.organizer-page[data-rendered]').waitFor();
  await org.locator('.organizer-options:has([data-resize]) summary').click();await org.locator('[data-width]').fill('300');await org.locator('[data-height]').fill('400');await org.locator('[data-resize]').click();await org.locator('[data-crop]').fill('10,20,30,40');await org.locator('[data-crop-apply]').click();await org.locator('.organizer-options:has([data-resize]) summary').click();await org.locator('[data-org=rotate]').click();
  await org.locator('[data-org=blank]').click();const blank=page.locator('.blank-pages-dialog');await blank.locator('[data-unit]').selectOption('pt');
  assert.equal(Number(await blank.locator('[data-width]').inputValue()),420);assert.equal(Number(await blank.locator('[data-height]').inputValue()),580);
  await blank.locator('[data-insert]').click();assert.equal(await org.locator('.organizer-page').count(),2);
  await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output})},output);
  await org.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('.organizer-dialog [data-status]').textContent.includes('整理结果已保存'));
  const result=await PDFDocument.load(fs.readFileSync(output)),pages=result.getPages();assert.equal(pages.length,2);
  const original=pages[0].getCropBox(),unit=pages[0].node.lookup(PDFName.of('UserUnit')).asNumber(),inserted=pages[1].getCropBox();
  assert.equal(original.width*unit,420);assert.equal(original.height*unit,580);assert.equal(pages[0].getRotation().angle%180,0);assert.equal(inserted.width,420);assert.equal(inserted.height,580);
  await org.locator('[data-org=blank]').click();await blank.waitFor();
  await page.evaluate(async()=>{const {S,commit}=await import('./app.mjs');commit(structuredClone(S.nodes));});
  await blank.locator('[data-insert]').click();await page.waitForFunction(()=>/文档|document/i.test(document.querySelector('.organizer-dialog [data-status]').textContent));assert.equal(await org.locator('.organizer-page').count(),2);assert.deepEqual(errors,[]);
  const report={status:'passed',dimensions:[420,580],checks:['MediaBox/CropBox and nonzero origin','UserUnit=2','Native 90-degree rotation plus organizer 90-degree rotation','Media-size scaling then crop margins','Inserted blank matches independently read saved page size','Concurrent document change rejected in visible status without unhandled rejection']};
  fs.writeFileSync('tests/output/organizer-geometry.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1});

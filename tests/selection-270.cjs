const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const {app,page}=await require('./creative-harness.cjs')();try{
 await page.evaluate(async()=>(await import('./i18n.mjs')).setLanguage('zh-Hans'));
 const file=process.env.FOLIO_SELECTION_PDF||'tests/output/workflow-250-source.pdf';
 await app.evaluate(({dialog},p)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]}),path.resolve(file));await page.locator('[data-action=open]').first().click();
 await page.locator('.pdf-page .textLayer span').first().waitFor();
 if(process.env.FOLIO_SELECTION_PDF){await page.locator('#page-number').fill('14');await page.locator('#page-number').press('Enter');await page.locator('.pdf-page[data-page="14"] .textLayer span').first().waitFor();}
 const target=await page.evaluate(()=>{
  const host=document.querySelector('#canvas-host').getBoundingClientRect();const el=[...document.querySelectorAll('.pdf-page:not(.page-fallback) .textLayer span')].find(el=>{const r=el.getBoundingClientRect();return el.firstChild?.nodeType===3&&el.textContent.trim().length>10&&r.top>host.top+20&&r.bottom<host.bottom-20;});if(!el)throw Error('No visible text fixture');el.dataset.selectionTest='1';
  const range=document.createRange();range.setStart(el.firstChild,1);range.setEnd(el.firstChild,2);const a=range.getBoundingClientRect();range.setStart(el.firstChild,5);range.setEnd(el.firstChild,6);const b=range.getBoundingClientRect();return {start:[a.left+1,(a.top+a.bottom)/2],end:[b.right-1,(b.top+b.bottom)/2],text:el.textContent};
 });
 await page.mouse.move(...target.start);await page.mouse.down();await page.mouse.move(...target.end,{steps:12});await page.mouse.up();await page.waitForTimeout(100);
 const selected=await page.evaluate(()=>getSelection().toString());assert(selected.length>=3&&selected.length<=7,JSON.stringify({selected,target}));assert(target.text.includes(selected));
 assert.equal(await page.locator('.text-selection-overlay path').count(),1);
 assert.equal(await page.locator('[data-selection-test]').evaluate(el=>getComputedStyle(el,'::selection').backgroundColor),'rgba(0, 0, 0, 0)');
 const bbox=await page.locator('.text-selection-overlay path').evaluate(el=>{const b=el.getBBox();return {x:b.x,width:b.width}});assert(bbox.x>10,'No left-margin selection bar');
 await require('./native-capture.cjs')(app,page,'tests/output/selection-270.png');
 const scroll=await page.evaluate(async()=>{const {scrollDelta}=await import('./scroll-preferences.mjs');return [scrollDelta({deltaY:100,deltaX:0,deltaMode:0},3),scrollDelta({deltaY:100,deltaX:0,deltaMode:0},6),scrollDelta({deltaY:4.5,deltaX:0,deltaMode:0},6)];});assert.deepEqual(scroll,[72,144,4.5]);
 const jumps=await page.evaluate(async()=>{const {S,surface}=await import('./app.mjs'),target=Math.min(3,S.info.pageCount),p=await S.pdf.getPage(target),host=document.querySelector('#canvas-host');let values=[];for(let i=0;i<3;i++){await surface.go(target,{mode:'XYZ',args:[p.view[0],p.view[3],null]},false);const samples=[];for(let n=0;n<8;n++){await new Promise(r=>requestAnimationFrame(r));samples.push(host.scrollTop);}values.push(samples);}return values;});assert(jumps.every(s=>Math.max(...s)-Math.min(...s)<=1),'Page-top bookmark must stay still after navigation');assert(Math.max(...jumps.flat())-Math.min(...jumps.flat())<=1,'Repeated page-top jumps must land at the same coordinate');
 fs.writeFileSync('tests/output/selection-270.json',JSON.stringify({status:'passed',selected,checks:['Character-accurate drag selection','One consistent SVG fill, native selection suppressed','No left-margin highlight','Wheel presets preserve fine pixel deltas']}));console.log('PASS precise selection',selected);
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}})().catch(e=>{console.error(e);process.exitCode=1;});

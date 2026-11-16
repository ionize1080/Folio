const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const {app,page}=await require('./creative-harness.cjs')();try{
 const source=path.resolve(process.env.FOLIO_PERF_PDF||'tests/output/save-281/fixture.pdf'),checks=[];
 await app.evaluate(({dialog,BrowserWindow},file)=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1440,960);win.show();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);
 await page.locator('[data-action=open]').first().click();await page.locator('.pdf-page .textLayer span').first().waitFor();
 await page.evaluate(async()=>{const {surface}=await import('./app.mjs');await surface.update();await Promise.all([...surface.entries.values()].map(e=>e.promise));await document.fonts.ready;});
 await page.waitForTimeout(500); // Exclude the startup window resize from steady-state profiling.
 const report=await page.evaluate(async()=>{
  const {surface}=await import('./app.mjs'),shell=document.querySelector('.pdf-page:not(.page-fallback)'),layer=shell.querySelector('.textLayer');
  const spans=[...layer.querySelectorAll('span')].filter(e=>e.firstChild?.nodeType===3&&e.textContent.trim());
  const range=document.createRange();range.setStart(spans[0].firstChild,0);range.setEnd(spans.at(-1).firstChild,spans.at(-1).firstChild.length);getSelection().removeAllRanges();getSelection().addRange(range);
  await new Promise(r=>requestAnimationFrame(r));
  window.perf281={rects:0,ranges:0};const er=Element.prototype.getBoundingClientRect,rr=Range.prototype.getBoundingClientRect,rc=Range.prototype.getClientRects;
  Element.prototype.getBoundingClientRect=function(){window.perf281.rects++;return er.call(this);};
  Range.prototype.getBoundingClientRect=function(){window.perf281.ranges++;return rr.call(this);};
  Range.prototype.getClientRects=function(){window.perf281.ranges++;return rc.call(this);};
  const times=[];for(let i=0;i<30;i++){const t=performance.now();surface.textSelection.paint();times.push(performance.now()-t);}
  const paints={times,measurements:{...window.perf281},fragments:spans.length};
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  window.perf281.rects=window.perf281.ranges=0;
  for(let i=0;i<20;i++){surface.host.dispatchEvent(new Event('scroll'));await new Promise(r=>requestAnimationFrame(r));}
  const scrolling={...window.perf281};getSelection().removeAllRanges();await new Promise(r=>requestAnimationFrame(r));
  const target=[...surface.host.querySelectorAll('.textLayer span')].find(e=>{const r=e.getBoundingClientRect(),h=surface.host.getBoundingClientRect();return e.firstChild?.nodeType===3&&e.textContent.length>=10&&r.width>0&&r.top>h.top&&r.bottom<h.bottom-20;}),r=document.createRange();
  r.setStart(target.firstChild,1);r.setEnd(target.firstChild,2);const a=r.getBoundingClientRect();r.setStart(target.firstChild,8);r.setEnd(target.firstChild,9);const b=r.getBoundingClientRect();
  return {paints,scrolling,target:{start:[a.left+1,(a.top+a.bottom)/2],end:[b.right-1,(b.top+b.bottom)/2],text:target.textContent}};
 });
 await page.mouse.move(...report.target.start);await page.mouse.down();await page.evaluate(()=>{window.perf281.rects=window.perf281.ranges=0;});
 await page.mouse.move(...report.target.end,{steps:30});await page.mouse.up();
 report.drag=await page.evaluate(()=>({...window.perf281,text:getSelection().toString()}));
 assert(report.drag.text.length>=4&&report.target.text.includes(report.drag.text),'Drag retains character-accurate selection: '+JSON.stringify(report));
 if(!process.env.FOLIO_PERF_BASELINE){assert(report.paints.measurements.rects<=60,'Selection painting measures each page once, not each fragment');assert(report.scrolling.ranges===0,'Scrolling does not remeasure an unchanged selection');}
 checks.push('Character-accurate dragging','Bounded page measurements','No selection layout work on ordinary scrolling');
 report.status='passed';report.checks=checks;delete report.target;
 fs.writeFileSync(process.env.FOLIO_PERF_REPORT||'tests/output/performance-281.json',JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

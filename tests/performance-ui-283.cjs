const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const h=await require('./ui-audit-support.cjs')('performance'),{app,page,out}=h;
  const report={startupMs:h.startupMs,stages:[],errors:h.errors};
  async function stage(name,fn){
    await page.evaluate(()=>{window.auditLongTasks=[];window.auditFrameGaps=[];window.auditFrameLast=performance.now();});
    const start=performance.now(),detail=await fn();await h.frames();
    const timing=await page.evaluate(()=>({longTasks:window.auditLongTasks,frameGaps:window.auditFrameGaps}));
    report.stages.push({name,elapsedMs:performance.now()-start,detail,...timing});
  }
  try{
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
    await page.evaluate(()=>{
      window.auditLongTasks=[];window.auditFrameGaps=[];
      new PerformanceObserver(l=>window.auditLongTasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask'});
      const frame=t=>{const gap=t-window.auditFrameLast;if(gap>25)window.auditFrameGaps.push(gap);window.auditFrameLast=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);
    });
    await stage('openPDF',()=>h.openPDF(process.env.FOLIO_PERF_PDF));
    await page.waitForTimeout(700);
    await stage('ribbon-24-switches',()=>page.evaluate(async()=>{
      const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),host=document.querySelector('#canvas-host');
      const counts={resize:0,mutations:0},r=new ResizeObserver(()=>counts.resize++),m=new MutationObserver(ms=>counts.mutations+=ms.length);
      r.observe(host);m.observe(host,{subtree:true,attributes:true,childList:true});await frame();counts.resize=counts.mutations=0;
      const timings=[];for(let i=0;i<3;i++)for(const id of ['read','edit','photo','vector','bookmarks','organize','export','home']){
        const t=performance.now();document.querySelector('#ribbon-tab-'+id).click();const syncMs=performance.now()-t;await frame();timings.push({id,syncMs,paintMs:performance.now()-t});
      }r.disconnect();m.disconnect();return {counts,timings};
    }));
    await stage('preferences-open-close-8',async()=>{
      const timings=[];for(let i=0;i<8;i++){
        const t=performance.now();await page.locator('[data-action=settings]').click();await page.locator('.prefs').waitFor();await h.frames();
        timings.push(performance.now()-t);await page.locator('#modal-close').click();
      }return timings;
    });
    await page.locator('[data-action=settings]').click();await page.locator('.prefs').waitFor();
    await stage('preferences-categories',async()=>{
      const timings=[];for(const id of ['reading','bookmarks','saving','performance','ai','advanced','general']){
        const t=performance.now();await page.locator(`[data-pref-nav=${id}]`).click();await h.frames();timings.push({id,elapsedMs:performance.now()-t});
      }return timings;
    });
    await page.locator('#modal-close').click();
    await stage('10000-bookmarks',()=>page.evaluate(async()=>{
      const {S,commit}=await import('./app.mjs'),{makeNode}=await import('./model.mjs');
      const nodes=Array.from({length:10000},(_,i)=>makeNode('Chapter '+i+(i%10===0?' — A long bookmark title wrapping onto a second line in a narrow sidebar':''),i%S.info.pageCount+1));
      const t=performance.now();commit(nodes);return {syncMs:performance.now()-t,renderedRows:document.querySelectorAll('.tree-row').length};
    }));
    await page.waitForTimeout(900);
    await page.locator('[data-action=settings]').click();await page.locator('.prefs').waitFor();
    await page.evaluate(async()=>{const {surface}=await import('./app.mjs');window.auditRefreshCount=0;window.auditRefresh=surface.refresh;surface.refresh=function(...args){window.auditRefreshCount++;return window.auditRefresh.apply(this,args);};});
    await stage('apply-unchanged-settings',async()=>{
      await page.locator('#modal-footer .primary').click();await page.locator('#modal').waitFor({state:'hidden'});
      return page.evaluate(()=>({pdfRefreshes:window.auditRefreshCount}));
    });
    await stage('bookmark-filter',async()=>{
      await page.locator('#filter').fill('Chapter 999');
      await page.waitForFunction(()=>document.querySelectorAll('.tree-row').length>0&&[...document.querySelectorAll('.tree-row .title')].every(e=>e.textContent.includes('Chapter 999')));
      return page.locator('.tree-row').count();
    });await page.locator('#filter').fill('');await page.waitForTimeout(200);
    await stage('scroll-60-frames',async()=>{
      return page.evaluate(async()=>{const {surface}=await import('./app.mjs');for(let i=0;i<60;i++){surface.host.scrollTop+=40;await new Promise(r=>requestAnimationFrame(r));}await surface.update();await Promise.all([...surface.entries.values()].map(e=>e.promise));return {entries:surface.entries.size,canvasBytes:surface.canvasBytes?.(),page:surface.s.page};});
    });
    await stage('zoom-and-layout',async()=>{
      const rows=[];for(const value of ['1.25','0.75','width']){
        const t=performance.now();await page.locator('#zoom').selectOption(value);await page.evaluate(async()=>{const {surface}=await import('./app.mjs');await surface.update();await Promise.all([...surface.entries.values()].map(e=>e.promise));});rows.push({zoom:value,ms:performance.now()-t});
      }
      const options=await page.locator('#layout option').evaluateAll(es=>es.map(e=>e.value));for(const value of options){await page.locator('#layout').selectOption(value);await h.frames();}
      return {rows,layouts:options};
    });
    // Collect after GC: measure retained UI objects rather than pending garbage.
    const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');
    const before={heap:await cdp.send('Runtime.getHeapUsage'),dom:await cdp.send('Memory.getDOMCounters')};
    await stage('dialog-retention-20',async()=>{for(let i=0;i<20;i++){await page.locator('[data-action=settings]').click();await page.locator('.prefs').waitFor();await page.locator('#modal-close').click();}});
    await cdp.send('HeapProfiler.collectGarbage');report.retention={before,after:{heap:await cdp.send('Runtime.getHeapUsage'),dom:await cdp.send('Memory.getDOMCounters')}};
    report.processes=await app.evaluate(({app})=>app.getAppMetrics().map(({type,cpu,memory})=>({type,cpu,memory})));
    assert.deepEqual(h.errors,[]);report.status='passed';
  }finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await h.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

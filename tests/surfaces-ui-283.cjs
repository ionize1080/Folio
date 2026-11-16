const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const h=await require('./ui-audit-support.cjs')('surfaces'),{app,page,out}=h;
  const report={surfaces:[],issues:[],errors:h.errors};
  const actions=['smart-toc','generate','batch','exchange','calibrate','calibrate-pages','whitespace','bookmark-qc','bookmark-every','page-organizer','insert-blank-page','document-assembly','document-utilities','table-structure','font-tools','print','metadata','page-diff','ocr-preview','recover','edit-content','annotate','ocr','help','settings'];
  async function openAction(action){
    const proxy=page.locator(`[data-ribbon-command="${action}"]`).first();
    if(await proxy.count()){
      const category=await proxy.evaluate(e=>e.closest('.ribbon-category').id.replace('ribbon-panel-',''));
      await page.locator('#ribbon-tab-'+category).click();await proxy.click();
    }else{
      const button=page.locator(action==='print'?'#print-document':`[data-action="${action}"],#${action}`).first();
      if(await button.evaluate(e=>!!e.closest('.more-tools')))await page.locator('.more-tools>summary').click();
      else if(await button.evaluate(e=>!!e.closest('.ribbon-home')))await page.locator('#ribbon-tab-home').click();
      await button.click();
    }
    if(action==='ocr-preview') { await page.locator('#toast.show').waitFor(); return; }
    if(action==='recover') {
      await page.waitForFunction(()=>document.querySelector('dialog[open]')||document.querySelector('#toast.show')?.textContent.includes('没有未保存'));
      if(!await page.locator('dialog[open]').count())return;
    }
    await page.locator('dialog[open]').first().waitFor();await h.frames();
  }
  async function close(){
    for(let i=0;i<4&&await page.locator('dialog[open]').count();i++){
      const dialog=page.locator('dialog[open]').last();
      const button=dialog.locator('#modal-close,button[data-close]').first();
      if(await button.count())await button.click();else await page.keyboard.press('Escape');
      await h.frames();
    }
    assert.equal(await page.locator('dialog[open]').count(),0,'Surface must close through its UI');
  }
  async function scan(name){
    await page.waitForTimeout(200);
    return page.evaluate(name=>{
      const visible=e=>e.checkVisibility({checkVisibilityCSS:true})&&e.getBoundingClientRect().width>0;
      const dialogs=[...document.querySelectorAll('dialog[open]')];
      const details=dialogs.map(d=>{
        const r=d.getBoundingClientRect();
        return {class:d.className,width:r.width,height:r.height,viewport:[innerWidth,innerHeight],outside:r.left<-.5||r.top<-.5||r.right>innerWidth+.5||r.bottom>innerHeight+.5,
          overflow:d.scrollWidth>d.clientWidth+1,controls:[...d.querySelectorAll('button,input,select,textarea,summary')].filter(visible).map(e=>({tag:e.tagName,id:e.id,type:e.type,name:e.getAttribute('aria-label')||e.labels?.[0]?.textContent?.trim().slice(0,100)||e.textContent?.trim().slice(0,100)||e.title,disabled:e.disabled,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))};
      });return {name,dialogs:details};
    },name);
  }
  async function exercise(root,record){
    const boxes=root.locator('input[type=checkbox]');const count=await boxes.count();
    for(let i=0;i<count;i++){
      const el=boxes.nth(i);if(!await el.isVisible()||!await el.isEnabled())continue;
      const id=await el.getAttribute('id')||await el.getAttribute('data-field')||String(i);
      const before=await el.isChecked();await el.click();assert.equal(await el.isChecked(),!before,record.name+' '+id);
      const geometry=await el.evaluate(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height};});
      assert(geometry.width>=12&&geometry.height>=12&&Math.abs(geometry.width-geometry.height)<1,record.name+' '+id+' visible square checkbox: '+JSON.stringify(geometry));
      const checked=await el.isChecked();if(checked){const visual=await el.evaluate(e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,accent:s.getPropertyValue('--accent').trim()};});record.checkboxVisuals??=[];record.checkboxVisuals.push({id,...visual});}
      await el.click();assert.equal(await el.isChecked(),before);
      const restored=await el.evaluate(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height};});
      assert(restored.width>=12&&Math.abs(restored.width-restored.height)<1,record.name+' '+id+' restored square checkbox');
      record.checkboxActions=(record.checkboxActions||0)+2;
    }
    record.selects=await root.locator('select').evaluateAll(es=>es.filter(e=>e.checkVisibility()).map(e=>({id:e.id,disabled:e.disabled,options:[...e.options].map(o=>({value:o.value,label:o.text,disabled:o.disabled}))})));
  }
  try{
    const {PDFDocument,StandardFonts,rgb}=await import('../src/vendor/pdf-lib.js');
    const fixture=await PDFDocument.create(),font=await fixture.embedFont(StandardFonts.Helvetica);
    for(let p=0;p<4;p++){
      const sheet=fixture.addPage([600,800]);sheet.drawText('Folio UI audit — page '+(p+1),{x:50,y:740,size:20,font});
      for(let row=0;row<4;row++)for(let col=0;col<3;col++){
        const x=50+col*160,y=600-row*45;sheet.drawRectangle({x,y,width:160,height:45,borderWidth:1,borderColor:rgb(0,0,0)});
        sheet.drawText(`Row ${row+1} Col ${col+1}`,{x:x+8,y:y+17,size:12,font});
      }
    }
    const fixturePath=path.join(out,'fixture.pdf');fs.writeFileSync(fixturePath,await fixture.save());
    await h.openPDF(fixturePath);
    await page.evaluate(async()=>{const {S,commit}=await import('./app.mjs'),{makeNode}=await import('./model.mjs');if(!S.nodes.length)commit([makeNode('Chapter 1',1),makeNode('Chapter 2',2)]);});
    for(const theme of ['light','dark']){
      await page.evaluate(async theme=>{(await import('./appearance.mjs')).applyAppearance({theme,palette:'mulberry'});},theme);
      for(const action of actions){
        console.log(theme,action);
        const record={name:theme+'/'+action};report.surfaces.push(record);
        try{
          const start=performance.now();await openAction(action);record.openMs=performance.now()-start;
          if(['ocr-preview','recover'].includes(action)&&!await page.locator('dialog[open]').count()){
            record.feedback=await page.locator('#toast').textContent();assert(record.feedback.trim());record.status='passed';await h.capture(theme+'-'+action+'.png');continue;
          }
          const root=page.locator('dialog[open]').last();
          await exercise(root,record);
          if(action==='batch'){
            record.modes=[];
            const modes=await page.locator('#batch-op option').evaluateAll(es=>es.map(e=>e.value));
            for(const mode of modes){await page.locator(`.choice [data-value="${mode}"]`).click();await h.frames();const sub={name:record.name+'/'+mode};await exercise(root,sub);record.modes.push(sub);}
          }
          if(action==='document-utilities'){
            record.sections=[];const buttons=root.locator('nav button');const n=await buttons.count();
            for(let i=0;i<n;i++){const b=buttons.nth(i);if(!await b.isEnabled())continue;const name=await b.textContent();await b.click();await h.frames();const sub={name};await exercise(root,sub);record.sections.push(sub);}
          }
          if(action==='font-tools'){
            await root.locator('[role=option]').first().waitFor();record.fontPresets=[];
            for(let i=0;i<4;i++){await root.locator(`[data-preset="${i}"]`).click();record.fontPresets.push(await root.locator('[data-sample]').inputValue());}
            await root.locator('[data-query]').fill('DejaVu');await page.waitForTimeout(250);await root.locator('[role=option]').first().click();
            await root.locator('[data-size]').focus();await page.keyboard.press('ArrowRight');
            assert.equal(await root.locator('[data-size]').inputValue(),'29');
          }
          record.layout=await scan(record.name);
          for(const d of record.layout.dialogs)if(d.outside||d.overflow)report.issues.push({name:record.name,layout:d});
          await h.capture(theme+'-'+action+'.png');
          record.status='passed';
        }catch(e){record.status='failed';record.error=e.message;report.issues.push({name:record.name,error:e.message});await h.capture(theme+'-'+action+'-failure.png').catch(()=>{});}
        await close();
      }
    }
    // Minimum supported desktop size: navigation, footer and modal bounds.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,520));
    for(const action of ['settings','batch','generate','ocr','page-organizer','font-tools','document-utilities','print']){
      console.log('compact',action);await openAction(action);const layout=await scan('compact/'+action);report.surfaces.push(layout);
      if(action==='ocr'){
        const pane=page.locator('#ocr-pane-settings');assert(await pane.evaluate(e=>e.clientHeight)>=100,'OCR settings retain a usable scroll viewport');
        const controls=pane.locator('input[type=checkbox]');for(let i=0;i<await controls.count();i++){const e=controls.nth(i);if(await e.isVisible()&&await e.isEnabled()){const checked=await e.isChecked();await e.click();assert.equal(await e.isChecked(),!checked);await e.click();}}
      }
      for(const d of layout.dialogs)if(d.outside||d.overflow)report.issues.push({name:layout.name,layout:d});
      await h.capture('compact-'+action+'.png');await close();
    }
    report.status=report.issues.length||h.errors.length?'failed':'passed';
  }finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,surfaces:report.surfaces.length,issues:report.issues,errors:report.errors},null,2));await h.close();}
  assert.equal(report.issues.length,0,'Surface audit has failures');assert.deepEqual(h.errors,[]);
})().catch(e=>{console.error(e);process.exitCode=1;});

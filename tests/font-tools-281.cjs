const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const {app,page}=await require('./creative-harness.cjs')();try{
 await app.evaluate(({ipcMain,BrowserWindow})=>{BrowserWindow.getAllWindows()[0].show();globalThis.font281=[];const native=ipcMain._invokeHandlers.get('native');ipcMain.removeHandler('native');ipcMain.handle('native',async(e,data)=>{const start=Date.now();try{return await native(e,data);}finally{if(data.command==='font-tools')globalThis.font281.push({action:data.action,key:data.options?.fontKey,ms:Date.now()-start});}});});
 await page.locator('.more-tools summary').click();await page.locator('#font-tools').click();await page.locator('[data-fonts] [role=option]').first().waitFor();await page.locator('[data-query]').fill('DejaVu Sans');
 await page.waitForFunction(()=>{const es=[...document.querySelectorAll('[data-fonts] [role=option]')];return es.length&&es.every(e=>/DejaVu Sans/i.test(e.textContent));});
 await page.locator('[data-fonts] [role=option]').first().click();await page.locator('[data-image]:not([hidden])').waitFor();await page.waitForFunction(()=>document.querySelector('[data-status]').dataset.state);
 for(const text of ['Folio 2026','Save preview','Readable sample','A long sample '.repeat(28)]){
  const before=await page.locator('[data-image]').getAttribute('src');await page.locator('[data-sample]').fill(text);await page.waitForFunction(before=>document.querySelector('[data-image]').getAttribute('src')!==before,before);
 }
 const before=await page.locator('[data-image]').getAttribute('src');await page.locator('[data-size]').fill('72');await page.waitForFunction(before=>document.querySelector('[data-image]').getAttribute('src')!==before,before);
 const colored=await page.locator('[data-image]').evaluate(async img=>{await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const a=ctx.getImageData(0,0,canvas.width,canvas.height).data;let dark=0;for(let i=0;i<a.length;i+=4)if(a[i]<150)dark++;return dark;});assert(colored>100,'Long large-size preview retains visible glyphs');
 const calls=await app.evaluate(()=>globalThis.font281),inspects=new Map();for(const c of calls.filter(c=>c.action==='inspect'))inspects.set(c.key,(inspects.get(c.key)||0)+1);
 assert(inspects.size>0&&[...inspects.values()].every(n=>n===1),'Each selected font is inspected once');assert(!calls.some(c=>c.action==='coverage'),'Preview already supplies character coverage');assert(calls.filter(c=>c.action==='preview').length>=5);
 const checks=['Font details reused across sample and size changes','One native preview request per update, with coverage included','Large overflowing text remains visible in a bounded preview'];
 fs.writeFileSync('tests/output/font-tools-281.json',JSON.stringify({status:'passed',checks,calls: calls.map(({key,...rest})=>rest),colored},null,2));console.log('PASS',checks);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});

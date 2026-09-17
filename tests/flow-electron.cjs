const {app}=require('electron');const fs=require('node:fs/promises');const path=require('node:path');
const {FlowLayout}=require('../flow-layout.cjs');
app.whenReady().then(async()=>{let engine;try{
 engine=new FlowLayout(path.resolve('native'));
 const model={pageWidth:595.28,pageHeight:841.89,frame:{x:60,y:120,width:460,height:480},text:'金融统计段落流式编辑测试，保留金额 00123.45 和百分比 3.50%。English words should wrap at word boundaries.\n第二段正文。'.repeat(8),size:12,lineHeight:1.5,columns:2,gap:20,align:'justify',color:'#202020',font:'sans'};
 const r=await engine.render(model);console.log('RESULT',r.overflow,r.bytes?.length,r.elapsedMs);if(!r.bytes)throw Error('Expected fit');await fs.writeFile('tests/output/v6-flow-fragment.pdf',r.bytes);await fs.writeFile('tests/output/v6-flow-model.json',JSON.stringify(model));
 const bad=await engine.render({...model,frame:{...model.frame,height:20}});if(!bad.overflow)throw Error('Expected overflow');
 console.log('PASS overflow');
 const t=await engine.render({...model,text:'中文更新。\n第三段测试。'});console.log('PASS warm layout',t.elapsedMs);await fs.writeFile('tests/output/v6-flow-short.pdf',t.bytes);
 await fs.writeFile('tests/output/v6-layout-report.json',JSON.stringify({engine:process.versions,coldMs:r.elapsedMs,warmMs:t.elapsedMs,overflowBlocked:true}));
 }catch(e){console.error(e);process.exitCode=1;}finally{engine?.close();app.quit();}});

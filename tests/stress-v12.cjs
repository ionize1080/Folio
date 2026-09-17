const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),source=process.env.FOLIO_BASELINE_UI?path.resolve(process.env.FOLIO_BASELINE_UI,'src'):path.join(root,'src');
const out=path.join(root,'tests/output'),mode=process.env.FOLIO_BASELINE_UI?'baseline':'v12';
let peak=0;const sample=()=>{try{const rows=execFileSync('ps',['-eo','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n').map(s=>s.trim().split(/\s+/).map(Number));const ids=new Set([process.pid]);for(let i=0;i<6;i++)for(const [pid,ppid] of rows)if(ids.has(ppid))ids.add(pid);peak=Math.max(peak,rows.reduce((n,[pid,,rss])=>n+(ids.has(pid)?rss*1024:0),0));}catch{}};
(async()=>{
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;let file=name==='/stress.pdf'?path.join(out,'v12-200MiB.pdf'):path.resolve(source,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(source)&&name!=='/stress.pdf'){res.writeHead(404);return res.end();}
  const type={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.pdf':'application/pdf'}[path.extname(file)]||'application/octet-stream';res.setHeader('Content-Type',type);
  if(file===path.join(source,'app.mjs'))return res.end(fs.readFileSync(file,'utf8')+'\nwindow.__qa={S,loadPDF,snapshot,encodeProject};');
  const stream=fs.createReadStream(file);stream.on('error',()=>{res.statusCode=404;res.end();});stream.pipe(res);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.FOLIO_CHROMIUM,args:['--no-sandbox','--disable-gpu']});const timer=setInterval(sample,100);
 try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__qa);
 const result=await page.evaluate(async mode=>{const q=window.__qa,bytes=new Uint8Array(await (await fetch('/stress.pdf')).arrayBuffer());const start=performance.now();await q.loadPDF(bytes,'200MiB.pdf');const opened=performance.now();let beats=0;const interval=setInterval(()=>beats++,20);let zip;
 try{zip=await q.encodeProject(q.S.bytes,q.S.name,q.snapshot(),{blob:true});}finally{clearInterval(interval);}
 const encoded=performance.now();return {mode,sourceBytes:bytes.length,projectBytes:zip.size||zip.length,openMs:opened-start,encodeMs:encoded-opened,uiHeartbeatsDuringEncode:beats,pages:q.S.info.pageCount};},mode);
 sample();result.peakProcessTreeRSS=peak;fs.writeFileSync(path.join(out,`v12-stress-${mode}.json`),JSON.stringify(result,null,2));console.log(result);
 }finally{clearInterval(timer);await browser.close();server.close();}
})().catch(e=>{const result={mode,error:e.message,peakProcessTreeRSS:peak};fs.writeFileSync(path.join(out,`v12-stress-${mode}.json`),JSON.stringify(result,null,2));console.error(result);process.exitCode=1});

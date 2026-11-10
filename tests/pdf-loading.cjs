const {chromium}=require('playwright');
const checkPdfLoading=require('./pdf-loading-check.cjs');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const ROOT=path.resolve('.'),out=path.join(ROOT,'tests/output/pdf-loading');
const reportFile=path.join(ROOT,'tests/output/pdf-loading-report.json');
(async()=>{
  // A failed retry must never leave an earlier successful result eligible for
  // the release provenance gate.
  fs.rmSync(reportFile,{force:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'));
  assert(manifest.some(s=>s.name==='synthetic-jpx'),'The deterministic JPX fixture is required');
  const server=http.createServer((req,res)=>{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');return;}
    const file=path.resolve(ROOT,'.'+name);
    if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
    const ext=path.extname(file);res.setHeader('Content-Type',({'.mjs':'text/javascript','.wasm':'application/wasm','.pdf':'application/pdf','.css':'text/css'})[ext]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
    const origin='http://127.0.0.1:'+server.address().port,checks=[];
    for(const specimen of manifest){
      const page=await browser.newPage();await page.goto(origin);
      const report=await page.evaluate(checkPdfLoading,{specimen,baseURL:origin+'/src/',filesBase:origin+'/tests/output/pdf-loading/'});
      for(const kind of ['background','saved']){
        // Separate browser workers can differ by a single low-contrast edge
        // sample in the tiny upper-right logo. Bound that raster noise tightly;
        // the railway image itself must remain pixel-identical.
        assert(report[kind].outsideChangedPixels<=4&&report[kind].outsideMaxError<=16,specimen.name+' '+kind+' outside paragraph '+JSON.stringify(report[kind].outsideSamples));
        assert(report[kind].imagePixels>0,specimen.name+' image has sampled pixels');
        assert.equal(report[kind].imageChangedPixels,0,specimen.name+' '+kind+' image');fs.writeFileSync(path.join(out,specimen.name+'-'+kind+'.png'),Buffer.from(report[kind].png.split(',')[1],'base64'));delete report[kind].png;
      }
      assert(report.thumbnailColors>=4,specimen.name+' thumbnail contains image colors');
      fs.writeFileSync(path.join(out,specimen.name+'-source.png'),Buffer.from(report.source.split(',')[1],'base64'));delete report.source;
      checks.push({name:specimen.name,...report});await page.close();
    }
    // A fresh worker with the old missing assets actually drops the same JPX.
    const page=await browser.newPage();await page.goto(origin);
    const missing=await page.evaluate(async file=>{const pdfjs=await import('/src/vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/src/vendor/pdf.worker.mjs';const p=await pdfjs.getDocument({url:'/tests/output/pdf-loading/'+file,isEvalSupported:false}).promise;const pg=await p.getPage(1),v=pg.getViewport({scale:1}),c=document.createElement('canvas');c.width=v.width;c.height=v.height;await pg.render({canvasContext:c.getContext('2d'),viewport:v}).promise;return [...c.getContext('2d').getImageData(180,110,1,1).data];},manifest[0].files.background);
    assert(missing[0]>150&&missing[1]>80&&missing[1]<140&&missing[2]<90,'old configuration exposes the brown background in place of the JPX image');
    checks.push({name:'missing-decoder-control',pixel:missing});
    const result={status:'passed',browser:browser.version(),headless:true,checks};
    fs.writeFileSync(reportFile,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

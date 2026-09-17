// Read the actual PDF.js text content without requiring a canvas or browser.
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 globalThis.DOMMatrix=class{};
 Uint8Array.prototype.toHex??=function(){return Buffer.from(this).toString('hex')};
 Uint8Array.fromHex??=s=>new Uint8Array(Buffer.from(s,'hex'));
 const pdfjs=await import('../src/vendor/pdf.mjs');
 pdfjs.GlobalWorkerOptions.workerSrc=new URL('../src/vendor/pdf.worker.mjs',require('node:url').pathToFileURL(__filename)).href;
 const pdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(__dirname+'/output/p2-ocr-output.pdf')),useSystemFonts:false}).promise;
 const content=await(await pdf.getPage(1)).getTextContent();
 for(const item of content.items){assert(item.height<=17,item.str+' has oversized selection height');assert(Number.isFinite(item.height));}
 assert.equal(content.items.length,7);
 const report={engine:'shipped PDF.js',items:content.items.map(i=>({text:i.str,height:i.height})),maxHeight:Math.max(...content.items.map(i=>i.height))};
 fs.writeFileSync(__dirname+'/output/p2-pdfjs-report.json',JSON.stringify(report,null,2));console.log(report);await pdf.destroy();
})().catch(e=>{console.error(e);process.exitCode=1});

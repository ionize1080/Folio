const {chromium}=require(process.env.FOLIO_PLAYWRIGHT||'playwright'), http=require('node:http'), fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{const server=http.createServer(async(req,res)=>{res.setHeader('content-type',req.url==='/recovery.mjs'?'text/javascript':'text/html');res.end(req.url==='/recovery.mjs'?await fs.readFile('src/recovery.mjs'):'<!doctype html><title>Recovery test</title>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{browser=await chromium.launch({executablePath:process.env.FOLIO_CHROMIUM,headless:true,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu']});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
const result=await page.evaluate(async()=>{
 const old={name:'old.pdf',bytes:new Uint8Array([1,2,3]),state:{nodes:[],ocr:[{page:1,text:'旧版草稿'}]}};
 await new Promise((resolve,reject)=>{const q=indexedDB.open('folio-recovery',1);q.onupgradeneeded=()=>q.result.createObjectStore('session');q.onsuccess=()=>{const t=q.result.transaction('session','readwrite');t.objectStore('session').put(old,'current');t.oncomplete=()=>{q.result.close();resolve()}};q.onerror=reject});
 const {recoveryRead,recoveryStore}=await import('/recovery.mjs');const legacy=await recoveryRead();
 const ocr=Array.from({length:10000},(_,i)=>({page:i%758+1,text:'中文校对结果'+i}));const value={...old,state:{nodes:[{title:'第一版'}],ocr}};
 await recoveryStore(value);await recoveryStore({...value,state:{...value.state,nodes:[{title:'第二版'}]}});const saved=await recoveryRead();await recoveryStore(null);const cleared=await recoveryRead();
 return {legacy:legacy.state.ocr[0].text,bytes:Array.from(saved.bytes),title:saved.state.nodes[0].title,last:saved.state.ocr.at(-1).text,count:saved.state.ocr.length,cleared:cleared===undefined};
});assert.deepEqual(result,{legacy:'旧版草稿',bytes:[1,2,3],title:'第二版',last:'中文校对结果9999',count:10000,cleared:true});console.log('PASS IndexedDB v1 recovery, metadata changes preserve 10000 OCR blocks, transactional clear');await fs.writeFile('tests/output/v5-recovery-report.json',JSON.stringify(result,null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});

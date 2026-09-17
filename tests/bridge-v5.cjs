const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeBridge}=require('../native-bridge.cjs');
(async()=>{const bridge=new NativeBridge(path.resolve('native'),process.env.FOLIO_PYTHON||'python3');try{
const input=await fs.readFile('tests/output/v5-300-pages.pdf');
const ocr=Array.from({length:10},(_,i)=>({page:i+1,text:'测试文字',quad:[[40,700],[200,700],[200,680],[40,680]]}));
let events=0;
await assert.rejects(bridge.run({command:'apply',bytes:input,ocr},()=>{events++;bridge.cancel()}),/取消|退出/);
assert(events>0);assert((await fs.readFile('tests/output/v5-300-pages.pdf')).equals(input));
const result=await bridge.run({command:'apply',bytes:input,ocr:ocr.slice(0,1)},()=>{});assert(result.bytes.length>0);
console.log('PASS native progress; cancellation preserves input; process restarts successfully');
await fs.writeFile('tests/output/v5-bridge-report.json',JSON.stringify({events,checks:['native progress','cancel preserves input','restart succeeds']},null,2));
}finally{bridge.cancel()}})().catch(e=>{console.error(e);process.exitCode=1});

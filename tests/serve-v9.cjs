// Local test adapter only. Never included in the production application.
const http=require('http'),fs=require('fs'),path=require('path');
const {NativeBridge}=require('../native-bridge.cjs'),{FlowLayout}=require('../flow-layout.cjs');
const root=path.resolve(__dirname,'..'),bridge=new NativeBridge(path.join(root,'native'),'python3'),layout=new FlowLayout(path.join(root,'native'),'python3');
const desktop=`const call=async(u,d)=>{const r=await fetch(u,{method:'POST',body:JSON.stringify(d)});const v=await r.json();if(v.error)throw Error(v.error);if(v.bytes)v.bytes=new Uint8Array(v.bytes);return v;};window.desktop={native:d=>call('/__native',{...d,bytes:Array.from(d.bytes)}),flowLayout:d=>call('/__flow',d),open:async()=>({name:'Folio UI test.pdf',bytes:new Uint8Array(await(await fetch('/__fixture')).arrayBuffer())}),save:async d=>call('/__save',{...d,bytes:Array.from(d.bytes)}),setDirty(){},onClose(){},onNativeProgress(){},graphics:async()=>false,copyText:async()=>{},ocrJob:async()=>({})};`;
http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');let body,type='application/json';
 if(req.method==='POST'){let buf='';for await(const c of req)buf+=c;const d=JSON.parse(buf);let r;
  if(u.pathname==='/__save'){fs.writeFileSync(path.join(root,'tests/output/v9-browser-saved.pdf'),Buffer.from(d.bytes));r=true;}
  else if(u.pathname==='/__flow')r=await layout.render(d);
  else if(u.pathname==='/__native')r=await bridge.run(d);else throw Error('Unknown test route');
  if(r.bytes)r.bytes=Array.from(r.bytes);body=JSON.stringify(r);
 }else if(u.pathname==='/__desktop.js'){body=desktop;type='text/javascript';}
 else if(u.pathname==='/__fixture'){body=fs.readFileSync(path.join(root,'tests/output/v9-fixture.pdf'));type='application/pdf';}
 else if(u.pathname==='/qa-frame'){const w=Math.max(600,Math.min(2000,Number(u.searchParams.get('width'))||820));body=`<!doctype html><title>Folio narrow layout test</title><body style="margin:0;background:#e5e7eb"><iframe title="Folio test window" src="/" style="display:block;border:0;width:${w}px;height:900px"></iframe>`;type='text/html';}
 else{const p=path.resolve(root,'src','.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));if(!p.startsWith(path.join(root,'src')+path.sep))throw Error('path');body=fs.readFileSync(p);if(p.endsWith('index.html'))body=body.toString().replace('<script type="module" src="app.mjs">','<script src="/__desktop.js"></script><script type="module" src="app.mjs">');type=({'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm'})[path.extname(p)]||'application/octet-stream';}
 res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);
}catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}}).listen(8765,'0.0.0.0',()=>console.log('Local Folio UI test: http://localhost:8765'));

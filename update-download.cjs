const fs=require('node:fs/promises'),crypto=require('node:crypto');
const BLOCK=16*1024**2;
async function digestFile(file){const f=await fs.open(file,'r'),h=crypto.createHash('sha256');try{for await(const b of f.createReadStream({autoClose:false}))h.update(b);return h.digest('hex');}finally{await f.close();}}
// Segments are bound to an authenticated release checksum, size and URL. Partial
// bytes survive cancellation; only a fully assembled, verified ZIP is published.
async function downloadAsset({url,file,size,hash,fetch,signal,progress=()=>{},blockSize=BLOCK,parallel=4}){
  const part=file+'.part',manifest=part+'.json',count=Math.ceil(size/blockSize),identity={url,size,hash:hash.toLowerCase(),blockSize};
  let old;try{old=JSON.parse(await fs.readFile(manifest,'utf8'));}catch{}
  const segment=i=>part+'.'+i;
  if(JSON.stringify(old)!==JSON.stringify(identity)){
    for(let i=0;i<count;i++)await fs.rm(segment(i),{force:true});
    await fs.rm(part,{force:true});await fs.writeFile(manifest,JSON.stringify(identity));
  }
  signal?.throwIfAborted();
  const probe=await fetch(url,{headers:{Accept:'application/octet-stream','Accept-Encoding':'identity',Range:'bytes=0-0'}});
  const range=probe.status===206&&probe.headers.get('content-range')===`bytes 0-0/${size}`;
  let received=0,last=0;const start=Date.now(),initial=[];
  const update=()=>{if(Date.now()-last>150){last=Date.now();const speed=(received-initial.reduce((a,b)=>a+b,0))/Math.max(.1,(last-start)/1000);progress({received,total:size,speed:Math.max(0,speed),eta:speed>0?(size-received)/speed:null,connections:range?Math.min(parallel,count):1,resumable:range});}};
  async function stream(response,target,offset,expected){
    const f=await fs.open(target,offset?'r+':'w');let written=0;
    try{for await(const chunk of response.body){signal?.throwIfAborted();if(written+chunk.length>expected)throw Error('下载大小超出发布信息');let at=0;while(at<chunk.length){const r=await f.write(chunk,at,chunk.length-at,offset+written+at);if(!r.bytesWritten)throw Error('磁盘写入中断');at+=r.bytesWritten;}written+=chunk.length;received+=chunk.length;update();}await f.sync();}
    finally{await f.close();}
    if(written!==expected)throw Error('下载连接提前结束，可继续下载');
  }
  if(!range){
    if(probe.status!==200){await probe.body?.cancel();throw Error('服务器返回无效的范围响应');}
    await stream(probe,part,0,size);
  }else{
    await probe.body?.cancel();
    for(let i=0;i<count;i++){const length=Math.min(blockSize,size-i*blockSize);let done=0;try{done=(await fs.stat(segment(i))).size;}catch{}if(done>length){await fs.rm(segment(i),{force:true});done=0;}initial.push(done);received+=done;}
    update();let next=0,failure;
    const workers=Array.from({length:Math.min(parallel,count)},async()=>{while(next<count&&!failure){const i=next++,length=Math.min(blockSize,size-i*blockSize),done=initial[i];if(done===length)continue;
      try{signal?.throwIfAborted();const begin=i*blockSize+done,end=i*blockSize+length-1;
        const r=await fetch(url,{headers:{Accept:'application/octet-stream','Accept-Encoding':'identity',Range:`bytes=${begin}-${end}`}});
        if(r.status!==206||r.headers.get('content-range')!==`bytes ${begin}-${end}/${size}`){await r.body?.cancel();throw Error('服务器范围响应不一致，请重新检查更新');}
        await stream(r,segment(i),done,length-done);
      }catch(e){failure=e;}
    }});
    await Promise.all(workers);if(failure)throw failure;
    const out=await fs.open(part,'w');try{for(let i=0;i<count;i++){signal?.throwIfAborted();const f=await fs.open(segment(i),'r');try{for await(const b of f.createReadStream({autoClose:false}))await out.writeFile(b);}finally{await f.close();}}await out.sync();}finally{await out.close();}
  }
  progress({received:size,total:size,speed:0,eta:0,verifying:true,resumable:range});
  const actual=await digestFile(part);
  if(actual!==hash.toLowerCase()){
    await fs.rm(part,{force:true});for(let i=0;i<count;i++)await fs.rm(segment(i),{force:true});await fs.rm(manifest,{force:true});throw Error('更新包 SHA-256 校验失败');
  }
  await fs.rename(part,file);for(let i=0;i<count;i++)await fs.rm(segment(i),{force:true});await fs.rm(manifest,{force:true});
  return {file,hash:actual,received:size};
}
module.exports={downloadAsset,digestFile};

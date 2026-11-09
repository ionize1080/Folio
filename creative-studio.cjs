// Editors execute inside Folio. The host only reads explicitly imported assets.
const fs=require('node:fs/promises'),path=require('node:path');
async function readCreativeAsset(file){
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error('请提供素材的完整路径');
  let data;
  if((await fs.stat(file)).isDirectory()){
    if(!file.toLowerCase().endsWith('.pcraft'))throw Error('仅支持 .pcraft 工程目录');
    const entries=new Map();
    async function walk(dir,prefix=''){
      for(const e of await fs.readdir(dir,{withFileTypes:true})){
        if(e.isDirectory())await walk(path.join(dir,e.name),prefix+e.name+'/');
        else if(e.isFile())entries.set(prefix+e.name,new Uint8Array(await fs.readFile(path.join(dir,e.name))));
      }
    }
    await walk(file);const {zipBlob}=await import('./src/zip-store.mjs');data=Buffer.from(await zipBlob(entries).arrayBuffer());
  }else data=await fs.readFile(file);
  return {data:data.toString('base64'),name:path.basename(file),extension:path.extname(file).slice(1).toLowerCase(),bytes:data.length};
}
module.exports={readCreativeAsset};

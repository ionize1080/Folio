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
const uiFontCache=new Map();
// Only host interface faces are readable here. User supplied font/file paths are
// never accepted, and Windows font files stay on the user's own computer.
async function readCreativeUIFonts(language='en'){
  const locale=language==='zh-Hant'?'zh-Hant':'zh-Hans';
  if(uiFontCache.has(locale))return uiFontCache.get(locale);
  const pending=(async()=>{
    const directory=path.join(process.env.WINDIR||'C:\\Windows','Fonts'),fonts=[];
    for(const [name,file,index] of [['regular','segoeui.ttf',0],['semibold','seguisb.ttf',0],['mono','consola.ttf',0],['cjk',locale==='zh-Hant'?'msjh.ttc':'msyh.ttc',1]]){
      try{const data=await fs.readFile(path.join(directory,file));if(data.length<=32*1024*1024)fonts.push({name,index,data:data.toString('base64')});}catch{}
    }
    if(!fonts.some(f=>f.name==='cjk')){try{const data=await fs.readFile(path.join(__dirname,'src/vendor/folio-ui.ttf'));fonts.push({name:'cjk',index:0,data:data.toString('base64')});}catch{}}
    return {fonts,source:'host-interface',language:locale};
  })();uiFontCache.set(locale,pending);return pending;
}
module.exports={readCreativeAsset,readCreativeUIFonts};

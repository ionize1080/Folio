const fs=require('node:fs'),dns=require('node:dns/promises'),net=require('node:net');
const ENDPOINT='https://maas.qianwenaiapi.com/compatible-mode/v1/images/generations';
const PLAN_ENDPOINT='https://token-plan.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation';
function credentials(){return (process.env.FOLIO_IMAGE_API_KEY||(process.env.FOLIO_IMAGE_KEY_FILE?fs.readFileSync(process.env.FOLIO_IMAGE_KEY_FILE,'utf8'):'')).trim().replace(/^\uFEFF/,'');}
function body(options,config={}) {
  const {prompt,reference,size='1024x1024'}=options,model=config.model||'qwen-image-3.0-pro';
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>16000)throw Error('图片提示词应为 1–16000 字符');
  if(!/^(auto|\d{3,4}x\d{3,4})$/.test(size))throw Error('图片尺寸格式应为 1024x1024 或 auto');
  if(model.startsWith('qwen-image')&&size!=='auto') {const [w,h]=size.split('x').map(Number);if(w*h<512**2||w*h>2048**2||Math.max(w/h,h/w)>8)throw Error('千问图片像素数应在 512²–2048² 之间，宽高比不超过 8:1');}
  const out={...config.extra,model,prompt,n:1,size};
  const allowed=['seed','negative_prompt','prompt_extend','prompt_extend_mode','enable_thinking','watermark','quality','style','background','output_format','output_compression'];
  for(const key of Object.keys(options))if(!['prompt','reference','size','provider',...allowed].includes(key))throw Error('未知图片生成参数：'+key);
  for(const key of allowed)if(options[key]!==undefined)out[key]=options[key];
  if(out.seed!==undefined&&(!Number.isInteger(out.seed)||out.seed<0||out.seed>2147483647))throw Error('随机种子应为 0–2147483647');
  for(const key of ['prompt_extend','enable_thinking','watermark'])if(out[key]!==undefined&&typeof out[key]!=='boolean')throw Error('图片开关参数无效');
  if(out.negative_prompt!==undefined&&(typeof out.negative_prompt!=='string'||out.negative_prompt.length>2000))throw Error('反向提示词过长');
  if(reference&&(!/^data:image\/(png|jpeg|webp);base64,/.test(reference)||reference.length>8*1024**2))throw Error('参考图片格式或大小无效');
  if(reference)out.image=[reference];
  return out;
}
async function limited(response,limit){const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('图片接口响应过大');chunks.push(chunk);}return Buffer.concat(chunks);}
function connectionError(error,download=false){
  const code=error?.cause?.code||error?.code;
  return Error((download?'图片已生成，但下载失败，请检查网络后重试':'无法连接图片服务，请检查网络与接口地址')+(/^[A-Z][A-Z0-9_]{1,40}$/.test(code)?' · '+code:''));
}
function serviceError(result,status,key=''){
  const code=result?.error?.code||result?.code;
  let message=result?.error?.message||result?.message||'';
  if(typeof message!=='string')message='';
  if(key)message=message.split(key).join('[redacted]');
  message=message.replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').replace(/data:image\/[^\s]+/g,'[image]').slice(0,400);
  const reason=status===401?'；请检查生图模型提供方的 API 密钥':status===403?'；请检查模型权限与服务区域':status===429?'；请稍后重试':'';
  return Error('图片生成失败'+(status?'，HTTP '+status:'')+(typeof code==='string'?' · '+code.slice(0,100):'')+(message?'：'+message:reason));
}
function privateIP(address){return /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::|f[cd]|fe80)/i.test(address);}
async function safeDownload(url,endpoint){
  if(url.username||url.password)throw Error('图片下载地址不得包含登录信息');
  if(url.origin===new URL(endpoint).origin)return;
  if(url.protocol!=='https:'||['localhost','[::1]'].includes(url.hostname)||privateIP(url.hostname))throw Error('图片服务返回了不受信任的下载地址');
  if(/(^|\.)(aliyuncs\.com|qianwenaiapi\.com)$/.test(url.hostname))return;
  const addresses=net.isIP(url.hostname)?[{address:url.hostname}]:await dns.lookup(url.hostname,{all:true});
  if(!addresses.length||addresses.some(a=>privateIP(a.address)))throw Error('图片服务返回了内部网络地址');
}
function pixels(data){
  const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=data[0]===255&&data[1]===216&&data[2]===255;
  const webp=data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
  if(!png&&!jpeg&&!webp)throw Error('图片接口未返回 PNG、JPEG 或 WebP 图片');
  if(data.length>32*1024**2)throw Error('图片超过 32 MB');return data.toString('base64');
}
let active=0;
async function generate(options,fetcher=fetch,keyReader=credentials,config={}){
  const payload=body(options,config);if(active>=4)throw Error('已有 4 个图片生成任务，请等待后重试');active++;
  try{
    const signal=AbortSignal.timeout(230000),key=keyReader();
    const protocol=config.protocol||(key.startsWith('sk-sp-')?'token-plan':'openai');
    let endpoint=config.endpoint||(protocol==='token-plan'?PLAN_ENDPOINT:ENDPOINT);
    const native=['token-plan','dashscope'].includes(protocol),{model,prompt,image,...parameters}=payload;
    let request=native?{model,input:{messages:[{role:'user',content:[...(image||[]).map(image=>({image})),{text:prompt}]}]},parameters:{...parameters,...(parameters.size==='auto'?{}:{size:parameters.size.replace('x','*')})}}:payload;
    if(native&&parameters.size==='auto')delete request.parameters.size;
    const headers={...(key?{Authorization:'Bearer '+key}:{})};
    if(image&&!native&&config.referenceMode==='none')throw Error('此图片服务未启用参考图支持');
    if(image&&!native&&(config.referenceMode||'json')==='multipart'){
      endpoint=endpoint.replace(/\/generations$/,'/edits');request=new FormData();
      for(const [k,v] of Object.entries(payload))if(k!=='image')request.set(k,typeof v==='object'?JSON.stringify(v):String(v));
      const mime=image[0].slice(5,image[0].indexOf(';'));request.set('image',new Blob([Buffer.from(image[0].split(',')[1],'base64')],{type:mime}),'reference.'+mime.split('/')[1]);
    }else{headers['Content-Type']='application/json';request=JSON.stringify(request);}
    let response;
    try {response=await fetcher(endpoint,{method:'POST',headers,body:request,signal,redirect:'error'});}
    catch(error){throw connectionError(error);}
    let result;
    try { result=JSON.parse((await limited(response,response.ok?46*1024**2:64*1024)).toString()); }
    catch(error) { if(!response.ok)throw serviceError(null,response.status,key);throw Error('图片服务返回了无效响应；请检查接口地址是否为图片 API。'); }
    if(!response.ok||result.error||result.code)throw serviceError(result,response.status,key);
    const embedded=result.data?.[0]?.b64_json;
    if(embedded){if(typeof embedded!=='string'||!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(embedded))throw Error('图片编码无效');return pixels(Buffer.from(embedded,'base64'));}
    const imageUrl=result.data?.[0]?.url||result.output?.choices?.[0]?.message?.content?.find(c=>c.image)?.image;
    if(!imageUrl)throw Error(result.output?.task_id?'此服务返回了异步任务，请选择同步生图接口。':'图片服务未返回图片；请检查模型是否支持当前生图接口。');
    let url;
    try { url=new URL(imageUrl); } catch {throw Error('图片服务返回了无效的下载地址');}
    for(let redirects=0;redirects<5;redirects++){
      await safeDownload(url,endpoint);
      // Retry only the idempotent download; never repeat a potentially billed POST.
      let response;
      for(let attempt=0;attempt<2;attempt++){
        try {response=await fetcher(url,{signal,redirect:'manual'});break;}
        catch(error){if(attempt||signal.aborted)throw connectionError(error,true);}
      }
      if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();url=new URL(response.headers.get('location'),url);continue;}
      if(!response.ok)throw Error('生成图片下载失败');return pixels(await limited(response,32*1024**2));
    }
    throw Error('图片下载重定向过多');
  }finally{active--;}
}
module.exports={generate,body,ENDPOINT};

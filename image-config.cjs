const fs=require('node:fs'),path=require('node:path');
const defaults={protocol:'token-plan',endpoint:'https://token-plan.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',model:'qwen-image-3.0-pro',keyFile:'',referenceMode:'json',extra:{}};
function validate(value) {
  const c={...value};
  if(!['openai','dashscope','token-plan','chatbox'].includes(c.protocol))throw Error('请选择支持的图片接口协议');
  if(c.protocol!=='chatbox') {
    const u=new URL(c.endpoint);
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('接口地址应为不含密钥、查询参数或片段的 HTTP(S) URL');
    if(u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('远程图片服务请使用 HTTPS');
    c.endpoint=u.toString().replace(/\/$/,'');
    if(c.protocol==='openai'&&!/\/images\/generations$/.test(c.endpoint))c.endpoint+='/images/generations';
    if(typeof c.model!=='string'||!c.model.trim()||c.model.length>200)throw Error('请输入模型名称');
    c.model=c.model.trim();
  }
  if(typeof c.keyFile!=='string'||c.keyFile.length>4096)throw Error('密钥文件路径无效');
  if(!['multipart','json','none'].includes(c.referenceMode))throw Error('参考图协议无效');
  if(!c.extra||typeof c.extra!=='object'||Array.isArray(c.extra)||JSON.stringify(c.extra).length>12000)throw Error('额外参数应为 JSON 对象（最多 12 KB）');
  for(const k of ['model','prompt','input','messages','n','image','images','api_key','apiKey','authorization','Authorization'])if(k in c.extra)throw Error('额外参数不能覆盖 '+k);
  return c;
}
class ImageConfig {
  constructor(directory,safeStorage){this.file=path.join(directory,'image-service.json');this.safe=safeStorage;}
  read(){if(!fs.existsSync(this.file))return {...defaults};return validate({...defaults,...JSON.parse(fs.readFileSync(this.file,'utf8'))});}
  public(){const {encryptedKey,...c}=this.read();return {...c,hasKey:!!encryptedKey||!!(c.keyFile?fs.existsSync(c.keyFile):process.env.FOLIO_IMAGE_API_KEY?.trim())};}
  key(){const c=this.read();if(c.encryptedKey){if(!this.safe.isEncryptionAvailable())throw Error('无法解密图片服务密钥');return this.safe.decryptString(Buffer.from(c.encryptedKey,'base64'));}if(c.keyFile){try{return fs.readFileSync(c.keyFile,'utf8').trim().replace(/^\uFEFF/,'');}catch{throw Error('无法读取图片密钥文件，请在生图模型提供方设置中配置');}}return (process.env.FOLIO_IMAGE_API_KEY||'').trim();}
  save(value){const old=this.read();const {apiKey,clearKey,...changes}=value;for(const k of Object.keys(changes))if(!['protocol','endpoint','model','keyFile','referenceMode','extra','hasKey'].includes(k))throw Error('未知配置项：'+k);const c=validate({...old,...changes});delete c.hasKey;
    if(clearKey)delete c.encryptedKey;
    if(apiKey){if(!this.safe.isEncryptionAvailable())throw Error('系统密钥保护不可用，改用密钥文件');if(/\s/.test(apiKey.trim()))throw Error('API 密钥不能包含空白');c.encryptedKey=this.safe.encryptString(apiKey.trim()).toString('base64');c.keyFile='';}
    else if(changes.keyFile)delete c.encryptedKey;
    fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(c));fs.renameSync(tmp,this.file);return this.public();
  }
}
module.exports={ImageConfig,validate,defaults};

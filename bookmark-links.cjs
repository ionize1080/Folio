const dns=require('node:dns/promises'),net=require('node:net');
function publicAddress(ip){
  if(net.isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127));}
  return net.isIP(ip)===6 && !/^(::|fc|fd|fe[89ab]|ff)/i.test(ip);
}
async function checkLinks(items,fetch){
  if(!Array.isArray(items)||items.length>2000)throw Error('每批最多检查 2000 个网络链接');
  const results=[],cache=new Map();let next=0;
  async function one(uri){try{
    let url=new URL(uri);for(let redirects=0;redirects<6;redirects++){
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('仅检测公开 HTTP(S) 链接');
      const addresses=await dns.lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true});if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw Error('本地或私有网络地址未检测');
      const r=await fetch(url.href,{method:'HEAD',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(8000)});
      await r.body?.cancel();if([301,302,303,307,308].includes(r.status)){url=new URL(r.headers.get('location'),url);continue;}
      return {status:[404,410].includes(r.status)?'dead':r.status>=200&&r.status<300?'ok':'unknown',message:`HTTP ${r.status}`};
    }throw Error('重定向过多');
  }catch(e){return {status:'unknown',message:e.message};}}
  await Promise.all(Array.from({length:4},async()=>{while(next<items.length){const item=items[next++];if(typeof item.uri!=='string'||item.uri.length>8192)throw Error('链接无效');if(!cache.has(item.uri))cache.set(item.uri,one(item.uri));results.push({id:item.id,...await cache.get(item.uri)});}}));return results;
}
module.exports={checkLinks,publicAddress};

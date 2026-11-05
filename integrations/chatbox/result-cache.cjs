const crypto=require('node:crypto');
class ResultCache {
  constructor(){this.values=new Map();this.bytes=0;}
  put(result) {
    if(result?.isError || result?.content?.some(b=>b.type!=='text'))return result;
    const text=JSON.stringify(result);
    if(text.length<=12000)return result;
    if(text.length>8*1024*1024)throw Error('结果超过8 MB预算，请缩小页范围或请求摘要');
    while(this.bytes+text.length>16*1024*1024 || this.values.size>=8){const [key,v]=this.values.entries().next().value;this.values.delete(key);this.bytes-=v.text.length;}
    const resultId=crypto.randomUUID();this.values.set(resultId,{text,time:Date.now()});this.bytes+=text.length;
    return this.read({resultId});
  }
  read({resultId,offset=0,limit=12000}) {
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>20000)throw Error('无效分页：offset>=0，limit为1至20000字符');
    const v=this.values.get(resultId);
    if(!v || Date.now()-v.time>10*60*1000)throw Error('结果缓存已过期，请重新执行原操作');
    return {paged:true,resultId,totalChars:v.text.length,offset,text:v.text.slice(offset,offset+limit),nextOffset:offset+limit<v.text.length?offset+limit:null,note:'原始JSON的分页片段。使用pdf_operation resultId/offset读取后续，不要重复执行文件操作。'};
  }
}
module.exports={ResultCache};

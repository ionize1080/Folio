window.folioParseReview=text=>{
 if(typeof text!=='string'||text.length>800000)throw Error('AI 结构报告大小无效');
 let attempts=0;
 for(let start=0;start<text.length;start++){
  if(text[start]!=='{')continue;if(++attempts>32)break;
  let depth=0,quoted=false,escaped=false;
  for(let i=start;i<text.length;i++){
   const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
   if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return JSON.parse(text.slice(start,i+1));}catch{break;}}
  }
 }
 throw Error('AI 未返回有效结构 JSON');
};

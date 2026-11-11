import {clone,makeNode,childrenMap,flattenChildren,depths,descendants,MODES} from './model.mjs';
import {pageRange} from './generation.mjs';
export function auditBookmarks(nodes,pageCount,{ignoreCase=true}={}){
  const issues=[],ids=new Set(nodes.map(n=>n.id)),seen=new Set(),titles=new Map(),levels=new Map(),pages=new Set();
  const add=(n,code,message,repairable=false)=>issues.push({id:n.id,code,message,repairable,title:n.title});
  for(const n of nodes){
    if(seen.has(n.id))add(n,'id','重复节点 ID');
    if(n.parent!==null&&!ids.has(n.parent))add(n,'orphan','父节点不存在',true);
    else if(n.parent!==null&&!seen.has(n.parent))add(n,'hierarchy','父节点位于子节点之后或存在循环',true);
    seen.add(n.id);levels.set(n.id,n.parent===null?1:(levels.get(n.parent)||0)+1);
    const title=String(n.title||'').normalize('NFKC').trim().replace(/\s+/gu,' '),key=ignoreCase?title.toLocaleLowerCase():title;
    if(!title)add(n,'empty','空标题',true);
    if(title!==n.title)add(n,'space','标题含首尾空白或不规范空白',true);
    if(key){const previous=titles.get(key);if(previous){if(previous.length===1)add(previous[0],'duplicate','重复标题');add(n,'duplicate','重复标题');previous.push(n);}else titles.set(key,[n]);}
    const t=n.target||{};
    if(t.page!=null){if(!Number.isInteger(t.page)||t.page<1||t.page>pageCount)add(n,'page','目标页码超出文档范围');else pages.add(t.page);}
    if(t.kind==='dest'){
      if(t.page==null)add(n,'page','缺少目标页码');
      if(!(t.mode in MODES)||!Array.isArray(t.args)||t.args.length!==MODES[t.mode]||t.args.some(v=>v!==null&&!Number.isFinite(v)))add(n,'coordinates','跳转坐标无效',true);
      else if(t.mode==='FitR'&&(t.args.some(v=>v===null)||t.args[2]<=t.args[0]||t.args[3]<=t.args[1]))add(n,'coordinates','跳转矩形无效',true);
      else if(t.mode==='XYZ'&&t.args[2]<0)add(n,'coordinates','缩放比例为负数',true);
    }else if(t.kind==='preserve'){
      if(t.actionType==='URI'){
        try{const u=new URL(t.uri);if(!['http:','https:','mailto:','tel:'].includes(u.protocol))add(n,'uri','链接协议不受支持');else if(/^https?:$/.test(u.protocol))add(n,'unchecked','网络链接尚未检测可达性');}catch{add(n,'uri','URI 链接格式无效');}
      }else if(t.actionType==='GoToR'||t.actionType==='Launch')add(n,'external','外部文件链接需核对文件位置');
      else if(!t.page&&!t.actionType)add(n,'dead','无有效跳转动作或命名目标失效');
      else if(!t.page&&t.actionType==='GoTo')add(n,'dead','本地跳转目标失效');
      else if(!t.page&&!['Named','JavaScript','GoTo','URI','GoToR','Launch'].includes(t.actionType))add(n,'action','无法识别的动作');
      if(t.hasNext)add(n,'chain','包含后续动作，请复核动作链');
    }else add(n,'dead','缺少目标');
  }
  return {issues,stats:{total:nodes.length,roots:nodes.filter(n=>n.parent===null).length,depth:[...levels.values()].reduce((a,b)=>Math.max(a,b),0),targetPages:pages.size,affected:new Set(issues.map(x=>x.id)).size}};
}
export function repairBookmarks(nodes,ids,pageCount,{targetPage}={}){
  const out=clone(nodes),seen=new Set();
  for(const n of out){
    if(ids.has(n.id)){
      n.title=String(n.title||'').normalize('NFKC').trim().replace(/\s+/gu,' ')||`未命名书签${n.target?.page?' · '+n.target.page:''}`;
      if(n.parent!==null&&!seen.has(n.parent))n.parent=null;
      if(targetPage!==undefined){if(!Number.isInteger(targetPage)||targetPage<1||targetPage>pageCount)throw Error('请选择有效的修复目标页');n.target={kind:'dest',page:targetPage,mode:'Fit',args:[]};}
      else if(n.target?.kind==='dest'&&Number.isInteger(n.target.page)&&n.target.page>=1&&n.target.page<=pageCount){
        if(auditBookmarks([{...n,parent:null}],pageCount).issues.some(x=>x.code==='coordinates'))n.target={kind:'dest',page:n.target.page,mode:'Fit',args:[]};
      }
    }seen.add(n.id);
  }
  return flattenChildren(childrenMap(out));
}
export function deleteBookmarks(nodes,ids,subtree=false){
  const removed=subtree?descendants(nodes,ids):new Set(ids),byId=new Map(nodes.map(n=>[n.id,n]));
  return nodes.filter(n=>!removed.has(n.id)).map(n=>{let parent=n.parent;const seen=new Set();while(removed.has(parent)&&!seen.has(parent)){seen.add(parent);parent=byId.get(parent)?.parent??null;}return {...n,parent};});
}
export function sortBookmarks(nodes,{by='page',descending=false,ignoreCase=true,natural=true,level=1,recursive=false,ids=null}={}){
  const out=clone(nodes),map=childrenMap(out),d=depths(out),allowed=ids?descendants(out,ids):null;
  const collator=new Intl.Collator(undefined,{numeric:natural,sensitivity:ignoreCase?'base':'variant'});
  for(const [parent,kids] of map){
    const depth=parent===null?1:d.get(parent)+2;
    if(!recursive&&depth!==level)continue;
    const positions=kids.flatMap((n,i)=>!allowed||allowed.has(n.id)?[i]:[]);
    const sorted=positions.map(i=>kids[i]).sort((a,b)=>{
      let diff;
      if(by==='page'){const ap=a.target?.external?null:a.target?.page,bp=b.target?.external?null:b.target?.page;if(!ap||!bp)return ap?-1:bp?1:0;diff=ap-bp;}
      else diff=collator.compare(a.title.trim(),b.title.trim());
      return descending?-diff:diff;
    });positions.forEach((p,i)=>kids[p]=sorted[i]);
  }
  return flattenChildren(map);
}
export function everyNBookmarks({pageCount,range=`1-${pageCount}`,parity='all',interval=1,template='第 {page} 页',start=1,pad=0,parent=null,filename='',labels=[],firstLines=[]}){
  if(!Number.isInteger(interval)||interval<1||!Number.isInteger(start)||!Number.isInteger(pad)||pad<0||pad>12)throw Error('间隔、编号及补零位数无效');
  const pages=pageRange(range,pageCount,parity).filter((_,i)=>i%interval===0);
  if(!template.trim())throw Error('请输入标题模板');
  return pages.map((page,i)=>makeNode(template.replace(/\{(page|index|pages|label|filename|text)\}/g,(_,k)=>({page,index:String(start+i).padStart(pad,'0'),pages:pageCount,label:labels[page-1]||page,filename,text:firstLines[page-1]||''})[k]),page,parent));
}

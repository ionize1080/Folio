export function selectBookmarkIds(nodes, selector) {
  if (!selector || typeof selector !== 'object') throw Error('请明确提供 selector，例如 {scope:"all"}');
  const keys=Object.keys(selector);
  if(keys.some(k=>!['scope','ids','title','page'].includes(k)))throw Error('未知书签选择条件');
  if(selector.scope && !['all','roots'].includes(selector.scope))throw Error('scope 必须为 all 或 roots');
  if(!keys.length)throw Error('书签选择条件不能为空');
  if(selector.ids && (!Array.isArray(selector.ids)||selector.ids.some(id=>!nodes.some(n=>n.id===id))))throw Error('书签ID不存在');
  if(selector.title!==undefined && typeof selector.title!=='string')throw Error('title 必须为文字');
  if(selector.page!==undefined && (!Number.isInteger(selector.page)||selector.page<1))throw Error('页码无效');
  return nodes.filter(n=>(selector.scope!=='roots'||!n.parent)&&(!selector.ids||selector.ids.includes(n.id))&&
    (selector.title===undefined||n.title.includes(selector.title))&&(selector.page===undefined||n.target?.page===selector.page)).map(n=>n.id);
}
export function calibrationPages(nodes, pageCount, radius=2) {
  if(!Number.isInteger(radius)||radius<0||radius>10)throw Error('搜索半径须为0至10页');
  return [...new Set(nodes.flatMap(n=>Number.isInteger(n.target?.page)?Array.from({length:radius*2+1},(_,i)=>n.target.page-radius+i):[]))]
    .filter(p=>p>=1&&p<=pageCount).sort((a,b)=>a-b);
}
export function calibrationPlan(results, threshold=0.95) {
  if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw Error('阈值须为0至1');
  const accepted=[],review=[];
  for(const r of results) {
    const [first,second]=r.candidates;
    // These are evidence classes, not a statistical claim of recognition accuracy.
    const evidenceConfidence=!first?0:second && first.score-second.score<30?0.5:first.score>=100?0.99:first.score>=90?0.95:first.score>=25?0.75:0.35;
    const ocr=(first?.segments||[]).filter(s=>s.source==="OCR");
    const confidence=Math.min(evidenceConfidence,...ocr.map(s=>s.confidence??0));
    const item={id:r.id,title:r.title,confidence,reason:first?.evidence||r.reason};
    if(first && confidence>=threshold)accepted.push({...item,target:first.target});
    else review.push({...item,candidates:r.candidates.slice(0,3).map(c=>({text:c.text,page:c.page,target:c.target,evidence:c.evidence}))});
  }
  return {accepted,review};
}
export function pageResult(items, {offset=0,limit=100}={}) {
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>500)throw Error('offset须为非负整数，limit须为1至500');
  return {total:items.length,offset,items:items.slice(offset,offset+limit),nextOffset:offset+limit<items.length?offset+limit:null};
}

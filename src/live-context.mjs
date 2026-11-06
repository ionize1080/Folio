// Read geometry at tool execution time, independently of asynchronous page rendering.
export function installLiveContext({S,view}) {
 let stored=null,documentBytes=null,pointer=null;
 const pageFor=node=>(node?.nodeType===1?node:node?.parentElement)?.closest('.pdf-page[data-page]');
 const clip=(r,p)=>{
  const left=Math.max(r.left,p.left),top=Math.max(r.top,p.top),right=Math.min(r.right,p.right),bottom=Math.min(r.bottom,p.bottom);
  return right>left&&bottom>top&&p.width>0&&p.height>0?[(left-p.left)/p.width,(top-p.top)/p.height,(right-left)/p.width,(bottom-top)/p.height]:null;
 };
 function sample(){
  const selection=window.getSelection(),start=pageFor(selection?.anchorNode),end=pageFor(selection?.focusNode);
  if(!start||!end||selection.isCollapsed)return null;
  const text=selection.toString();if(!text)return null;
  const rectangles=[];
  for(let i=0;i<selection.rangeCount;i++){
   const range=selection.getRangeAt(i);
   for(const page of document.querySelectorAll('.pdf-page[data-page]')){
    const box=page.getBoundingClientRect();
    for(const rect of range.getClientRects()){
     const region=clip(rect,box);if(region)rectangles.push({page:Number(page.dataset.page),region});
     if(rectangles.length>=200)break;
    }
    if(rectangles.length>=200)break;
   }
  }
  return {text:text.slice(0,12000),truncated:text.length>12000,anchorPage:Number(start.dataset.page),focusPage:Number(end.dataset.page),rectangles,coordinateSpace:'normalized top-left, rotated page'};
 }
 document.addEventListener('selectionchange',()=>{const fresh=sample();if(fresh){stored=fresh;documentBytes=S.bytes;}});
 document.querySelector('#canvas-host')?.addEventListener('pointerdown',e=>{
  const page=pageFor(e.target);stored=null;documentBytes=S.bytes;
  if(page){const r=page.getBoundingClientRect();pointer={page:Number(page.dataset.page),point:[(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]};}
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape')stored=null;});
 return ()=>{
  if(documentBytes!==S.bytes){stored=null;pointer=null;documentBytes=S.bytes;}
  const textSelection=sample()||stored,viewport=view?.()||{currentPage:S.page};
  return {...viewport,textSelection,pointer};
 };
}

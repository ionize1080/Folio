import {nativeRequest} from "./native-source.mjs";
const escape = value => String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
const validId = id => typeof id==="string" && /^[a-zA-Z][\w.-]{0,60}$/.test(id);

export function flowSVG(flow) {
  const nodes=flow?.nodes, edges=flow?.edges;
  if(!Array.isArray(nodes)||!nodes.length||nodes.length>60||!Array.isArray(edges)||edges.length>120) throw Error("Use 1–60 nodes and at most 120 edges");
  const index = new Map(nodes.map((n,i)=>[n.id,i]));
  if(index.size!==nodes.length || nodes.some(n=>!validId(n.id)||typeof n.label!=="string"||n.label.length>100)) throw Error("Give each node a unique id and a short label");
  const incoming=nodes.map(()=>0), next=nodes.map(()=>[]), rank=nodes.map(()=>0);
  for(const edge of edges) {
    if(!index.has(edge.from)||!index.has(edge.to)) throw Error("Unknown edge endpoint");
    const a=index.get(edge.from),b=index.get(edge.to);incoming[b]++;next[a].push(b);
  }
  const queue=nodes.map((_,i)=>i).filter(i=>incoming[i]===0);
  for(let p=0;p<queue.length;p++) for(const b of next[queue[p]]) {
    rank[b]=Math.max(rank[b],rank[queue[p]]+1);
    if(--incoming[b]===0)queue.push(b);
  }
  if(queue.length!==nodes.length)throw Error("For loops, supply SVG with explicit paths or use an acyclic flow.");
  const count=[], row=rank.map(r=>{const n=count[r]||0;count[r]=n+1;return n;});
  const widths=nodes.map(n=>Math.max(112,Math.min(760,Array.from(n.label).reduce((v,c)=>v+(c.charCodeAt(0)>255?16:9),28))));
  const width=Math.max(...widths), cell=width+40;
  const cols=Math.max(...count), total=cols*cell;
  const positions=nodes.map((n,i)=>({x:(total-count[rank[i]]*cell)/2+row[i]*cell+20,y:20+rank[i]*94}));
  const paths=edges.map(({from,to,label},i)=>{
    const a=positions[index.get(from)],b=positions[index.get(to)],x=a.x+width/2,X=b.x+width/2,y=a.y+44,Y=b.y,mid=(y+Y)/2;
    return '<g id="edge-'+i+'"><path d="M'+x+' '+y+' V'+mid+' H'+X+' V'+(Y-4)+'" fill="none" stroke="#526475" stroke-width="2"/><path d="M'+(X-4)+' '+(Y-7)+' l4 7 4 -7" fill="#526475"/>'+(label?'<text x="'+((x+X)/2+5)+'" y="'+(mid-4)+'" font-size="12">'+escape(label)+'</text>':'')+'</g>';
  });
  const boxes=nodes.map((n,i)=>{
    const {x,y}=positions[i];
    return '<g id="'+n.id+'"><rect id="'+n.id+'-box" x="'+x+'" y="'+y+'" width="'+width+'" height="44" rx="7" fill="#edf4fb" stroke="#517398"/><text id="'+n.id+'-label" x="'+(x+width/2)+'" y="'+(y+28)+'" text-anchor="middle" font-size="16" fill="#162a40">'+escape(n.label)+'</text></g>';
  });
  const height=86+Math.max(...rank)*94;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+total+'" height="'+height+'" viewBox="0 0 '+total+' '+height+'">'+paths.join("")+boxes.join("")+'</svg>';
}
export async function vectorTool(a,{S,rev,applyContent,approve},deadline) {
  if(!S.pdf || S.busy) throw Error("Open an idle document");
  const revision=rev(),page=a.page??S.page;
  if(!Number.isInteger(page)||page<1||page>S.info.pageCount)throw Error("Invalid page");
  if(!approve(a)) throw Error("用户拒绝操作");
  const {graphics}=await nativeRequest({command:"vector-list",bytes:S.bytes,page});
  const all=new Map(graphics.map(g=>[g.id,g]));
  for(const e of S.nativeEdits) if(e.type==="vector-graphic" && e.page===page)all.set(e.id,e);
  const old=all.get(a.id);
  if(a.action==="list") return {revision,page,pageBox:(await S.pdf.getPage(page)).view,coordinates:"PDF points, bottom-left origin",graphics:[...all.values()].map(({id,box})=>({id,box}))};
  if(a.action==="read") {if(!old)throw Error("Graphic ID not found");return {id:old.id,svg:old.svg,box:old.box,revision,page};}
  if(!["create","update"].includes(a.action)||a.revision!==revision)throw Error("Get the current revision with list before creating or updating");
  if(a.action==="update" && !old)throw Error("Graphic ID not found");
  const id=a.action==="create"?crypto.randomUUID():old.id;
  let svg=a.flow?flowSVG(a.flow):a.svg??old?.svg;
  if(typeof svg!=="string"||svg.length>160000)throw Error("Supply a self-contained SVG or flow");
  if(a.patches) {
    const xml=new DOMParser().parseFromString(svg,"image/svg+xml");
    if(xml.querySelector("parsererror")||!Array.isArray(a.patches)||a.patches.length>100)throw Error("Invalid SVG or patch list");
    for(const patch of a.patches) {
      const node=xml.getElementById(patch.id);
      if(!node)throw Error("Unknown SVG element: "+patch.id);
      if(patch.text!==undefined)node.textContent=String(patch.text);
      for(const [key,value] of Object.entries(patch.attributes||{}))node.setAttribute(key,String(value));
    }
    svg=new XMLSerializer().serializeToString(xml.documentElement);
  }
  const [l,b,r,t]=(await S.pdf.getPage(page)).view;
  const box=a.box??old?.box??[l+(r-l)*.1,b+(t-b)*.35,(r-l)*.8,(t-b)*.45];
  if(rev()!==revision||Date.now()>deadline)throw Error("Document changed");
  await applyContent([...S.nativeEdits.filter(e=>!(e.type==="vector-graphic"&&e.page===page&&e.id===id)),{id,page,type:"vector-graphic",svg,box}],S.ocr);
  return {applied:true,id,page,box,revision:rev()};
}

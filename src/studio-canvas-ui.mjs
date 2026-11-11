import {artworkBounds} from './creative-background.mjs';
import {contentBounds,expandedCanvas,studioTransform} from './studio-canvas-geometry.mjs';

export function installStudioCanvas({root,embedded,current,run,status}) {
  const button=root.querySelector('[data-canvas-handles]'),automatic=root.querySelector('[data-auto-canvas]');
  const ns='http://www.w3.org/2000/svg',layer=document.createElementNS(ns,'svg');layer.classList.add('studio-canvas-handles');layer.hidden=true;
  layer.setAttribute('aria-label','拖动画布边界，保持作品比例');embedded.mount.append(layer);
  const outline=document.createElementNS(ns,'polygon');outline.setAttribute('fill','none');layer.append(outline);
  const corners=[[0,0],[.5,0],[1,0],[1,.5],[1,1],[.5,1],[0,1],[0,.5]];
  const handles=corners.map((_,i)=>{const h=document.createElementNS(ns,'rect');h.dataset.handle=i;h.setAttribute('width',12);h.setAttribute('height',12);h.setAttribute('rx',3);h.style.cursor=['nwse','ns','nesw','ew','nwse','ns','nesw','ew'][i]+'-resize';layer.append(h);return h;});
  let active=false,working=false,gesture=null,lastState=null,lastId=null,pointerDown=false,lastInput=0,closed=false;
  const hooks=new WeakSet();
  function attach(s){if(hooks.has(s.frame))return;hooks.add(s.frame);const doc=s.frame.contentDocument;
    doc.addEventListener('pointerdown',()=>{pointerDown=true;lastInput=Date.now();},true);
    for(const name of ['pointerup','pointercancel'])doc.addEventListener(name,()=>{pointerDown=false;lastInput=Date.now();},true);
    doc.addEventListener('keydown',e=>{lastInput=Date.now();if(e.key==='Escape'&&active)toggle(false);},true);
  }
  function toggle(value){active=value;button.setAttribute('aria-pressed',String(value));layer.style.display='none';if(gesture)gesture.s.frame.style.pointerEvents='';gesture=null;if(value){status('拖动边角调整画布；内容保持原尺寸。按 Esc 结束。');tick();}}
  button.onclick=()=>toggle(!active);
  automatic.onchange=()=>{const s=embedded.sessions.get(current());if(s){s.autoExpand=automatic.checked;s.autoBoundaryWarned=false;lastInput=0;tick();}};
  function draw(bounds,state,s){
    if(!active)return;const map=studioTransform(s.kind,state),f=s.frame.getBoundingClientRect(),mount=embedded.mount.getBoundingClientRect();
    const [rx,ry,rw,rh]=map.rect;Object.assign(layer.style,{left:(f.left-mount.left+rx)+'px',top:(f.top-mount.top+ry)+'px',width:rw+'px',height:rh+'px'});layer.setAttribute('viewBox',`0 0 ${rw} ${rh}`);
    const points=corners.map(([u,v])=>{const [x,y]=map.toScreen([bounds[0]+bounds[2]*u,bounds[1]+bounds[3]*v]);return [x-rx,y-ry];});
    outline.setAttribute('points',points.filter((_,i)=>i%2===0).map(p=>p.join(',')).join(' '));handles.forEach((h,i)=>{h.setAttribute('x',points[i][0]-6);h.setAttribute('y',points[i][1]-6);});layer.style.display='block';
  }
  function boundaryNotice(s,matrix){if(!s.reference||s.autoBoundaryWarned)return;const [l,b,r,t]=s.reference.bounds,[a,c,u,d,e,f]=matrix;const outside=[[0,0],[1,0],[1,1],[0,1]].some(([x,y])=>{const px=e+a*x+u*y,py=f+c*x+d*y;return px<l||px>r||py<b||py>t;});if(outside){s.autoBoundaryWarned=true;status('作品已超出 PDF 页面，仍可继续绘制；页面外内容保留在作品和工程中。');}}
  async function resize(s,bounds){working=true;try{const result=await run({action:'canvas-resize',sessionId:s.id,bounds});boundaryNotice(s,result.matrix);lastState=await run({action:'inspect',sessionId:s.id});draw(artworkBounds(s.kind,lastState),lastState,s);}catch(e){status(e.message);}finally{working=false;}}
  async function tick(){
    if(closed||working||gesture||pointerDown||!document.body.classList.contains('studio-active'))return;
    const s=embedded.sessions.get(current());if(!s)return;attach(s);
    if(lastId!==s.id){lastId=s.id;lastState=null;toggle(false);automatic.checked=!!s.autoExpand;}
    if(!active&&!s.autoExpand)return;
    working=true;
    try{lastState=await run({action:'inspect',sessionId:s.id});const bounds=artworkBounds(s.kind,lastState);if(gesture)return;draw(bounds,lastState,s);
      if(s.autoExpand&&Date.now()-lastInput>450){
        const content=contentBounds(lastState.document,s.kind),next=expandedCanvas(bounds,content);
        if(next){working=false;await resize(s,next);}
      }
    }catch(e){status(e.message);}finally{working=false;}
  }
  function point(e,s,state){const r=s.frame.getBoundingClientRect();return studioTransform(s.kind,state).toDocument([e.clientX-r.left,e.clientY-r.top]);}
  layer.onpointerdown=e=>{if(e.button!==0||e.target.dataset.handle===undefined||!lastState)return;const s=embedded.get(current());e.preventDefault();gesture={s,state:lastState,base:artworkBounds(s.kind,lastState),handle:corners[+e.target.dataset.handle]};layer.style.pointerEvents='auto';s.frame.style.pointerEvents='none';layer.setPointerCapture(e.pointerId);};
  layer.onpointermove=e=>{if(!gesture)return;const {base,handle,s,state}=gesture,[px,py]=point(e,s,state),[x,y,w,h]=base,[hx,hy]=handle;
    let l=hx===0?Math.min(px,x+w-1):x,t=hy===0?Math.min(py,y+h-1):y,r=hx===1?Math.max(px,x+1):x+w,b=hy===1?Math.max(py,y+1):y+h;
    if(e.shiftKey&&hx!==.5&&hy!==.5){const nw=r-l,nh=b-t,k=Math.abs(nw-w)>Math.abs(nh-h)?nw/w:nh/h;if(hx===0)l=r-w*k;else r=l+w*k;if(hy===0)t=b-h*k;else b=t+h*k;}
    gesture.next=[l,t,r-l,b-t].map(v=>s.kind==='photo'?Math.round(v):v);draw(gesture.next,state,s);
  };
  layer.onpointerup=async e=>{if(!gesture)return;const g=gesture;gesture=null;g.s.frame.style.pointerEvents='';layer.style.pointerEvents='none';if(layer.hasPointerCapture(e.pointerId))layer.releasePointerCapture(e.pointerId);if(g.next)await resize(g.s,g.next);};
  const cancel=()=>{if(gesture){const g=gesture;gesture=null;g.s.frame.style.pointerEvents='';layer.style.pointerEvents='none';draw(g.base,g.state,g.s);}};layer.onpointercancel=cancel;layer.onlostpointercapture=cancel;document.addEventListener('pointermove',e=>{if(e.target!==layer&&!layer.contains(e.target))layer.onpointermove(e);});document.addEventListener('pointerup',e=>{if(e.target!==layer&&!layer.contains(e.target))layer.onpointerup(e);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){if(gesture)cancel();else toggle(false);}});
  embedded.addEventListener('show',()=>{lastId=null;toggle(false);});
  const timer=setInterval(tick,active?200:650);window.addEventListener('unload',()=>{closed=true;clearInterval(timer);});
  return {refresh:()=>{lastId=current();const s=embedded.sessions.get(current());automatic.checked=!!s?.autoExpand;toggle(false);},stop:()=>toggle(false)};
}

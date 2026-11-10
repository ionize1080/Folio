import {dragPlacement} from './placement-gesture.mjs';
export async function editPlacementOnPage({S,surface,info,apply,done}) {
  const owner=S.sessionId,page=info.page;
  await surface.refresh();
  await surface.go(page,null,false);
  let matrix=[...info.matrix],gesture=null,busy=false,closed=false,located=false;
  const bar=document.createElement('aside');bar.className='placement-page-bar';
  bar.innerHTML='<strong>作品位置与尺寸</strong><label class="check"><input type="checkbox" checked>锁定宽高比</label><span role="status">拖动作品移动，拖动四角缩放；Esc 取消本次拖动。</span><button>返回工作室</button>';
  document.body.append(bar);
  const ns='http://www.w3.org/2000/svg',layer=document.createElementNS(ns,'svg');layer.classList.add('placement-page-layer');
  layer.setAttribute('aria-label','拖动作品或四角调整位置与尺寸');
  const shape=document.createElementNS(ns,'polygon');shape.dataset.move='';layer.append(shape);
  const corners=[[0,0],[1,0],[1,1],[0,1]],handles=corners.map((c,i)=>{const h=document.createElementNS(ns,'circle');h.dataset.corner=i;h.setAttribute('r','6');layer.append(h);return h;});
  const status=bar.querySelector('[role=status]');
  function draw(){
    if(closed)return;
    if(owner!==S.sessionId||document.body.classList.contains('studio-active')){close(false);return;}
    const entry=surface.entries.get(page);if(!entry?.viewport)return;
    if(layer.parentElement!==entry.shell)entry.shell.append(layer);
    const v=entry.viewport;layer.setAttribute('viewBox',`0 0 ${v.width} ${v.height}`);layer.style.width=v.width+'px';layer.style.height=v.height+'px';
    const [a,b,c,d,e,f]=matrix,points=corners.map(([u,w])=>v.convertToViewportPoint(a*u+c*w+e,b*u+d*w+f));
    shape.setAttribute('points',points.map(p=>p.join(',')).join(' '));if(!located){located=true;shape.scrollIntoView({block:'center',inline:'nearest'});}handles.forEach((h,i)=>{h.setAttribute('cx',points[i][0]);h.setAttribute('cy',points[i][1]);});
  }
  const point=e=>{const r=layer.getBoundingClientRect();return surface.entries.get(page).viewport.convertToPdfPoint(e.clientX-r.left,e.clientY-r.top);};
  layer.onpointerdown=e=>{if(busy||e.button!==0||surface.space)return;e.preventDefault();e.stopPropagation();gesture={base:[...matrix],start:point(e),corner:e.target.dataset.corner===undefined?null:corners[Number(e.target.dataset.corner)]};layer.setPointerCapture(e.pointerId);};
  layer.onpointermove=e=>{if(!gesture)return;matrix=dragPlacement(gesture.base,gesture.start,point(e),gesture.corner,bar.querySelector('input').checked||e.shiftKey);status.textContent='拖动中…';draw();};
  const cancel=()=>{if(gesture){matrix=gesture.base;gesture=null;status.textContent='已取消本次拖动';draw();}};
  layer.onpointercancel=cancel;layer.onlostpointercapture=cancel;
  layer.onpointerup=async e=>{
    if(!gesture)return;const base=gesture.base;gesture=null;if(layer.hasPointerCapture(e.pointerId))layer.releasePointerCapture(e.pointerId);
    if(matrix.every((v,i)=>Math.abs(v-base[i])<1e-7))return;
    busy=true;bar.querySelector('button').disabled=true;status.textContent='正在应用…';
    try{await apply(matrix);status.textContent='已应用，可撤销。拖动作品或四角继续调整。';}catch(error){matrix=base;status.textContent=error.message;}finally{busy=false;bar.querySelector('button').disabled=false;draw();}
  };
  function key(e){if(e.key==='Escape'&&gesture){e.preventDefault();cancel();}}
  function close(returnToStudio=true){if(busy)return;closed=true;clearInterval(timer);document.removeEventListener('keydown',key,true);layer.remove();bar.remove();if(returnToStudio)done();}
  const timer=setInterval(draw,250);document.addEventListener('keydown',key,true);bar.querySelector('button').onclick=()=>close();
  // The normal PDF surface retains page rendering, zoom, rotation and crop origins.
  if(S.page!==page){document.querySelector('#page-number').value=page;document.querySelector('#page-number').dispatchEvent(new Event('change',{bubbles:true}));}
  draw();
}

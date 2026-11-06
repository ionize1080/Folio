export function installAIResize(desktop) {
  const handle=document.createElement('div');
  handle.className='ai-resize-handle';handle.tabIndex=0;
  handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label','调整 AI 侧栏宽度');
  document.body.append(handle);
  let width=Number(localStorage.getItem('folio-ai-width'))||480, dragging=false;
  function layout(save=false) {
    const max=Math.max(280,Math.min(1000,innerWidth-180));
    width=Math.max(280,Math.min(max,width));
    document.body.style.setProperty('--ai-width',width+'px');
    const r=document.querySelector('.inspector').getBoundingClientRect();
    Object.assign(handle.style,{left:(r.left-5)+'px',top:r.top+'px',height:r.height+'px'});
    handle.setAttribute('aria-valuemin','280');handle.setAttribute('aria-valuemax',String(max));handle.setAttribute('aria-valuenow',String(Math.round(width)));
    if(save)localStorage.setItem('folio-ai-width',String(width));
  }
  handle.onpointerdown=e=>{if(e.button!==0)return;dragging=true;handle.setPointerCapture(e.pointerId);desktop.aiOverlay(true);document.body.classList.add('ai-resizing');e.preventDefault();};
  handle.onpointermove=e=>{if(dragging){width=innerWidth-e.clientX;layout();}};
  const end=()=>{if(!dragging)return;dragging=false;document.body.classList.remove('ai-resizing');desktop.aiOverlay(false);layout(true);};
  handle.onpointerup=end;handle.onpointercancel=end;handle.onlostpointercapture=end;
  handle.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();width=e.key==='Home'?280:e.key==='End'?1000:width+(e.key==='ArrowLeft'?1:-1)*(e.shiftKey?50:10);layout(true);};
  handle.ondblclick=()=>{width=480;layout(true);};
  new ResizeObserver(()=>layout()).observe(document.querySelector('main'));
  new ResizeObserver(()=>layout()).observe(document.querySelector('.inspector'));
  window.addEventListener('resize',()=>layout());layout();
  window.addEventListener('storage',e=>{if(e.key==='folio-ai-width'){width=Number(e.newValue)||480;layout();}});
}

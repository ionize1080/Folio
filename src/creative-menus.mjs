import {icon} from './icons.mjs';

// One command surface for both engines. IDs and parameters stay untouched;
// labels come from the engine's own localization catalogue.
export function installCreativeMenus({root,session,request,onError}){
  const pop=document.createElement('div');pop.className='studio-command-popover';pop.setAttribute('popover','auto');
  pop.setAttribute('aria-label','编辑工具');
  pop.innerHTML=`<div class="studio-command-search">${icon('search')}<input type="search" placeholder="搜索工具与命令" aria-label="搜索工具与命令"></div><div class="studio-command-body"><nav aria-label="工具分类"></nav><section><div class="studio-command-path"></div><div class="studio-command-list" role="menu"></div></section></div>`;
  document.body.append(pop);
  let rows=[],path=[],anchor,openedSession=null,version=0;
  const search=pop.querySelector('input'),nav=pop.querySelector('nav'),list=pop.querySelector('[role=menu]'),crumb=pop.querySelector('.studio-command-path');
  function position(){if(!anchor)return;const b=anchor.getBoundingClientRect();pop.style.left=Math.max(8,Math.min(b.left,innerWidth-pop.offsetWidth-8))+'px';pop.style.top=(b.bottom+6)+'px';pop.style.maxHeight=Math.max(160,innerHeight-b.bottom-18)+'px';}
  const starts=(a,b)=>b.every((v,i)=>a[i]===v);
  function label(parts){return rows.find(r=>starts(r.path,parts))?.displayPath?.[parts.length-1]||parts.at(-1);}
  function render(){
    nav.replaceChildren();list.replaceChildren();crumb.replaceChildren();
    for(const group of [...new Set(rows.map(r=>r.path[0]))]){
      const b=document.createElement('button');b.textContent=label([group]);b.setAttribute('aria-current',String(path[0]===group&&!search.value));b.onclick=()=>{path=[group];search.value='';render();};nav.append(b);
    }
    const query=search.value.trim().toLowerCase(),shown=rows.filter(r=>query?[r.label,r.id,...r.displayPath||r.path].join(' ').toLowerCase().includes(query):starts(r.path,path));
    if(query)crumb.textContent=`${shown.length} 个结果`;
    else{
      const b=document.createElement('button');b.innerHTML=path.length>1?icon('back'):'';const text=document.createElement('span');text.textContent=path.map((_,i)=>label(path.slice(0,i+1))).join(' / ');b.append(text);b.disabled=path.length<2;b.onclick=()=>{path=path.slice(0,-1);render();};crumb.append(b);
    }
    const groups=new Set();
    for(const row of shown){
      if(!query&&row.path.length>path.length){
        const child=row.path[path.length];if(groups.has(child))continue;groups.add(child);
        const b=document.createElement('button');b.className='studio-menu-sub';b.setAttribute('role','menuitem');const text=document.createElement('span');text.textContent=row.displayPath?.[path.length]||child;b.append(text);b.insertAdjacentHTML('beforeend',icon('chevron-right'));b.onclick=()=>{path=[...path,child];render();};list.append(b);continue;
      }
      const b=document.createElement('button');b.setAttribute('role',row.checked==null?'menuitem':'menuitemcheckbox');if(row.checked!=null)b.setAttribute('aria-checked',String(row.checked));
      b.dataset.command=row.id;b.disabled=!row.enabled;
      const tick=document.createElement('span');tick.className='studio-menu-check';if(row.checked)tick.innerHTML=icon('check');
      const text=document.createElement('span');text.textContent=row.label;const shortcut=document.createElement('kbd');shortcut.textContent=(row.shortcut||'').replaceAll('Cmd','Ctrl');b.append(tick,text,shortcut);
      if(query){b.title=(row.displayPath||row.path).join(' / ');}
      b.onclick=async()=>{pop.hidePopover();const id=openedSession;try{await request({action:'request',sessionId:id,method:session(id).kind==='vector'?'folio.menu.invoke':'ui.menu.invoke',params:{id:row.id,...(row.params!==undefined?{params:row.params}:{})}});session(id).frame.contentWindow.focus();}catch(e){onError(e.message);}};
      list.append(b);
    }
    if(!list.children.length){const p=document.createElement('p');p.className='studio-menu-empty';p.textContent='没有找到匹配的命令';list.append(p);}
    list.scrollTop=0;position();
  }
  search.oninput=render;
  pop.addEventListener('keydown',e=>{
    const items=[...list.querySelectorAll('button:not(:disabled)')];const i=items.indexOf(document.activeElement);
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
    if(e.key==='ArrowLeft'&&!search.matches(':focus')&&path.length>1){e.preventDefault();path.pop();render();list.querySelector('button:not(:disabled)')?.focus();}
    if(e.key==='Escape')anchor?.focus();
  });
  pop.addEventListener('toggle',()=>{if(anchor)anchor.setAttribute('aria-expanded',String(pop.matches(':popover-open')));});
  window.addEventListener('resize',position);
  window.addEventListener('folio-studio-visibility',()=>{if(!document.body.classList.contains('studio-active'))pop.hidePopover();});
  return async function open(button,sessionId,initialPath=[]){
    if(pop.matches(':popover-open')&&anchor===button){pop.hidePopover();return;}
    const stamp=++version;anchor=button;openedSession=sessionId;
    try{
      const result=await request({action:'request',sessionId,method:'folio.menu'});if(stamp!==version)return;
      rows=result.filter(r=>r.id&&r.id!=='---'&&r.path?.length);path=initialPath.length?initialPath:[rows[0]?.path[0]];search.value='';render();
      if(!pop.matches(':popover-open'))pop.showPopover();position();search.focus();
    }catch(e){onError(e.message);}
  };
}

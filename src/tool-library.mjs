import {icon} from './icons.mjs';
export function installToolLibrary(){
 const menu=document.querySelector('.more-tools-menu');if(!menu||menu.dataset.library)return;menu.dataset.library='true';
 const buttons=[...menu.querySelectorAll('button')];
 const search=document.createElement('label');search.className='tool-library-search';search.innerHTML=icon('search')+'<input type="search" placeholder="查找工具…" aria-label="查找工具">';
 const grid=document.createElement('div');grid.className='tool-library-grid';
 const groups=[['创建与转换',['export-word','export-excel','save-project','office-import','web-pdf','document-assembly','document-utilities','save-as','exchange']],['编辑与优化',['page-organizer','pages','edit-content','table-structure','page-diff','decrypt','metadata','font-tools']],['书签与自动化',['ocr-preview','calibrate','calibrate-pages','whitespace','batch','recover','bookmark-qc','bookmark-every','bookmark-sort','smart-toc']]];
 const used=new Set();
 for(const [name,ids] of groups){
   const section=document.createElement('section');const h=document.createElement('h3');h.textContent=name;section.append(h);
   for(const id of ids){const b=buttons.find(b=>(b.id||b.dataset.action)===id);if(b){section.append(b);used.add(b);}}
   grid.append(section);
 }
 const other=buttons.filter(b=>!used.has(b));if(other.length){const section=document.createElement('section');const h=document.createElement('h3');h.textContent='图像与设计';section.append(h,...other);grid.append(section);}
 const empty=document.createElement('p');
 empty.className='tool-library-empty';empty.setAttribute('role','status');empty.textContent='没有匹配的工具';empty.hidden=true;
 menu.replaceChildren(search,grid,empty);
 const details=menu.closest('details'), input=search.querySelector('input');
 function fitMenu(){
   if(!details.open)return;
   const box=details.getBoundingClientRect();
   menu.style.setProperty('--tool-room-x', Math.max(0,box.right-8)+'px');
   menu.style.setProperty('--tool-room-y', Math.max(0,document.documentElement.clientHeight-box.bottom-14)+'px');
 }
 details.addEventListener('toggle',()=>{
   if(details.open){fitMenu();grid.scrollTop=0;input.focus({preventScroll:true});}
 });
 new ResizeObserver(fitMenu).observe(details);
 window.addEventListener('resize',fitMenu);

 search.querySelector('input').oninput=e=>{
   const query=e.target.value.trim().toLocaleLowerCase();
   for(const b of buttons)b.hidden=!(`${b.textContent} ${b.title}`).toLocaleLowerCase().includes(query);
   for(const s of grid.children)s.hidden=![...s.querySelectorAll('button')].some(b=>!b.hidden);
   empty.hidden=buttons.some(b=>!b.hidden);
   grid.scrollTop=0;
 };
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){e.preventDefault();menu.closest('details').open=true;search.querySelector('input').focus();}});
}

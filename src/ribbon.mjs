import {icon} from './icons.mjs';
import {getLanguage,onLanguageChange} from './i18n.mjs';
export function installRibbon(){
  const header=document.querySelector('.appbar'),home=header.querySelector('.toolbar'),more=home.querySelector('.more-tools'),actions=header.querySelector('.app-actions'),ai=header.querySelector('.folio-ai-open');
  if(header.dataset.ribbon)return;header.dataset.ribbon='true';
  if(ai){actions.prepend(ai);ai.classList.add('ai-primary');ai.title='AI 助手 · Chatbox';}
  for(const group of home.querySelectorAll('.toolgroup'))if(!group.children.length)group.remove();
  const row=document.createElement('div');row.className='ribbon-tab-row';
  const tabs=document.createElement('nav');tabs.className='ribbon-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','功能区');
  const panel=document.createElement('nav');panel.className='ribbon-context toolbar';panel.hidden=true;panel.id='ribbon-context';panel.setAttribute('role','tabpanel');
  const collapse=document.createElement('button');collapse.className='ribbon-collapse';collapse.innerHTML=icon('collapse');collapse.title='收起功能区 Ctrl+F1';collapse.setAttribute('aria-label',collapse.title);
  row.append(tabs,more,collapse);header.append(row,panel);home.classList.add('ribbon-home');home.id='ribbon-home';home.setAttribute('role','tabpanel');
  const definitions=[
    ['home','常用','Home',[]],
    ['read','阅读','Read',[]],
    ['edit','编辑','Edit',['flow-edit','edit-content','table-structure','font-tools','undo','redo']],
    ['photo','图像','Image',['photo-studio','edit-image','graphics-editor']],
    ['vector','矢量','Vector',['vector-studio','graphics-editor','edit-content']],
    ['bookmarks','书签','Bookmarks',['smart-toc','generate','calibrate','calibrate-pages','whitespace','batch','exchange']],
    ['organize','组织','Organize',['page-organizer','document-assembly','pages']],
    ['export','导出','Export',['export-word','export-excel','save-as','save-project','exchange','office-import','document-utilities']]
  ];
  let current='home';const selection=document.querySelector('.selection-toolbar');const originalParent=selection.parentNode;
  const originals=new Map([...document.querySelectorAll('button')].map(b=>[b.id||b.dataset.action,b]).filter(([id])=>id));
  function proxy(original){const b=document.createElement('button');b.className='ribbon-command';b.innerHTML=original.innerHTML;b.title=original.title||original.textContent;b.dataset.ribbonCommand=original.id||original.dataset.action;if(original.hasAttribute('data-doc'))b.dataset.doc='';const sync=()=>{b.disabled=original.disabled;b.setAttribute('aria-pressed',original.getAttribute('aria-pressed')||'false');};sync();const watch=new MutationObserver(sync);watch.observe(original,{attributes:true,attributeFilter:['disabled','aria-pressed']});observers.push(watch);b.onclick=()=>original.click();return b;}
  const observers=[];
  function choose(id,focus=false){
    current=id;for(const o of observers)o.disconnect();observers.length=0;
    if(selection.parentNode===panel){originalParent.prepend(selection);selection.hidden=true;}
    panel.replaceChildren();home.hidden=id!=='home';panel.hidden=id==='home';
    for(const tab of tabs.children){const active=tab.dataset.category===id;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;if(active&&focus)tab.focus();}
    if(id==='read'){selection.hidden=false;panel.append(selection);}else for(const key of definitions.find(d=>d[0]===id)[3]){const original=originals.get(key);if(original)panel.append(proxy(original));}
    panel.setAttribute('aria-labelledby','ribbon-tab-'+id);
  }
  const labels=()=>{for(let i=0;i<definitions.length;i++){const d=definitions[i],b=tabs.children[i];b.textContent=getLanguage()==='en'?d[2]:d[1];}};
  for(const [id] of definitions){const b=document.createElement('button');b.id='ribbon-tab-'+id;b.dataset.category=id;b.setAttribute('role','tab');b.setAttribute('aria-controls',id==='home'?'ribbon-home':'ribbon-context');b.onclick=()=>{header.classList.remove('ribbon-collapsed');choose(id);};tabs.append(b);}
  tabs.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();let i=definitions.findIndex(d=>d[0]===current);i=e.key==='Home'?0:e.key==='End'?definitions.length-1:(i+(e.key==='ArrowRight'?1:-1)+definitions.length)%definitions.length;choose(definitions[i][0],true);};
  const toggle=()=>{const off=header.classList.toggle('ribbon-collapsed');collapse.setAttribute('aria-expanded',String(!off));localStorage.setItem('folio-ribbon-collapsed',String(off));};collapse.onclick=toggle;
  document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='F1'){e.preventDefault();toggle();}});
  if(localStorage.getItem('folio-ribbon-collapsed')==='true')header.classList.add('ribbon-collapsed');
  selection.hidden=true;labels();onLanguageChange(labels);choose('home');
}

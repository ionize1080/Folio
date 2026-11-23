import {icon} from './icons.mjs';
import {t,onLanguageChange} from './i18n.mjs';
export async function installWindowChrome(){
  const bottom=document.querySelector('.statusbar'),reading=document.querySelector('.viewer-toolbar');
  if(bottom&&reading){bottom.classList.add('reading-statusbar');bottom.append(reading);reading.setAttribute('aria-label','阅读控制');const details=reading.querySelector('.view-options>div');for(const id of ['page-label','render-info']){const item=document.getElementById(id);item.classList.add('reading-detail');details.append(item);}document.querySelector('.viewer-bottom').hidden=true;}
  const api=window.desktop;if(!api?.windowState)return;
  const state=await api.windowState();if(!state.custom)return;
  const header=document.querySelector('.appbar');header.classList.add('custom-titlebar');
  const quick=document.createElement('nav');quick.className='titlebar-quick';quick.setAttribute('aria-label','常用文档操作');
  const quickSyncs=[];
  for(const [action,label,key] of [['save','保存','Ctrl+S'],['undo','撤销','Ctrl+Z'],['redo','重做','Ctrl+Y']]){
    const original=document.querySelector(`.ribbon-home [data-action=${action}]`),button=document.createElement('button');button.dataset.quickAction=action;button.innerHTML=icon(action);quick.append(button);
    const studioButton=()=>action==='save'?null:document.querySelector(`.studio-history [data-history="edit.${action}"]`);
    const studioAction=()=>document.body.classList.contains('studio-active')&&action!=='save'?studioButton():original;
    button.onclick=()=>studioAction()?.click();
    let studioObserver=null,observedStudio=null,lastLabel='';
    const sync=(forceLabel=false)=>{
      const inStudio=document.body.classList.contains('studio-active');
      const target=studioAction();
      if(inStudio&&action!=='save'&&target&&target!==observedStudio){
        studioObserver?.disconnect();
        observedStudio=target;
        studioObserver=new MutationObserver(()=>sync(false));
        studioObserver.observe(target,{attributes:true,attributeFilter:['disabled']});
      }else if(!inStudio&&studioObserver){
        studioObserver.disconnect();studioObserver=null;observedStudio=null;
      }
      const nextDisabled=!!target?.disabled;
      if(button.disabled!==nextDisabled)button.disabled=nextDisabled;
      if(forceLabel||!lastLabel){
        const text=t(label);
        if(text!==lastLabel){lastLabel=text;button.title=text+' · '+key;button.setAttribute('aria-label',text);}
      }
    };
    new MutationObserver(()=>sync(false)).observe(original,{attributes:true,attributeFilter:['disabled']});
    quickSyncs.push(sync);
    onLanguageChange(()=>sync(true));sync(true);
  }
  let wasStudio=document.body.classList.contains('studio-active');
  new MutationObserver(()=>{
    const nowStudio=document.body.classList.contains('studio-active');
    if(nowStudio===wasStudio)return;
    wasStudio=nowStudio;
    for(const fn of quickSyncs)fn(false);
  }).observe(document.body,{attributes:true,attributeFilter:['class']});
  const controls=document.createElement('nav');controls.className='window-controls';controls.setAttribute('aria-label','窗口控制');
  for(const [action,shape] of [['minimize','<path d="M4 10h12"/>'],['maximize','<rect x="5" y="5" width="10" height="10" rx="1"/>'],['close','<path d="m5 5 10 10M15 5 5 15"/>']]){
    const b=document.createElement('button');b.dataset.window=action;b.innerHTML=`<svg viewBox="0 0 20 20" aria-hidden="true">${shape}</svg>`;b.onclick=()=>api.windowCommand(action).catch(console.error);controls.append(b);
  }
  function update(s=state){state.maximized=s.maximized;state.fullscreen=s.fullscreen;controls.querySelector('[data-window=minimize]').setAttribute('aria-label',t('最小化'));controls.querySelector('[data-window=close]').setAttribute('aria-label',t('关闭'));const max=controls.querySelector('[data-window=maximize]');max.setAttribute('aria-label',t(s.maximized?'还原窗口':'最大化'));max.innerHTML=s.maximized?'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 6V4h9v9h-2"/><rect x="4" y="7" width="9" height="9" rx="1"/></svg>':'<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1"/></svg>';}
  header.querySelector('.brand').after(quick);header.append(controls);api.onWindowState(update);onLanguageChange(()=>update(state));update();
}

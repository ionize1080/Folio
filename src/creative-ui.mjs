import {icon} from './icons.mjs';
import {installCreativeMenus} from './creative-menus.mjs';
export function installCreativeUI({S,run,rev,studio}){
  const embedded=studio.embedded,root=document.createElement('section');root.className='studio-workspace';root.setAttribute('aria-label','创作工作区');
  root.innerHTML=`<div class="studio-toolbar" role="toolbar" aria-label="作品编辑"><div class="studio-history"><button data-history="edit.undo" title="撤销 Ctrl+Z" aria-label="撤销">${icon('undo')}</button><button data-history="edit.redo" title="重做 Ctrl+Shift+Z" aria-label="重做">${icon('redo')}</button></div><nav class="studio-menus" aria-label="作品工具分类"></nav><button data-all-tools title="搜索全部编辑工具" aria-expanded="false">${icon('search')}<span>全部工具</span></button><div class="studio-spacer"></div><div class="studio-view-control"><button data-zoom-toggle aria-label="缩放与视图" aria-expanded="false"><span data-zoom-label>100%</span>${icon('chevron')}</button><div class="studio-view-popover" popover="auto"><h3>画布视图</h3><div class="studio-scale-row"><button data-zoom-out title="缩小" aria-label="缩小">${icon('minus')}</button><label class="studio-percent"><input data-percent type="number" step="any" min="0.01" value="100" aria-label="缩放百分比"><span>%</span></label><button data-zoom-in title="放大" aria-label="放大">${icon('plus')}</button></div><select data-view aria-label="画布视图"><option value="fit">适合窗口</option><option value="width">适合宽度</option><option value="height">适合高度</option><option value="fill">填满视区</option><option value="selection">聚焦选中对象</option><option value="actual">实际大小</option><option value="center">居中</option><option value="center-x">水平居中</option><option value="center-y">垂直居中</option><option value="custom">自定义比例</option></select><p>滚轮缩放 · 空格拖动画布</p></div></div><details class="studio-placement"><summary title="在 PDF 中的位置与尺寸" aria-label="放置设置">${icon('sliders')}</summary><div><p>PDF 中的尺寸与位置</p><div class="form-grid"><label>左边距 pt<input data-x type="number"></label><label>底边距 pt<input data-y type="number"></label><label>宽度 pt<input data-width type="number" min=".01"></label><label>高度 pt<input data-height type="number" min=".01"></label><label>旋转 °<input data-angle type="number" value="0"></label></div></div></details><button data-export title="独立导出作品">${icon('export')}<span>导出</span></button><button data-apply class="primary" title="将最终作品应用到 PDF；保存 .folio 工程可保留图层">应用到 PDF</button></div><p class="studio-status" role="status" hidden></p>`;
  const stage=document.createElement('div');stage.className='studio-stage';const aiDock=document.createElement('aside');aiDock.className='studio-ai-dock';aiDock.setAttribute('aria-label','AI 助手');stage.append(embedded.mount,aiDock);root.insertBefore(stage,root.lastElementChild);document.body.append(root);
  const identity=document.createElement('div');identity.className='studio-identity';identity.innerHTML=`<button data-return title="返回 PDF，保留编辑画布" aria-label="返回 PDF">${icon('back')}</button><span class="studio-document-kind"></span><select data-sessions aria-label="当前编辑作品"></select><span class="studio-document-meta"></span>`;document.querySelector('.appbar').append(identity);
  const q=s=>root.querySelector(s)||identity.querySelector(s);
  const background=document.createElement('section');background.className='studio-background';background.setAttribute('aria-label','画布背景');
  background.innerHTML=`<h4>画布背景</h4><label>显示<select data-background-mode><option value="checker">透明网格</option><option value="solid">纯色</option><option value="pdf">PDF 页面</option></select></label><label data-background-color-label>底色<input type="color" data-background-color value="#eef0f3" aria-label="画布底色"></label><label data-background-strength-label>叠加强度<span><input type="range" data-background-strength min="0" max="100" value="60" aria-label="PDF 背景叠加强度"><output>60%</output></span></label><button data-background-refresh>更新 PDF 背景</button><p>背景随作品同步缩放，仅用于编辑参考。</p>`;
  q('.studio-view-popover').append(background);
  q('[data-view] option[value=fit]').textContent='适合作品';q('[data-view]').add(new Option('适合 PDF 页面','page'),1);
  let current=null,busy=false,resizeTimer,statusTimer,backgroundWork=null,nextBackground=null;const placementFields=new Set();
  const geometry=()=>Object.fromEntries([...placementFields].map(k=>[k==='angle'?'rotation':k,Number(q(`[data-${k}]`).value)]));
  const updateBackground=()=>{
    const b=current&&embedded.get(current).background||{mode:'checker',color:'#eef0f3',opacity:.6};
    q('[data-background-mode]').value=b.mode;q('[data-background-color]').value=b.color;q('[data-background-strength]').value=b.opacity*100;background.querySelector('output').value=Math.round(b.opacity*100)+'%';
    q('[data-background-color-label]').hidden=b.mode==='checker';q('[data-background-strength-label]').hidden=b.mode!=='pdf';q('[data-background-refresh]').hidden=b.mode!=='pdf';q('[data-background-mode] option[value=pdf]').disabled=!S.pdf;
  };
  const status=message=>{const p=q('.studio-status');p.textContent=message;p.hidden=!message;clearTimeout(statusTimer);if(message)statusTimer=setTimeout(()=>p.hidden=true,7000);};
  const perform=fn=>async()=>{if(busy)return;busy=true;root.classList.add('studio-busy');try{await fn();}catch(e){status(e.message);}finally{busy=false;root.classList.remove('studio-busy');q('[data-apply]').disabled=!S.pdf;}};
  const updateSessions=()=>{const select=q('[data-sessions]');select.replaceChildren();for(const s of embedded.sessions.values())select.add(new Option(s.title|| (s.kind==='photo'?'未命名图像':'未命名矢量图'),s.id));if(current)select.value=current;};
  const park=()=>{document.body.classList.remove('studio-active');root.setAttribute('aria-hidden','true');q('.studio-view-popover').hidePopover();q('.studio-placement').open=false;for(const s of embedded.sessions.values())s.frame.classList.add('studio-parked');window.dispatchEvent(new Event('folio-studio-visibility'));};
  const openMenu=installCreativeMenus({root,session:id=>embedded.get(id),request:run,onError:status});
  const menuDefinitions={photo:[['调整',['Image','Adjustments']],['图层',['Layer']],['选择',['Select']],['滤镜',['Filter']],['文字',['Type']]],vector:[['对象',['Object']],['路径',['Object','Path']],['选择',['Select']],['效果',['Effect']],['文字',['Type']]]};
  async function adaptLayout(id){
    const s=embedded.get(id),compact=embedded.mount.clientWidth<700;
    if(s.compactLayout===compact)return;
    const ui=await run({action:'request',sessionId:id,method:'ui.inspect'});
    const collapsed=s.kind==='photo'?!ui.panels.dock:ui.ui.dock_collapsed;
    if(compact)s.restoreInspector=!collapsed;
    if((compact&&!collapsed)||(!compact&&s.restoreInspector&&collapsed)){
      await run(s.kind==='photo'?{action:'request',sessionId:id,method:'ui.set',params:{panels:{dock:!compact}}}:{action:'execute',sessionId:id,command:'window.collapseDock',params:{collapsed:compact}});
    }
    s.compactLayout=compact;
  }
  async function show(id){
    const s=embedded.get(id),info=studio.sessions.get(id);if(!info)return;
    current=id;embedded.activeId=id;updateSessions();document.body.classList.add('studio-active');root.removeAttribute('aria-hidden');
    window.dispatchEvent(new Event('folio-studio-visibility'));
    for(const item of embedded.sessions.values())item.frame.classList.toggle('studio-parked',item.id!==id);
    placementFields.clear();const [x,y,w,h]=info.box,angle=info.target?.matrix?Math.atan2(info.target.matrix[1],info.target.matrix[0])*180/Math.PI:0;
    for(const [k,v] of Object.entries({x,y,width:w,height:h,angle}))q(`[data-${k}]`).value=Number(v.toFixed(4));
    updateBackground();
    q('[data-percent]').max=s.kind==='photo'?12800:64000;q('[data-apply]').disabled=!S.pdf;q('.studio-placement').hidden=!S.pdf;
    q('.studio-document-kind').innerHTML=icon(s.kind==='photo'?'brush':'nodes');
    q('.studio-document-meta').textContent=s.dimensions?`${s.dimensions[0]} × ${s.dimensions[1]}`:'';
    const menus=q('.studio-menus');menus.replaceChildren();for(const [label,path] of menuDefinitions[s.kind]){const b=document.createElement('button');b.textContent=label;b.setAttribute('aria-expanded','false');b.onclick=()=>openMenu(b,current,path);menus.append(b);}
    status('');
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    await adaptLayout(id);
    await run({action:'view',sessionId:id,options:s.viewMode|| (s.shown?{}:{mode:'fit'})});s.shown=true;s.frame.contentWindow.focus();
  }
  q('[data-return]').onclick=park;q('[data-sessions]').onchange=perform(()=>show(q('[data-sessions]').value));
  document.addEventListener('click',e=>{const tab=e.target.closest('.ribbon-tabs button');if(tab&&!['photo','vector'].includes(tab.dataset.category))park();});
  embedded.addEventListener('show',e=>perform(()=>show(e.detail.sessionId))());
  embedded.addEventListener('closed',e=>{if(current===e.detail.sessionId){current=null;park();}updateSessions();});
  embedded.addEventListener('view',e=>{if(e.detail.sessionId===current){if(document.activeElement!==q('[data-percent]'))q('[data-percent]').value=Number(e.detail.percent.toFixed(2));q('[data-view]').value=e.detail.mode==='custom'?'custom':e.detail.mode;}});
  embedded.addEventListener('view',e=>{if(e.detail.sessionId===current)q('[data-zoom-label]').textContent=Number(e.detail.percent.toFixed(1))+'%';});
  embedded.addEventListener('error',e=>status(e.detail.message));
  embedded.addEventListener('background',e=>{if(e.detail.sessionId===current&&!backgroundWork)updateBackground();});
  for(const b of root.querySelectorAll('[data-history]'))b.onclick=perform(()=>run({action:'execute',sessionId:current,command:b.dataset.history}));
  q('[data-all-tools]').onclick=e=>openMenu(e.currentTarget,current);
  const viewPopover=q('.studio-view-popover'),zoomToggle=q('[data-zoom-toggle]');
  zoomToggle.onclick=()=>{const b=zoomToggle.getBoundingClientRect();viewPopover.style.left=Math.min(b.left,innerWidth-260)+'px';viewPopover.style.top=(b.bottom+6)+'px';viewPopover.togglePopover();};
  viewPopover.addEventListener('toggle',()=>zoomToggle.setAttribute('aria-expanded',String(viewPopover.matches(':popover-open'))));
  q('[data-view]').onchange=perform(async()=>{const mode=q('[data-view]').value;if(mode==='custom'){q('[data-percent]').focus();q('[data-percent]').select();return;}if(mode==='page')await run({action:'background',sessionId:current,options:{mode:'pdf',geometry:geometry()}});await run({action:'view',sessionId:current,options:{mode}});});
  q('[data-percent]').onchange=perform(()=>run({action:'view',sessionId:current,options:{mode:'zoom',percent:Number(q('[data-percent]').value)}}));
  for(const mode of ['in','out'])q(`[data-zoom-${mode}]`).onclick=perform(()=>run({action:'view',sessionId:current,options:{mode}}));
  const setBackground=refresh=>{
    nextBackground={action:'background',sessionId:current,options:{mode:q('[data-background-mode]').value,color:q('[data-background-color]').value,opacity:Number(q('[data-background-strength]').value)/100,geometry:geometry(),refresh}};
    if(backgroundWork)return backgroundWork;
    background.setAttribute('aria-busy','true');
    // Coalesce slider gestures while a PDF snapshot loads; retain the last value.
    backgroundWork=(async()=>{
      await new Promise(r=>requestAnimationFrame(r));
      while(nextBackground){const request=nextBackground;nextBackground=null;try{await run(request);}catch(e){status(e.message);}}
    })().finally(()=>{backgroundWork=null;background.setAttribute('aria-busy','false');updateBackground();});return backgroundWork;
  };
  q('[data-background-mode]').onchange=()=>setBackground(false);
  q('[data-background-color]').onchange=()=>setBackground(false);
  q('[data-background-strength]').oninput=()=>{background.querySelector('output').value=q('[data-background-strength]').value+'%';setBackground(false);};
  q('[data-background-refresh]').onclick=()=>setBackground(true);
  q('.studio-placement').oninput=e=>{for(const k of ['x','y','width','height','angle'])if(e.target.hasAttribute('data-'+k))placementFields.add(k);};
  q('.studio-placement').onchange=()=>{if(embedded.get(current).background?.mode==='pdf')setBackground(false);};
  q('[data-apply]').onclick=perform(async()=>{
    await run({action:'apply',sessionId:current,revision:rev(),geometry:geometry()});placementFields.clear();status('已应用到 PDF，可撤销。保存 .folio 可继续编辑图层。');
  });
  q('[data-export]').onclick=()=>{
    if(!current||busy)return;const kind=embedded.get(current).kind,d=document.createElement('dialog');d.className='studio-export';d.setAttribute('aria-label','导出作品');
    d.innerHTML=`<form method="dialog"><h2>导出作品</h2><label>文件格式<select>${(kind==='photo'?['png','jpg','webp','tif','psd','exr','pcraft']:['svg','pdf','png','jpg','eps','ai','vectorcraft']).map(f=>`<option>${f}</option>`).join('')}</select></label><label data-quality>质量<input type="range" min="1" max="100" value="90"><output>90</output></label><footer><button value="cancel">取消</button><button value="export" class="primary">导出…</button></footer></form>`;
    const format=d.querySelector('select');format.onchange=()=>d.querySelector('[data-quality]').hidden=!['jpg','webp'].includes(format.value);format.onchange();d.querySelector('input').oninput=e=>d.querySelector('output').value=e.target.value;
    d.onclose=()=>{if(d.returnValue==='export')perform(async()=>{const r=await run({action:'export',sessionId:current,format:format.value,options:['jpg','webp'].includes(format.value)?{quality:Number(d.querySelector('input').value)}:{}});status(r.saved?'作品已导出':'已取消导出');})();d.remove();};document.body.append(d);d.showModal();
  };
  new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(current&&!busy&&document.body.classList.contains('studio-active')){const id=current,s=embedded.sessions.get(id);if(s)perform(async()=>{await adaptLayout(id);if(s.viewMode)await run({action:'view',sessionId:id,options:s.viewMode});})();}},180);}).observe(embedded.mount);
  // A read-only refresh must never swallow a click on a view control.
  let polling=false;
  setInterval(async()=>{if(!current||busy||polling||!document.body.classList.contains('studio-active'))return;polling=true;try{await run({action:'view',sessionId:current});}catch{}finally{polling=false;}},2000);
  park();

  for(const [kind,label,symbol] of [['photo','图像工作室','brush'],['vector','矢量工作室','nodes']]){
    const b=document.createElement('button');b.id=kind+'-studio';b.innerHTML=icon(symbol)+label;b.title=kind==='photo'?'新建、插入或编辑图像与图层':'新建、插入或编辑矢量图';document.querySelector('.more-tools-menu').append(b);
    b.onclick=async()=>{
      b.closest('details')?.removeAttribute('open');
      const d=document.createElement('dialog');d.className='creative-dialog';d.setAttribute('aria-label',label);
      d.innerHTML=`<header><div>${icon(symbol)}<h2>${label}</h2></div><button data-close aria-label="关闭">${icon('close')}</button></header><div class="creative-start"><label>编辑对象<select data-object><option value="">新建作品</option></select></label><div data-new class="form-grid"><label>宽度<input data-width type="number" min="1" value="1200"></label><label>高度<input data-height type="number" min="1" value="800"></label>${kind==='photo'?'<label>位深<select data-depth><option>8</option><option>16</option><option>32</option></select></label><label>色彩<select data-mode><option value="rgb">RGB</option><option value="cmyk">CMYK</option><option value="lab">Lab</option><option value="gray">灰度</option></select></label>':''}</div><div class="creative-actions"><button data-open class="primary">开始编辑</button><button data-import>${icon('folder')}插入文件…</button><button data-resume>继续编辑</button></div><div data-object-actions class="creative-actions" hidden><button data-duplicate>${icon('copy')}复制</button><button data-delete>${icon('trash')}删除</button></div></div><footer><p data-status role="status">直接在 Folio 内编辑；人工与 AI 使用同一画布。</p></footer>`;
      document.body.append(d);d.showModal();const local=s=>d.querySelector(s);let items=[],working=false;
      const task=fn=>async()=>{if(working)return;working=true;d.querySelectorAll('button').forEach(x=>x.disabled=true);try{await fn();}catch(e){local('[data-status]').textContent=e.message;}finally{working=false;d.querySelectorAll('button').forEach(x=>x.disabled=false);local('[data-resume]').disabled=![...embedded.sessions.values()].some(s=>s.kind===kind);}};
      local('[data-close]').onclick=()=>d.close();d.onclose=()=>d.remove();d.oncancel=e=>{if(working)e.preventDefault();};
      const refresh=async()=>{if(S.pdf)items=(await run({action:'objects',page:S.page})).objects.filter(o=>kind==='photo'?['image','photo'].includes(o.kind):['path','vector'].includes(o.kind));local('[data-object]').replaceChildren(new Option('新建作品',''));for(const o of items)local('[data-object]').add(new Option((o.kind==='path'?'原有路径':o.kind==='vector'?'矢量图':'图片')+' · '+(o.index??o.id.slice(0,8)),o.key));};
      local('[data-object]').onchange=()=>{const selected=!!local('[data-object]').value;local('[data-new]').hidden=selected;local('[data-object-actions]').hidden=!selected;};
      async function open(pick=false){const o=items.find(o=>o.key===local('[data-object]').value);local('[data-status]').textContent='正在准备编辑画布…';const r=await run({action:'open',kind,pick,page:S.page,...(!pick?{id:o?.id,index:o?.index,settings:{width:Number(local('[data-width]').value),height:Number(local('[data-height]').value),...(kind==='photo'?{depth:Number(local('[data-depth]').value),mode:local('[data-mode]').value}:{})}}:{})});if(!r.cancelled){d.close();await show(r.sessionId);}}
      local('[data-open]').onclick=task(()=>open());local('[data-import]').onclick=task(()=>open(true));local('[data-resume]').onclick=task(async()=>{const s=[...embedded.sessions.values()].filter(s=>s.kind===kind).at(-1);if(s){d.close();await show(s.id);}});
      for(const action of ['duplicate','delete'])local(`[data-${action}]`).onclick=task(async()=>{const o=items.find(o=>o.key===local('[data-object]').value);if(o){await run({action,page:S.page,id:o.id,index:o.index,revision:rev()});await refresh();local('[data-object]').onchange();local('[data-status]').textContent='已完成，可撤销。';}});
      await task(refresh)();
    };
  }
}

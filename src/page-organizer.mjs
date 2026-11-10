import * as pdfjs from './vendor/pdf.mjs';
import { pdfLoadingOptions } from './pdf-loading.mjs';
import {icon} from './icons.mjs';
import {chooseBlankPages} from './blank-pages-ui.mjs';
import {readPageBoxes,organizerGeometry} from './page-organization-geometry.mjs';
import {nativeRequest,releaseSource} from './native-source.mjs';
import {toBase64,fromBase64} from './portable-state.mjs';
export function installPageOrganizer({S,session,run,exportPDF}){
  const button=document.createElement('button');button.id='page-organizer';button.dataset.doc='';button.innerHTML=icon('page-grid')+'组织页面';button.title='缩略图多选、拖动排序、插入、删除、提取与替换';document.querySelector('.more-tools-menu').append(button);
  const blankButton=document.createElement('button');blankButton.id='insert-blank-page';blankButton.dataset.doc='';blankButton.innerHTML=icon('new-page')+'插入空白页…';blankButton.title='选择空白页尺寸、方向、数量和插入位置';document.querySelector('.more-tools-menu').append(blankButton);
  button.onclick=()=>open();blankButton.onclick=()=>open('blank');
  async function open(initialAction=''){
    button.closest('details')?.removeAttribute('open');if(!S.pdf||S.busy)return;
    const capture=session.capture(),d=document.createElement('dialog');d.className='organizer-dialog';d.setAttribute('aria-label','组织页面');
    const commands=[['insert','insert-page','插入'],['blank','new-page','空白页'],['delete','trash','删除'],['extract','extract-page','提取'],['replace','replace-page','替换'],['copy','copy','复制'],['rotate','rotate','旋转'],['reverse','reverse','逆序'],['undo','undo','撤销'],['redo','redo','重做']];
    d.innerHTML=`<header><h2>组织页面</h2><div class="organizer-actions" role="toolbar" aria-label="页面组织">${commands.map(([id,i,label])=>`<button data-org="${id}" title="${label}">${icon(i)}<span>${label}</span></button>`).join('')}</div><button data-close aria-label="关闭">${icon('close')}</button></header><div class="organizer-controls"><label><select data-select aria-label="选择页面"><option value="current">当前页</option><option value="all">全部页</option><option value="odd">奇数页</option><option value="even">偶数页</option><option value="none">清除选择</option></select></label><label><select data-insert-position aria-label="插入位置"><option value="after">在选中页之后插入</option><option value="before">在选中页之前插入</option></select></label><details class="organizer-options"><summary>页面设置</summary><div><p>应用到选中页面</p><div class="form-grid"><label>宽度 pt<input data-width type="number" value="595.28" min="1"></label><label>高度 pt<input data-height type="number" value="841.89" min="1"></label></div><button data-resize>缩放到此尺寸</button><label>裁剪边距 pt（左、上、右、下）<input data-crop value="0,0,0,0"></label><button data-crop-apply>应用裁剪</button></div></details><details class="organizer-options"><summary>页面标记</summary><div><label>类型<select data-mark-kind><option value="footer">页脚 / 页码</option><option value="header">页眉</option><option value="watermark">水印</option><option value="background">背景色</option></select></label><label>文字（{page} / {pages}）<input data-mark-text value="{page} / {pages}"></label><div class="form-grid"><label>字号<input data-mark-size type="number" value="12" min="1"></label><label>颜色<input data-mark-color type="color" value="#667085"></label></div><label><input data-marks type="checkbox">输出时应用到选中页面</label></div></details><details class="organizer-options"><summary>拆分</summary><div><label>每份页数<input data-split-size type="number" min="1" value="1"></label><button data-split>按当前顺序拆分保存…</button></div></details><label class="organizer-zoom">缩略图<input data-zoom aria-label="缩略图大小" type="range" min="120" max="240" value="160"></label></div><div class="organizer-grid" role="listbox" aria-label="页面缩略图" aria-multiselectable="true"></div><footer><p data-status role="status">单击选择 · Ctrl 加选 · Shift 连选 · 拖动排序</p><button class="primary" data-save>另存整理后的 PDF…</button></footer>`;
    document.body.append(d);d.showModal();const q=s=>d.querySelector(s),grid=q('.organizer-grid');
    let order=Array.from({length:S.info.pageCount},(_,i)=>({key:crypto.randomUUID(),source:'current',page:i+1,rotation:0})),selected=new Set([order[S.page-1]?.key]),anchor=S.page-1,busy=false,closed=false,epoch=0;
    const sources=[],docs=new Map(),boxes=new Map(),history=[],future=[],tasks=new Set();let jobs=[],running=0;
    async function loadDocument(id,data){const loading=pdfjs.getDocument({...pdfLoadingOptions,data:data.slice()});try{const [pdf,info]=await Promise.all([loading.promise,readPageBoxes(data)]);docs.set(id,pdf);boxes.set(id,info);}catch(e){await loading.destroy();throw e;}}
    const geometry=item=>organizerGeometry(item,item.blank?null:boxes.get(item.source)?.[item.page-1]);
    const status=()=>{q('[data-status]').textContent=`已选 ${selected.size} / ${order.length} 页 · Ctrl 加选 · Shift 连选 · 拖动排序`;q('[data-org=undo]').disabled=!history.length;q('[data-org=redo]').disabled=!future.length;};
    const snapshot=()=>({order:structuredClone(order),selected:[...selected]});
    const change=fn=>{if(busy)return;history.push(snapshot());if(history.length>80)history.shift();future.length=0;fn();paint();};
    function restore(value){order=value.order;selected=new Set(value.selected);paint();}
    async function renderTile(tile,item,token){
      const page=item.blank?null:await docs.get(item.source).getPage(item.page);
      if(closed||token!==epoch||!tile.dataset.visible)return;
      const original=page?page.getViewport({scale:1,rotation:0}):{width:item.width,height:item.height};
      const {width:w,height:h,rotation,sourceRect}=geometry(item),turned=rotation%180!==0;
      const scale=240/Math.max(w,h),canvas=tile.querySelector('canvas');canvas.width=Math.ceil((turned?h:w)*scale);canvas.height=Math.ceil((turned?w:h)*scale);
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rotation*Math.PI/180);ctx.scale(scale,scale);ctx.translate(-w/2,-h/2);
      const mark=marks(),marked=mark?.pages.includes(Number(tile.dataset.position));
      if(marked&&mark.kind==='background'){ctx.fillStyle=mark.color;ctx.fillRect(0,0,w,h);}
      if(page){
        const viewport=page.getViewport({scale:240/Math.max(original.width,original.height),rotation:0}),source=document.createElement('canvas');source.width=Math.ceil(viewport.width);source.height=Math.ceil(viewport.height);
        const task=page.render({canvasContext:source.getContext('2d'),viewport,background:'rgba(0,0,0,0)'});tasks.add(task);try{await task.promise;}finally{tasks.delete(task);}
        if(closed||token!==epoch)return;
        ctx.drawImage(source,sourceRect[0]*source.width,sourceRect[1]*source.height,sourceRect[2]*source.width,sourceRect[3]*source.height,0,0,w,h);
      }
      if(marked&&mark.kind!=='background'){
        ctx.fillStyle=mark.color;ctx.globalAlpha=mark.kind==='watermark'?.2:1;ctx.font=mark.size+'px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';
        const y=mark.kind==='header'?24:mark.kind==='watermark'?h/2-mark.size:h-24-mark.size*1.5;
        ctx.fillText(mark.text.replaceAll('{page}',tile.dataset.position).replaceAll('{pages}',String(order.length)),w/2,y,Math.max(1,w-48));
      }
      tile.dataset.rendered='true';
      const cached=[...grid.querySelectorAll('[data-rendered]')].filter(x=>!x.dataset.visible);
      while(grid.querySelectorAll('[data-rendered]').length>64&&cached.length){const old=cached.shift();old.querySelector('canvas').width=1;delete old.dataset.rendered;}
    }
    function pump(){while(running<2&&jobs.length){const {tile,item,token}=jobs.shift();if(closed||token!==epoch||!tile.isConnected||!tile.dataset.visible)continue;running++;renderTile(tile,item,token).catch(e=>{if(!closed&&e.name!=='RenderingCancelledException')q('[data-status]').textContent=e.message;}).finally(()=>{running--;pump();});}}
    const observer=new IntersectionObserver(entries=>{for(const {target,isIntersecting} of entries){if(isIntersecting){target.dataset.visible='true';if(!target.dataset.rendered){jobs.push({tile:target,item:order.find(o=>o.key===target.dataset.key),token:epoch});}}else delete target.dataset.visible;}pump();},{root:grid,rootMargin:'150px'});
    function refreshSelection(){
      const rerender=q('[data-marks]').checked;
      if(rerender){epoch++;jobs=[];for(const t of tasks)t.cancel();}
      for(const tile of grid.children){
        tile.setAttribute('aria-selected',String(selected.has(tile.dataset.key)));
        if(rerender){delete tile.dataset.rendered;if(tile.dataset.visible)jobs.push({tile,item:order.find(o=>o.key===tile.dataset.key),token:epoch});}
      }
      if(rerender)pump();status();
    }
    function choose(index,e){if(busy)return;const key=order[index].key;if(e.shiftKey){if(!e.ctrlKey)selected.clear();for(let i=Math.min(anchor,index);i<=Math.max(anchor,index);i++)if(order[i])selected.add(order[i].key);}else if(e.ctrlKey||e.metaKey){selected.has(key)?selected.delete(key):selected.add(key);anchor=index;}else {selected=new Set([key]);anchor=index;}refreshSelection();}
    function paint(){epoch++;jobs=[];observer.disconnect();for(const t of tasks)t.cancel();grid.replaceChildren();const frag=document.createDocumentFragment();order.forEach((item,index)=>{const tile=document.createElement('button');tile.className='organizer-page';tile.dataset.key=item.key;tile.dataset.position=index+1;tile.setAttribute('role','option');tile.setAttribute('aria-selected',String(selected.has(item.key)));tile.setAttribute('aria-label',`第 ${index+1} 页${item.blank?' · 空白页':` · 来源第 ${item.page} 页`}`);tile.draggable=true;tile.innerHTML='<div class="organizer-paper"><canvas></canvas></div><span></span>';tile.querySelector('span').textContent=`${index+1}${item.blank?' · 空白':item.source!=='current'?' · 插入':item.size||item.crop?' · 已调整':''}`;tile.onclick=e=>choose(index,e);tile.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const cols=Math.max(1,Math.floor(grid.clientWidth/(tile.offsetWidth+20))),next=Math.max(0,Math.min(order.length-1,index+({ArrowLeft:-1,ArrowRight:1,ArrowUp:-cols,ArrowDown:cols}[e.key])));choose(next,e);grid.children[next].focus();}};tile.ondragstart=e=>{if(busy){e.preventDefault();return;}if(!selected.has(item.key))choose(index,e);e.dataTransfer.setData('text/plain','folio-pages');e.dataTransfer.effectAllowed='move';};tile.ondragover=e=>{if(!busy){e.preventDefault();tile.dataset.drop=e.clientX<tile.getBoundingClientRect().x+tile.offsetWidth/2?'before':'after';}};tile.ondragleave=()=>delete tile.dataset.drop;tile.ondrop=e=>{e.preventDefault();const side=tile.dataset.drop;delete tile.dataset.drop;if(e.dataTransfer.getData('text/plain')!=='folio-pages'||selected.has(item.key))return;change(()=>{const moving=order.filter(o=>selected.has(o.key));order=order.filter(o=>!selected.has(o.key));const at=order.findIndex(o=>o.key===item.key)+(side==='after'?1:0);order.splice(at,0,...moving);});};frag.append(tile);});grid.append(frag);for(const tile of grid.children)observer.observe(tile);status();}
    const perform=fn=>async()=>{if(busy)return;busy=true;d.querySelectorAll('button,input,select').forEach(b=>b.disabled=true);q('[data-status]').textContent='正在处理…';try{session.assert(capture);await fn();}catch(e){q('[data-status]').textContent=e.message;}finally{busy=false;d.querySelectorAll('button,input,select').forEach(b=>b.disabled=false);q('[data-org=undo]').disabled=!history.length;q('[data-org=redo]').disabled=!future.length;}};
    const clean=entries=>entries.map(({key,...e})=>e),marks=()=>q('[data-marks]').checked?{kind:q('[data-mark-kind]').value,text:q('[data-mark-text]').value,size:Number(q('[data-mark-size]').value),color:q('[data-mark-color]').value,pages:order.flatMap((o,i)=>selected.has(o.key)?[i+1]:[])}:undefined;
    const save=(entries,filename)=>run({action:'organize-pages',filename,options:{order:clean(entries),sources,marks:entries===order?marks():undefined}});
    const selectedOrder=()=>order.filter(o=>selected.has(o.key));
    function atSelection(){const positions=order.flatMap((o,i)=>selected.has(o.key)?[i]:[]);return positions.length?(q('[data-insert-position]').value==='before'?Math.min(...positions):Math.max(...positions)+1):order.length;}
    const insert=replace=>perform(async()=>{const picked=await window.desktop.mergeFiles();if(!picked.length){status();return;}const added=[];for(const file of picked){session.assert(capture);const result=await nativeRequest({command:'document-assemble',bytes:S.bytes,parts:[{name:file.name,data:toBase64(new Uint8Array(file.bytes))}]});session.assert(capture);const data=fromBase64(result.bytes),id=crypto.randomUUID();await loadDocument(id,data);const pdf=docs.get(id);sources.push({id,name:file.name.replace(/\.[^.]+$/,'.pdf'),data:result.bytes});for(let i=1;i<=pdf.numPages;i++)added.push({key:crypto.randomUUID(),source:id,page:i,rotation:0});}history.push(snapshot());future.length=0;let at=replace?order.findIndex(o=>selected.has(o.key)):atSelection();if(at<0)at=order.length;if(replace)order=order.filter(o=>!selected.has(o.key));order.splice(at,0,...added);selected=new Set(added.map(o=>o.key));paint();});
    q('[data-org=insert]').onclick=insert(false);q('[data-org=replace]').onclick=insert(true);
    q('[data-org=blank]').onclick=async()=>{
      if(busy)return;
      try {
      const positions=order.flatMap((o,i)=>selected.has(o.key)?[i]:[]),currentPage=(positions[0]??Math.max(0,Math.min(order.length-1,S.page-1)))+1;
      const plan=await chooseBlankPages({pageCount:order.length,currentPage,position:q('[data-insert-position]').value,getSize:async number=>{
        return geometry(order[number-1]).displayedSize;
      }});
      if(!plan||closed)return;session.assert(capture);
      change(()=>{const added=Array.from({length:plan.count},()=>({key:crypto.randomUUID(),blank:true,width:plan.width,height:plan.height,rotation:0}));order.splice(plan.at,0,...added);selected=new Set(added.map(o=>o.key));anchor=plan.at;});
      grid.children[plan.at]?.scrollIntoView({block:'nearest'});
      } catch(e) {if(!closed)q('[data-status]').textContent=e.message;}
    };
    q('[data-org=delete]').onclick=()=>{if(selected.size>=order.length){q('[data-status]').textContent='请至少保留一页';return;}change(()=>{order=order.filter(o=>!selected.has(o.key));selected.clear();});};
    q('[data-org=copy]').onclick=()=>change(()=>{const added=selectedOrder().map(o=>({...o,key:crypto.randomUUID()}));order.splice(atSelection(),0,...added);selected=new Set(added.map(o=>o.key));});
    q('[data-org=rotate]').onclick=()=>change(()=>{order=order.map(o=>selected.has(o.key)?{...o,rotation:(o.rotation+90)%360}:o);});
    q('[data-org=reverse]').onclick=()=>change(()=>{const reversed=selectedOrder().reverse();order=order.map(o=>selected.has(o.key)?reversed.shift():o);});
    for(const action of ['undo','redo'])q(`[data-org=${action}]`).onclick=()=>{const from=action==='undo'?history:future,to=action==='undo'?future:history;if(!busy&&from.length){to.push(snapshot());restore(from.pop());}};
    q('[data-org=extract]').onclick=perform(async()=>{if(!selected.size)throw Error('请选择要提取的页面');const r=await save(selectedOrder());q('[data-status]').textContent=r.saved?'已提取选中页面，原文档保持不变。':'已取消保存';});
    q('[data-save]').onclick=perform(async()=>{const r=await save(order);q('[data-status]').textContent=r.saved?'整理结果已保存，包含当前 PDF 的全部已应用编辑。':'已取消保存';});
    q('[data-split]').onclick=perform(async()=>{const size=Number(q('[data-split-size]').value);if(!Number.isInteger(size)||size<1||Math.ceil(order.length/size)>100)throw Error('请设置有效份数，每次最多 100 份');let count=0;for(let i=0;i<order.length;i+=size){const r=await save(order.slice(i,i+size),S.name.replace(/\.pdf$/i,'')+'-part-'+String(count+1).padStart(3,'0')+'.pdf');if(!r.saved)break;count++;}q('[data-status]').textContent=`已保存 ${count} 份`;});
    q('[data-resize]').onclick=()=>change(()=>{const size=[Number(q('[data-width]').value),Number(q('[data-height]').value)];if(!size.every(v=>Number.isFinite(v)&&v>0))return;order=order.map(o=>selected.has(o.key)?{...o,size}:o);});
    q('[data-crop-apply]').onclick=()=>{const crop=q('[data-crop]').value.split(',').map(Number);if(crop.length!==4||!crop.every(v=>Number.isFinite(v)&&v>=0)){q('[data-status]').textContent='请输入四个非负边距';return;}change(()=>{order=order.map(o=>selected.has(o.key)?{...o,crop}:o);});};
    q('[data-select]').onchange=e=>{selected=new Set(order.filter((o,i)=>e.target.value==='all'||(e.target.value==='current'&&o.source==='current'&&o.page===S.page)||(e.target.value==='odd'&&i%2===0)||(e.target.value==='even'&&i%2===1)).map(o=>o.key));refreshSelection();};
    q('[data-zoom]').oninput=e=>grid.style.setProperty('--thumb',e.target.value+'px');
    const close=()=>{if(busy)return;closed=true;observer.disconnect();for(const t of tasks)t.cancel();for(const pdf of docs.values())pdf.destroy();d.close();d.remove();};q('[data-close]').onclick=close;d.oncancel=e=>{e.preventDefault();close();};
    d.onkeydown=e=>{if(e.target.matches('input,select,textarea'))return;if(e.key==='Delete'){e.preventDefault();q('[data-org=delete]').click();}if((e.ctrlKey||e.metaKey)&&e.key==='a'){e.preventDefault();q('[data-select]').value='all';q('[data-select]').dispatchEvent(new Event('change'));}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();q(e.shiftKey?'[data-org=redo]':'[data-org=undo]').click();}};
    for(const input of d.querySelectorAll('[data-marks],[data-mark-kind],[data-mark-text],[data-mark-size],[data-mark-color]'))input.onchange=()=>{if(!busy)paint();};
    await perform(async()=>{const bytes=await exportPDF();try{session.assert(capture);await loadDocument('current',bytes);}finally{if(bytes!==S.bytes)await releaseSource(bytes);}paint();grid.children[Math.max(0,S.page-1)]?.scrollIntoView({block:'nearest'});})();
    if(initialAction==='blank'&&!closed&&docs.has('current'))await q('[data-org=blank]').onclick();
  };
}

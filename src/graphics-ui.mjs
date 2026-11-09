import {icon} from './icons.mjs';
import {nativeRequest} from './native-source.mjs';
import {placement,pathFrame,pathPlacement} from './graphic-geometry.mjs';
import {imageSettings} from './image-settings-ui.mjs';
export function installGraphicsUI({S,rev,applyContent,imageTool,vectorTool}) {
  const button=document.createElement('button');button.id='graphics-editor';button.innerHTML=icon('shapes')+'快速图形';button.title='插入图片、生成图像、编辑线条和渐变';button.dataset.doc='';document.querySelector('.more-tools-menu').append(button);
  button.onclick=async()=>{button.closest('details').open=false;
    if(!S.pdf||S.busy)return;
    const dialog=document.createElement('dialog');dialog.className='graphics-dialog';
    dialog.innerHTML='<header><h2>图片与矢量图</h2><button data-close aria-label="关闭">×</button></header><div class="form-grid"><label>查看页码<input data-page type="number" min="1"></label><button data-refresh>刷新对象</button></div><label>页面对象<select data-object></select></label><div class="form-grid three"><label>目标页<input data-target type="number" min="1"></label><label>X（pt）<input data-x type="number" step="1"></label><label>Y（pt）<input data-y type="number" step="1"></label><label>宽度（pt）<input data-width type="number" min="0.1" step="1"></label><label>高度（pt）<input data-height type="number" min="0.1" step="1"></label><label>旋转（°）<input data-rotation type="number" step="1" value="0"></label><label>不透明度（%）<input data-opacity type="number" min="0" max="100" value="100"></label><label>描边颜色<input data-stroke type="color" value="#3467a0"></label><label>线宽（pt）<input data-linewidth type="number" min="0" value="2"></label></div><p class="hint">坐标原点为页面左下角；旋转围绕图片左下角或矢量图中心。修改后可撤销。</p><div class="menu-grid"><button data-apply>应用属性 / 移动</button><button data-delete>删除选中对象</button><button data-insert>插入图片…</button></div><details><summary>图片生成 · Qwen-Image-3.0-Pro</summary><label>描述<textarea data-prompt rows="3" placeholder="描述要生成的图片"></textarea></label><label>像素尺寸<input data-size value="1024x1024"></label><button data-generate>生成并插入当前页</button></details><details><summary>创建或编辑矢量图</summary><div class="menu-grid"><button data-line>直线</button><button data-gradient>渐变矩形</button></div><label>SVG 源码（可修改路径、线条、渐变与全部受支持属性）<textarea data-svg rows="5" spellcheck="false"></textarea></label><button data-vector>插入为新矢量图</button></details><details><summary>图片调色、裁切与混合</summary><label>调色参数（JSON）<textarea data-adjustments rows="3" placeholder=\'{"contrast":10,"saturation":5}\'></textarea></label><label>裁切百分比（左、上、右、下）<input data-crop value="0,0,0,0"></label><label>混合模式<select data-blend><option>Normal</option><option>Multiply</option><option>Screen</option><option>Overlay</option><option>Darken</option><option>Lighten</option><option>Difference</option></select></label></details><p data-status role="status">请选择对象，或插入图片和图形。</p>';
    document.body.append(dialog);dialog.showModal();
    const settings=document.createElement('button');settings.textContent='配置图片服务…';settings.dataset.imageSettings='';settings.onclick=()=>imageSettings().catch(e=>dialog.querySelector('[data-status]').textContent=e.message);dialog.querySelector('[data-generate]').before(settings);
    dialog.querySelector('[data-generate]').closest('details').querySelector('summary').textContent='图片生成';
    const q=s=>dialog.querySelector(s),number=k=>Number(q('[data-'+k+']').value);
    q('[data-page]').value=S.page;q('[data-page]').max=S.info.pageCount;q('[data-target]').max=S.info.pageCount;
    let items=[],current,revision,busy=false;const styleDirty=new Set();
    const close=()=>{if(busy)return;dialog.close();dialog.remove();};q('[data-close]').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
    const geometry=()=>({x:number('x'),y:number('y'),width:number('width'),height:number('height'),rotation:number('rotation')});
    function select(){styleDirty.clear();current=items[Number(q('[data-object]').value)];const m=(current?.kind==='path'?pathFrame(current).matrix:current?.matrix)||[200,0,0,120,72,72],b=current?.box;q('[data-target]').value=number('page');for(const [key,value] of Object.entries({x:b?.[0]??m[4],y:b?.[1]??m[5],width:b?.[2]??Math.hypot(m[0],m[1]),height:b?.[3]??Math.hypot(m[2],m[3]),rotation:current?.rotation??Math.atan2(m[1],m[0])*180/Math.PI,opacity:100*(current?.opacity??1)}))q('[data-'+key+']').value=Math.round(value*100)/100;for(const field of ['stroke','linewidth'])q('[data-'+field+']').closest('label').hidden=current?.kind==='image';q('[data-svg]').value=current?.svg||'';if(current?.kind==='vector'){const xml=new DOMParser().parseFromString(current.svg,'image/svg+xml'),line=xml.querySelector('[stroke]:not([stroke="none"])');q('[data-stroke]').value=line?.getAttribute('stroke')||'#3467a0';q('[data-linewidth]').value=line?.getAttribute('stroke-width')||2;}else if(current?.kind==='path'){q('[data-stroke]').value='#'+current.stroke.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');q('[data-linewidth]').value=current.width??2;}q('[data-adjustments]').value=JSON.stringify(current?.adjustments||{});q('[data-crop]').value=(current?.crop||[0,0,0,0]).join(',');q('[data-blend]').value=current?.blendMode||'Normal';}
    async function refresh(){
      const wanted=current&&(current.id||current.kind+':'+current.index),page=number('page');const capture=rev();
      const info=await imageTool({action:'inspect',page});
      const vectors=await vectorTool({action:'list',page});
      const raw=await nativeRequest({command:'inspect',bytes:S.bytes,page});
      if(rev()!==capture)throw Error('文档已变化，请刷新');
      items=[...info.images.filter(o=>o.editable).map(o=>({...o,kind:'image'})),...info.inserted.map(o=>({...o,kind:'image'}))];
      for(const g of vectors.graphics){const full=await vectorTool({action:'read',page,id:g.id});items.push({...g,...full,kind:'vector'});}
      for(const p of raw.objects.filter(o=>o.type==='path'&&o.editable)){const prior=S.nativeEdits.find(e=>e.page===page&&e.index===p.index);if(!prior?.delete)items.push({...p,...prior,matrix:(prior?.matrix||p.matrix.map((v,i)=>v+(i>=4?(raw.pageOrigin?.[i-4]||0):0))),kind:'path'});}
      revision=rev();q('[data-object]').replaceChildren(...items.map((o,i)=>{const option=document.createElement('option');option.value=i;option.textContent=(o.kind==='vector'?'矢量图':o.kind==='path'?'原有路径':'图片')+' · '+(o.index??o.id?.slice(0,8));return option;}));const selected=items.findIndex(o=>(o.id||o.kind+':'+o.index)===wanted);q('[data-object]').value=String(Math.max(0,selected));select();
    }
    const perform=fn=>async()=>{if(busy)return;busy=true;q('[data-status]').textContent='正在处理…';dialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();await refresh();q('[data-status]').textContent='已完成，可在文档中查看并撤销。';}catch(e){q('[data-status]').textContent=e.message;}finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}};
    q('[data-refresh]').onclick=perform(refresh);q('[data-object]').onchange=select;
    const base=()=>({page:number('page'),targetPage:number('target'),revision});
    q('[data-insert]').onclick=perform(()=>imageTool({...base(),action:'insert',geometry:geometry()}));
    q('[data-generate]').onclick=perform(async()=>{const target={...base(),geometry:geometry()};const result=await imageTool({action:'generate_new',prompt:q('[data-prompt]').value,parameters:{size:q('[data-size]').value}});const asset=result.results[0];if(asset.error)throw Error(asset.error);if(rev()!==target.revision)throw Error('生成期间文档已变化；请在聊天中插入图片资产 '+asset.assetId);await imageTool({...target,action:'insert',assetId:asset.assetId});});
    const change=action=>perform(async()=>{
      if(!current)throw Error('请选择对象');
      if(current.kind==='image')await imageTool({...base(),action,id:current.id,index:current.index,geometry:{...geometry(),crop:q('[data-crop]').value.split(',').map(Number)},opacity:number('opacity')/100,blendMode:q('[data-blend]').value,adjustments:JSON.parse(q('[data-adjustments]').value||'{}')});
      else if(current.kind==='vector'){let svg=q('[data-svg]').value;if(styleDirty.size){const xml=new DOMParser().parseFromString(svg,'image/svg+xml');for(const node of xml.querySelectorAll('[stroke]:not([stroke="none"]),line,polyline')){if(styleDirty.has('stroke')){node.setAttribute('stroke',q('[data-stroke]').value);node.style.removeProperty('stroke');}if(styleDirty.has('linewidth')){node.setAttribute('stroke-width',number('linewidth'));node.style.removeProperty('stroke-width');}}svg=new XMLSerializer().serializeToString(xml.documentElement);}await vectorTool({...base(),action:action==='update'?'update':'delete',id:current.id,svg,box:[number('x'),number('y'),number('width'),number('height')],rotation:number('rotation'),opacity:number('opacity')/100});}
      else {
        if(rev()!==revision)throw Error('文档已变化，请刷新');
        const page=number('page'),targetPage=number('target');if(!Number.isInteger(targetPage)||targetPage<1||targetPage>S.info.pageCount)throw Error('目标页无效');
        const stroke=q('[data-stroke]').value.match(/\w\w/g).map(s=>parseInt(s,16));stroke.push(Math.round(number('opacity')*2.55));
        const edit={...current,...pathPlacement(geometry(),current),page,type:'path',stroke,width:number('linewidth'),delete:action==='delete'};delete edit.kind;
        const edits=S.nativeEdits.filter(e=>!(e.page===page&&e.index===current.index));
        if(action!=='delete'&&targetPage!==page){edits.push({type:'path',page,index:current.index,signature:current.signature,delete:true});delete edit.index;delete edit.signature;edit.page=targetPage;edit.id=crypto.randomUUID();}
        await applyContent([...edits,edit],S.ocr);
      }
    });
    for(const field of ['stroke','linewidth'])q('[data-'+field+']').addEventListener('input',()=>styleDirty.add(field));
    q('[data-apply]').onclick=change('update');q('[data-delete]').onclick=change('delete');
    q('[data-line]').onclick=()=>{q('[data-svg]').value='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><line id="line" x1="10" y1="60" x2="190" y2="60" stroke="'+q('[data-stroke]').value+'" stroke-width="'+number('linewidth')+'"/></svg>';};
    q('[data-gradient]').onclick=()=>{q('[data-svg]').value='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><defs><linearGradient id="gradient"><stop id="start" offset="0" stop-color="#3467a0"/><stop id="end" offset="1" stop-color="#f3b564"/></linearGradient></defs><rect id="shape" width="200" height="120" fill="url(#gradient)"/></svg>';};
    q('[data-vector]').onclick=perform(()=>vectorTool({...base(),action:'create',page:number('target'),svg:q('[data-svg]').value,box:[number('x'),number('y'),number('width'),number('height')],rotation:number('rotation'),opacity:number('opacity')/100}));
    await perform(refresh)();
  };
}

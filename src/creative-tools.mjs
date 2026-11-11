import {nativeRequest,releaseSource} from './native-source.mjs';
import {toBase64,fromBase64} from './portable-state.mjs';
import {placement} from './graphic-geometry.mjs';
import {EmbeddedStudio} from './creative-embedded.mjs';
import {t} from './i18n.mjs';
import {transformedBounds} from './object-selection-model.mjs';
import {artworkBounds} from './creative-background.mjs';
import {canvasPlacement} from './studio-canvas-geometry.mjs';

export function pathSVG(p){
  const [l,b,r,t]=p.bounds,w=Math.max(1,r-l),h=Math.max(1,t-b),points=p.segments||[];
  let d='';for(let i=0;i<points.length;i++){const q=points[i];if(q.type===1&&points[i+2]){d+=`C${q.x} ${q.y} ${points[i+1].x} ${points[i+1].y} ${points[i+2].x} ${points[i+2].y} `;i+=2;}else d+=(q.type===2?'M':'L')+q.x+' '+q.y+' ';if(points[i].close)d+='Z ';}
  const color=c=>c?'#'+c.slice(0,3).map(n=>Math.round(n).toString(16).padStart(2,'0')).join(''):'none';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g transform="matrix(1 0 0 -1 ${-l} ${t})"><path id="path" transform="matrix(${p.matrix.join(' ')})" d="${d}" fill="${p.fillMode?color(p.fill):'none'}" fill-opacity="${(p.fill?.[3]??255)/255}" fill-rule="${p.fillMode===1?'evenodd':'nonzero'}" stroke="${p.stroked?color(p.stroke):'none'}" stroke-opacity="${(p.stroke?.[3]??255)/255}" stroke-width="${p.width>0?p.width:.1}" stroke-dasharray="${p.dash?.length?p.dash.join(' '):'none'}" stroke-dashoffset="${p.dashPhase||0}" stroke-linecap="${['butt','round','square'][p.cap]||'butt'}" stroke-linejoin="${['miter','round','bevel'][p.join]||'miter'}"/></g></svg>`;
}

export function installCreativeTools({S,rev,applyContent,writeFile,approve,exportPDF}){
  const embedded=new EmbeddedStudio({writeFile});
  const sessions=new Map();const documentKey=()=>rev().slice(0,rev().lastIndexOf('/'));
  async function syncCanvas(s,state,effectiveBounds){
    state??=await embedded.request({action:'inspect',sessionId:s.sessionId});
    const bounds=artworkBounds(s.kind,state),old=s.artBounds;
    if(old&&(effectiveBounds||bounds.some((v,i)=>Math.abs(v-old[i])>1e-6))){
      // Native PhotoCraft canvas-size uses a centred anchor by default. Explicit
      // handle crops supply their exact origin; vector artboards carry x and y.
      const next=effectiveBounds||(s.kind==='photo'?[-(bounds[2]-old[2])/2,-(bounds[3]-old[3])/2,bounds[2],bounds[3]]:bounds);
      const matches=(a,b)=>a?.every((v,i)=>Math.abs(v-b[i])<1e-6),history=s.canvasHistory??=[],future=s.canvasFuture??=[];
      const undo=!effectiveBounds&&history.at(-1),redo=!effectiveBounds&&future.at(-1);
      if(undo&&matches(bounds,undo.before)){history.pop();future.push(undo);s.matrix=undo.beforeMatrix;}
      else if(redo&&matches(bounds,redo.after)){future.pop();history.push(redo);s.matrix=redo.afterMatrix;}
      else{const beforeMatrix=s.matrix;s.matrix=canvasPlacement(s.matrix,old,next);history.push({before:old,after:bounds,beforeMatrix,afterMatrix:s.matrix});if(history.length>100)history.shift();future.length=0;}
      s.canvasHistory=history;s.canvasFuture=future;
      s.box=[s.matrix[4],s.matrix[5],Math.hypot(...s.matrix.slice(0,2)),Math.hypot(...s.matrix.slice(2,4))];
      const e=embedded.get(s.sessionId);e.dimensions=bounds.slice(2);e.referenceMatrix=s.matrix;
      embedded.notify('geometry',{sessionId:s.sessionId,box:s.box,matrix:s.matrix,dimensions:e.dimensions});
    }
    s.artBounds=bounds;return state;
  }
  S.flushStudios=async()=>{
    for(const s of sessions.values())if(!s.documentKey||s.documentKey===documentKey()){
      const edit=S.nativeEdits.find(e=>e.id===s.id);
      if(s.baseline&&(!edit||edit.delete))continue;
      await run({action:'apply',sessionId:s.sessionId,revision:rev()});
    }
  };
  const objectCaches=new WeakMap();
  async function objects(page){
    let objectCache=objectCaches.get(S.bytes);
    if(!objectCache){objectCache=new Map();objectCaches.set(S.bytes,objectCache);}
    const key=rev()+':'+page;
    if(!objectCache.has(key)){
      const promise=readObjects(page).catch(error=>{if(objectCache.get(key)===promise)objectCache.delete(key);throw error;});
      objectCache.set(key,promise);
      while(objectCache.size>3)objectCache.delete(objectCache.keys().next().value);
    }
    return objectCache.get(key);
  }
  async function readObjects(page){
    const capture=rev();const [raw,studio,vectors]=await Promise.all([
      nativeRequest({command:'inspect',bytes:S.bytes,page,graphicsOnly:true}),nativeRequest({command:'studio-list',bytes:S.bytes,page}),nativeRequest({command:'vector-list',bytes:S.bytes,page})]);
    if(capture!==rev())throw Error('文档已变化，请刷新对象');
    const items=[];
    for(const o of raw.objects.filter(o=>['image','path'].includes(o.type)&&o.editable)){
      const prior=S.nativeEdits.find(e=>e.page===page&&e.index===o.index);if(prior?.delete||prior?.type==='studio-graphic')continue;
      const origin=raw.pageOrigin||[0,0],matrix=o.matrix.map((v,i)=>v+(i>=4?origin[i-4]:0));
      const bounds=transformedBounds({...o,matrix,bounds:o.bounds.map((v,i)=>v+origin[i%2])},prior);
      const item={...o,matrix,...prior,pageRotation:raw.pageRotation||0,kind:o.type,target:o.type,key:o.type+':'+o.index,bounds,box:[bounds[0],bounds[1],Math.max(1,bounds[2]-bounds[0]),Math.max(1,bounds[3]-bounds[1])]};
      if(o.type==='image')item.box=[item.matrix[4],item.matrix[5],Math.hypot(...item.matrix.slice(0,2)),Math.hypot(...item.matrix.slice(2,4))];
      items.push(item);
    }
    const own=new Map([...studio.graphics.map(o=>[o.id,{...o,target:'studio'}]),...vectors.graphics.map(o=>[o.id,{...o,kind:'vector',target:'vector'}])]);
    for(const e of S.nativeEdits.filter(e=>e.page===page&&['studio-graphic','vector-graphic','inserted-image'].includes(e.type))){if(e.replaceVectorId)own.delete(e.replaceVectorId);if(e.delete)own.delete(e.id);else own.set(e.id,{...e,kind:e.kind|| (e.type==='inserted-image'?'photo':'vector'),target:e.type==='studio-graphic'?'studio':e.type==='inserted-image'?'inserted':'vector'});}
    items.push(...[...own.values()].map(o=>{if(o.target==='vector'&&!o.matrix){const [x,y,w,h]=o.box,angle=(o.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);o={...o,matrix:[w*c,w*s,-h*s,h*c,x+w/2-(c*w-s*h)/2,y+h/2-(s*w+c*h)/2]};}return {...o,box:o.box||[o.matrix[4],o.matrix[5],Math.hypot(...o.matrix.slice(0,2)),Math.hypot(...o.matrix.slice(2,4))],key:o.target+':'+o.id};}));
    return {revision:capture,page,objects:items};
  }
  async function run(a){
    if(['objects','delete','duplicate','move','apply'].includes(a.action)&&!S.pdf)throw Error('请先打开要放置作品的 PDF');
    const page=a.page??S.page??1;if(S.pdf&&(!Number.isInteger(page)||page<1||page>S.info.pageCount))throw Error('页码无效');
    if(a.action==='objects'){const r=await objects(page);return {...r,objects:structuredClone(r.objects.map(({sourceData,imageData,pdfData,svg,segments,...o})=>o))};}
    if(a.action==='list')return {revision:rev(),sessions:[...sessions.values()].filter(s=>!s.documentKey||s.documentKey===documentKey()).map(({sessionId,kind,page,id})=>({sessionId,kind,page,id}))};
    if(!approve(a))throw Error('用户取消操作');
    if(['delete','duplicate','move'].includes(a.action)){
      const capture=rev();if(a.revision!==capture)throw Error('文档已变化，请刷新对象');
      const target=(await objects(page)).objects.find(o=>a.id?o.id===a.id:o.index===a.index);if(!target)throw Error('未找到对象');
      const prior=S.nativeEdits.find(e=>e.page===page&&(target.id?e.id===target.id:e.index===target.index));
      if(a.action==='delete'){
        const edit=target.index!==undefined?{type:target.type||target.target,page,index:target.index,signature:target.signature,delete:true}:target.target==='inserted'?null:{type:target.target==='studio'?'studio-graphic':'vector-graphic',id:target.id,page,delete:true};
        if(rev()!==capture)throw Error('文档已变化，请重试');
        await applyContent([...S.nativeEdits.filter(e=>e!==prior),...(edit?[edit]:[])],S.ocr);return {revision:rev(),applied:true};
      }
      const kind=['photo','image'].includes(target.kind)?'photo':'vector';
      const opened=await run({action:'open',kind,page,id:target.id,index:target.index,visible:false,reuse:false,revision:capture});
      const s=sessions.get(opened.sessionId),base=s.matrix;
      let r;try{r=await embedded.request({action:'capture',sessionId:s.sessionId});}finally{await run({action:'close',sessionId:s.sessionId});}
      const matrix=placement(a.geometry||{x:base[4]+12,y:base[5]-12},base).matrix,targetPage=a.targetPage??page;
      if(!Number.isInteger(targetPage)||targetPage<1||targetPage>S.info.pageCount)throw Error('目标页码无效');
      const edit={type:'studio-graphic',id:crypto.randomUUID(),page:targetPage,kind,box:[matrix[4],matrix[5],Math.hypot(...matrix.slice(0,2)),Math.hypot(...matrix.slice(2,4))],matrix,sourceData:r.sourceData,sourceExtension:r.extension,...(r.pdfData?{pdfData:r.pdfData}:{imageData:r.imageData}),opacity:target.opacity??1,blendMode:target.blendMode||'Normal'};
      const remove=target.index!==undefined?{type:target.type||target.target,page,index:target.index,signature:target.signature,delete:true}:target.target==='inserted'?null:{type:target.target==='studio'?'studio-graphic':'vector-graphic',id:target.id,page,delete:true};
      if(rev()!==capture)throw Error('文档已变化，请重试');
      await applyContent([...S.nativeEdits.filter(e=>a.action==='duplicate'||e!==prior),...(a.action==='move'&&remove?[remove]:[]),edit],S.ocr);return {revision:rev(),id:edit.id,page:targetPage,applied:true};
    }
    if(a.action==='open'){
      const capture=rev();if(a.revision!==undefined&&a.revision!==capture)throw Error('文档已变化，请刷新');
      const existing=a.reuse!==false&&a.id&&[...sessions.values()].find(s=>s.id===a.id&&s.documentKey===documentKey()&&JSON.stringify(s.baseline)===JSON.stringify(S.nativeEdits.find(e=>e.id===a.id)));
      if(existing){const e=embedded.get(existing.sessionId);if(a.visible)queueMicrotask(()=>embedded.notify('show',{sessionId:existing.sessionId}));return {sessionId:existing.sessionId,kind:existing.kind,dimensions:e.dimensions,page:existing.page,box:existing.box,matrix:existing.matrix,revision:capture,reused:true};}
      if(S.imageEdit?.editing||S.flowDraftDirty)throw Error('请先应用当前页面编辑');
      let target,data,extension,frame,box=a.box,warnings=[];
      const kind=a.kind||'photo';
      if(a.id||a.index!==undefined){
        target=(await objects(page)).objects.find(o=>a.id?o.id===a.id:o.index===a.index);
        if(!target)throw Error('未找到对象，请刷新');box=target.box||[target.matrix[4],target.matrix[5],Math.hypot(...target.matrix.slice(0,2)),Math.hypot(...target.matrix.slice(2,4))];
        if(target.sourceData&&target.kind===kind){data=target.sourceData;extension=target.sourceExtension|| (target.kind==='photo'?'pcraft':'vectorcraft');}
        else if(target.target==='studio'){
          data=target.pdfData;extension='pdf';
          if(target.imageData){data=target.imageData;extension='png';}
          else if(!data){const {graphics}=await nativeRequest({command:'studio-list',bytes:S.bytes,page,id:target.id});data=graphics.find(o=>o.id===target.id)?.pdfData;}
          if(kind==='photo'&&extension==='pdf'){data=(await nativeRequest({command:'studio-raster',pdfData:data})).imageData;extension='png';}
        }else if(['image','inserted'].includes(target.target)){
          const image=await nativeRequest({command:'image-export',bytes:S.bytes,page,index:target.index,imageData:target.imageData,adjustments:target.adjustments,crop:target.crop,perspective:target.perspective,imageFit:target.imageFit,matrix:target.matrix,clipBounds:target.clipBounds,pageRotation:target.pageRotation??(await S.pdf.getPage(page)).rotate,studio:true});
          data=image.imageData;extension='png';frame=image.matrix;box=image.box;
          if(image.resolutionReduced)warnings.push('图片已按工作室像素预算缩小，页面位置和方向保持不变。');
        }else{data=toBase64(new TextEncoder().encode(target.svg||pathSVG(target)));extension='svg';}
      }
      if(!box){const [l,b,r,t]=S.pdf?(await S.pdf.getPage(page)).view:[0,0,612,792];const ratio=(a.settings?.height||800)/(a.settings?.width||1200),w=Math.min(360,r-l-72,(t-b-72)/ratio);box=[l+36,b+36,w,w*ratio];}
      if(rev()!==capture)throw Error('文档已变化，请重试');
      const name=target?`${t(kind==='photo'?'图片':'矢量图')} · ${t('第 {0} 页',{0:page})} · ${Math.round(box[2])} × ${Math.round(box[3])} pt.${extension}`:undefined;
      const result=await embedded.request({action:'open',kind,visible:a.visible===true,data,extension,name,path:a.path,pick:a.pick,settings:a.settings});
      if(result.cancelled)return result;
      if(rev()!==capture){await embedded.request({action:'close',sessionId:result.sessionId});throw Error('文档已变化，请重试');}
      const s={sessionId:result.sessionId,documentKey:S.pdf?documentKey():null,kind,page,box,target,id:target?.target==='studio'?target.id:crypto.randomUUID(),baseline:target&&S.nativeEdits.find(e=>e.page===page&&(target.id?e.id===target.id:e.index===target.index))};sessions.set(s.sessionId,s);
      if(!target&&result.dimensions){const ratio=result.dimensions[1]/result.dimensions[0];box=[box[0],box[1],box[2],box[2]*ratio];s.box=box;}
      s.matrix=frame||(target?.matrix&&target.target!=='path'?target.matrix:[box[2],0,0,box[3],box[0],box[1]]);
      s.artBounds=artworkBounds(kind,await embedded.request({action:'inspect',sessionId:s.sessionId}));
      embedded.get(s.sessionId).autoExpand=!!target?.studioOptions?.autoExpand;
      if(S.pdf){
        try{await run({action:'background',sessionId:s.sessionId,options:{mode:'pdf',opacity:.6}});}
        catch(error){warnings.push('PDF 背景暂未载入：'+error.message);}
      }
      if(a.visible)queueMicrotask(()=>embedded.notify('show',{sessionId:s.sessionId,kind:s.kind}));
      return {...result,revision:rev(),page,box,matrix:s.matrix,warnings,next:'commands discovers parameters; execute/batch edits this session; preview inspects pixels; apply writes one undoable PDF edit. Layers are stored only in .folio projects.'};
    }
    const s=sessions.get(a.sessionId);if(!s)throw Error('创作会话不存在，请重新打开');
    if(a.action==='canvas-resize'){
      const before=await syncCanvas(s),bounds=a.bounds;
      if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite)||bounds.slice(2).some(v=>v<1||v>300000))throw Error('画布尺寸无效');
      const [x,y,width,height]=bounds.map(v=>s.kind==='photo'?Math.round(v):v);
      await embedded.request({action:'execute',sessionId:s.sessionId,command:s.kind==='photo'?'image.crop':'artboard.setProps',params:s.kind==='photo'?{x,y,width,height,deleteCroppedPixels:false}:{index:0,x,y,width,height}});
      await syncCanvas(s,null,[x,y,width,height]);
      const e=embedded.get(s.sessionId);
      if(e.background?.mode==='pdf')await embedded.request({action:'background',sessionId:s.sessionId,options:{matrix:s.matrix}});
      return {bounds:s.artBounds,matrix:s.matrix,box:s.box};
    }
    if(a.action==='inspect'||a.action==='view')await syncCanvas(s);
    if(a.action==='background'){
      await syncCanvas(s);
      const options={...a.options},e=embedded.get(s.sessionId);
      if(options.mode==='pdf'||((options.refresh||options.geometry)&&e.background?.mode==='pdf')){
        if(!S.pdf)throw Error('请先打开 PDF，再选择页面背景');
        if(s.documentKey&&s.documentKey!==documentKey())throw Error('请切回作品所属的 PDF');
        if(options.refresh||!e.reference||e.reference.revision!==rev()){
          const revision=rev(),bytes=await exportPDF();let page;
          try{page=await nativeRequest({command:'studio-reference',bytes,page:s.page,maxSide:2048});}finally{await releaseSource(bytes);}
          if(revision!==rev())throw Error('PDF 已变化，请重新载入页面背景');
          options.reference={...page,revision};
        }
      }
      const base=s.matrix;
      options.matrix=placement(options.geometry||{},base).matrix;
      return embedded.request({...a,options});
    }
    if(a.action==='apply'){
      if(s.documentKey&&s.documentKey!==documentKey())throw Error('此工作室属于另一份文档，请切回原文档');
      const capture=rev();if(a.revision!==capture)throw Error('请取得最新文档修订后应用');
      const current=s.target&&S.nativeEdits.find(e=>e.page===s.page&&(s.target.id?e.id===s.target.id:e.index===s.target.index));
      if(current!==s.baseline&&JSON.stringify(current)!==JSON.stringify(s.baseline))throw Error('原对象已被其他操作修改；工作室内容仍保留，可导出后插入。');
      const r=await embedded.request({action:'capture',sessionId:s.sessionId});
      await syncCanvas(s);
      if(rev()!==capture)throw Error('文档已变化，工作室内容已保留，请重试应用');
      const box=a.box||s.box,base=a.box?[box[2],0,0,box[3],box[0],box[1]]:s.matrix,matrix=placement(a.geometry||{},base).matrix;
      const placedBox=[matrix[4],matrix[5],Math.hypot(matrix[0],matrix[1]),Math.hypot(matrix[2],matrix[3])];
      const edit={type:'studio-graphic',id:s.id,page:s.page,kind:s.kind,box:placedBox,matrix,sourceData:r.sourceData,sourceExtension:r.extension,...(r.pdfData?{pdfData:r.pdfData}:{imageData:r.imageData}),opacity:s.target?.target==='path'?1:s.target?.opacity??1,blendMode:s.target?.blendMode||'Normal'};
      edit.studioOptions={autoExpand:!!embedded.get(s.sessionId).autoExpand};
      const extra=[];
      if(s.target&&['image','path'].includes(s.target.target)){edit.index=s.target.index;edit.signature=s.target.signature;}
      if(s.target?.target==='vector')edit.replaceVectorId=s.target.id;
      else if(s.target?.replaceVectorId)edit.replaceVectorId=s.target.replaceVectorId;
      if(s.target?.target==='studio'&&s.target.index!==undefined){edit.index=s.target.index;edit.signature=s.target.signature;}
      await applyContent([...S.nativeEdits.filter(e=>e!==current),...extra,edit],S.ocr);
      s.baseline=S.nativeEdits.find(e=>e.id===s.id);s.target={...edit,target:'studio'};s.box=placedBox;s.matrix=matrix;s.documentKey=documentKey();
      const e=embedded.get(s.sessionId);e.referenceMatrix=matrix;
      return {applied:true,id:s.id,page:s.page,revision:rev(),warnings:r.warnings,project:'Save .folio to preserve editable layers; PDF contains the final artwork only.'};
    }
    if(a.action==='export'){
      const r=await embedded.request(a);const saved=await writeFile((S.name||'Folio').replace(/\.pdf$/i,'')+'-artwork.'+r.extension,fromBase64(r.data),r.extension);return {saved:!!saved,details:r.details};
    }
    const r=await embedded.request(a);if(a.action==='close')sessions.delete(s.sessionId);return r;
  }
  run.embedded=embedded;run.sessions=sessions;
  return run;
}

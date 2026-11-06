import {nativeRequest,releaseSource} from './native-source.mjs';
import {pageCandidates,checkFlowConflicts} from './flow-page-model.mjs';
export function compactUtilityResult(result){
 const {report,...out}=result;
 if(out.validation){const {report,...validation}=out.validation;out.validation=validation;}
 return out;
}
export function installEngineeringTools({S,exportPDF,session,writeFile,rev,approve,liveContext,documentUtilities,applyContent}){
 return async (name,a,approved=false)=>{
  if(!approved&&!approve(a))throw Error('用户拒绝操作');
  const before=rev(),capture=session.capture();
  if(a.revision&&a.revision!==before)throw Error('Stale document revision');
  const imageResult=(r)=>{const {image,mimeType,...info}=r;return {content:[{type:'text',text:JSON.stringify({...info,revision:before})},{type:'image',mimeType,data:image}]};};
  if(name==='folio_structure'){
   if(!a.revision)throw Error('请先获取当前文档版本');
   return {revision:before,...compactUtilityResult(await documentUtilities({action:a.action,options:a.options||{}}))};
  }
  if(name==='folio_fonts'&&['paragraphs','apply'].includes(a.action)){
   if(!S.pdf||S.busy)throw Error('请先打开文档并等待处理完成');
   const page=a.page??liveContext().currentPage;
   const inspected=await nativeRequest({command:'inspect',bytes:S.bytes,page});session.assert(capture);
   const candidates=pageCandidates(inspected.objects,...inspected.size,[],inspected.tables||[]);
   if(a.action==='paragraphs')return {page,revision:before,paragraphs:candidates.map(c=>({id:c.id,text:c.model.text,fontKey:c.model.fontKey,frame:c.model.frame,reason:c.reason}))};
   if(a.revision!==before)throw Error('字体修改需要最新文档版本');
   const o=a.options||{},candidate=candidates.find(c=>c.id===o.paragraphId);
   if(!candidate||candidate.reason)throw Error(candidate?.reason||'段落 ID 无效');
   const model=structuredClone(candidate.model),coverage=await nativeRequest({command:'font-tools',action:'coverage',options:{fontKey:o.fontKey,text:model.text}});
   if(!coverage.complete)throw Error('字体缺少字符：'+coverage.missing.join(''));
   const font=await nativeRequest({command:'font-tools',action:'inspect',options:{fontKey:o.fontKey}});if(font.embeddingFlags&2)throw Error('字体声明限制嵌入');
   const style={fontKey:font.fontKey,cjkFontKey:font.fontKey,latinFontKey:font.fontKey,...(o.size!==undefined?{size:o.size}:{})};Object.assign(model,style);model.runs=model.runs?.map(r=>({...r,...style}));
   delete model.originalLayout;delete model.fastLayout;
   if(o.frame)model.frame={...model.frame,...o.frame};
   const layout=await window.desktop.flowLayout(model);session.assert(capture);
   if(layout.overflow||layout.mappingComplete===false)throw Error('字体替换会溢出或丢失文字，请调整文本框或字号');
   checkFlowConflicts(model,inspected.objects,S.nativeEdits||[],page,null,layout.glyphs);
   const ids=new Set(model.sources.map(s=>s.index));
   if(S.nativeEdits.some(e=>e.page===page&&(ids.has(e.index)||e.sources?.some(s=>ids.has(s.index)))))throw Error('此段落已有待保存修改，请先保存并重新打开后替换字体');
   const entry={id:crypto.randomUUID(),page,type:'flow',index:null,sources:model.sources,model,fragment:layout.fragment,ink:layout.glyphs};
   await applyContent([...S.nativeEdits,entry],S.ocr);return {applied:true,page,revision:rev(),fontKey:o.fontKey,next:'使用 folio_render 查看实际字形和版式，可撤销。'};
  }
  if(name==='folio_fonts'&&a.action!=='document'){
   const r=await nativeRequest({command:'font-tools',action:a.action,options:a.options||{}});
   if(r.image)return imageResult(r);
   if(r.bytes){const bytes=Uint8Array.from(atob(r.bytes),c=>c.charCodeAt(0));return {saved:!!await writeFile('font.'+r.extension,bytes,r.extension),size:r.size};}
   return r;
  }
  if(!S.pdf)throw Error('请先打开文档');
  const page=a.page??liveContext().currentPage,bytes=await exportPDF();
  session.assert(capture);
  try{
   if(name==='folio_fonts'){
    const result=await nativeRequest({command:'inspect',bytes,page});session.assert(capture);
    return {page,revision:before,fonts:result.fonts,objects:result.objects?.filter(o=>o.type==='text').slice(0,500).map(({index,signature,fontKey,fontName,text})=>({index,signature,fontKey,fontName,text:text?.slice(0,200)}))};
   }
   const r=await nativeRequest({command:'document-utilities',bytes,action:'render-page',options:{page,dpi:a.dpi??144,region:a.region??[0,0,1,1],layers:a.layers,annotations:a.annotations}});
   session.assert(capture);return imageResult(r);
  }finally{if(bytes!==S.bytes)await releaseSource(bytes);}
 };
}

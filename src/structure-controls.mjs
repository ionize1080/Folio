// Human-facing controls for engineering operations; identifiers never become HTML.
export function structureFields(action,container){
 if(action==='pdfx')container.innerHTML='<label>印刷标准<select data-key="standard"><option value="x4">PDF/X-4 · 保留透明度</option><option value="x3">PDF/X-3:2002</option><option value="x1a">PDF/X-1a:2001</option></select></label><label>印厂 CMYK ICC 配置<input type="file" data-key="icc" accept=".icc,.icm"></label><label>印刷条件名称<input data-key="condition" placeholder="例如：印厂提供的纸张与印刷条件"></label><p class="hint">未选 ICC 时使用通用 CMYK 供打样。内置检查覆盖部分印刷规则，正式交付仍需印厂预检。</p>';
 if(action==='validate-pdfua')container.innerHTML='<label>无障碍标准<select data-key="standard"><option value="ua1">PDF/UA-1</option><option value="ua2">PDF/UA-2</option></select></label><p class="hint">由 veraPDF 执行机器规则验证。阅读顺序及替代文字是否准确仍需人工复核。</p>';
}
export async function structureOptions(action,container){
 const value=k=>container.querySelector('[data-key="'+k+'"]')?.value;
 if(action==='validate-pdfua')return {standard:value('standard')};
 if(action==='pdfx'){
  const file=container.querySelector('[data-key="icc"]').files[0],out={standard:value('standard')};
  if(value('condition'))out.condition=value('condition');
  if(file){if(file.size>8*1024*1024)throw Error('ICC 最大 8 MB');const bytes=new Uint8Array(await file.arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));out.icc=btoa(raw);}
  return out;
 }
 return null;
}
export function structureResult(action,result,container,run,writeFile){
 const text=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el;};
 const input=(label,value,type='text')=>{const row=document.createElement('label');row.textContent=label;const field=document.createElement('input');field.type=type;if(type==='checkbox')field.checked=!!value;else field.value=value||'';row.append(field);return {row,field};};
 const operation=(label,work)=>{const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{b.disabled=true;try{const r=await work();b.textContent=r.saved?'副本已保存':r.saved===false?'已取消保存':'已完成';}catch(e){b.textContent=e.message;}finally{b.disabled=false;}};return b;};
 const v=result.validation||result;
 if(v.report)container.append(operation('保存完整验证报告',()=>writeFile('validation-report.xml',new TextEncoder().encode(v.report),'xml').then(saved=>({saved:!!saved}))));
 if(v.scope)container.append(text('p',v.scope));
 for(const issue of (v.failures||v.issues||[]).slice(0,50))container.append(text('p',[issue.page?'第 '+issue.page+' 页':'',issue.clause,issue.description||issue.message].filter(Boolean).join(' · ')));
 if(action==='layers'&&result.layers){
  const changes=[];
  for(const layer of result.layers){
   const row=document.createElement('div');row.className='structure-row';
   const name=input('图层名称',layer.name),visible=input('显示',layer.visible,'checkbox'),locked=input('锁定',layer.locked,'checkbox');row.append(name.row,visible.row,locked.row);container.append(row);
   changes.push(()=>({id:layer.id,name:name.field.value,visible:visible.field.checked,locked:locked.field.checked}));
  }
  if(changes.length)container.append(operation('另存图层设置',()=>run({action:'layers',options:{operation:'configure',changes:changes.map(f=>f())}})));
  const name=input('新图层名称',''),pages=input('包含页面','1');container.append(name.row,pages.row);
  container.append(operation('创建图层副本',()=>{const list=pages.field.value.split(',').map(x=>Number(x.trim()));return run({action:'layers',options:{operation:'create',name:name.field.value,pages:list}});}));
 }
 if(action==='tags'&&result.nodes){
  const lang=input('文档语言',result.language||'zh-CN');container.append(lang.row);const changes=[];
  for(const node of result.nodes.filter(n=>n.role!=='StructTreeRoot')){
   const row=document.createElement('details');row.className='structure-node';row.append(text('summary',node.role+' · '+(node.page?'第 '+node.page+' 页':'结构分组')+(node.title?' · '+node.title:'')));
   const role=input('标签角色',node.role),alt=input('替代文字',node.alt),actual=input('实际文本',node.actualText);row.append(role.row,alt.row,actual.row);container.append(row);
   changes.push(()=>({id:node.id,role:role.field.value,alt:alt.field.value||null,actualText:actual.field.value||null}));
   if(node.children.length>1){
    const select=document.createElement('select');select.setAttribute('aria-label','子标签顺序');const ids=[...node.children];for(const id of ids){const child=result.nodes.find(n=>n.id===id);select.add(new Option((child?.role||'标签')+' '+id,id));}row.append(select);
    row.append(operation('上移所选子标签并另存',()=>{const index=ids.indexOf(select.value);if(index<=0)throw Error('已在最前');const order=[...ids];[order[index-1],order[index]]=[order[index],order[index-1]];return run({action:'tags',options:{operation:'reorder',parent:node.id,ids:order}});}));
   }
  }
  if(result.hasMore)container.append(text('p','此处显示前 200 个标签；AI 工具支持分页查看完整结构。'));
  container.append(operation('另存无障碍属性',()=>run({action:'tags',options:{operation:'patch',language:lang.field.value,changes:changes.map(f=>f())}})));
 }
}

import {auditBookmarks,repairBookmarks,deleteBookmarks,sortBookmarks,everyNBookmarks} from './bookmark-qc.mjs';
import {childrenMap,flattenChildren} from './model.mjs';
import {icon} from './icons.mjs';
export function installBookmarkQC({S,surface,modal,closeModal,esc,commit,toast}){
  const $=s=>document.querySelector(s),menu=$('.more-tools-menu');
  const scope='<option value="all">所有书签</option><option value="selected">所选书签及子项</option>';
  function qc(){
    if(!S.pdf)return;let chosen=new Set(),report,visible,linkResults=[];
    modal('书签统计与质量检查',`<p id="qc-summary" class="callout"></p><div class="form-grid"><label>问题类别<select id="qc-filter"><option value="all">全部问题</option></select></label><label>修复目标页（留空仅修复格式）<input id="qc-page" type="number" min="1" max="${S.info.pageCount}"></label></div><div class="adjust-tools"><button id="qc-select">选中本类全部</button><button id="qc-clear">取消选择</button><button id="qc-links">检测所选网络链接</button><button id="qc-repair">尝试修复</button><button id="qc-delete">仅删除节点</button><button id="qc-delete-tree">删除节点及子项</button></div><p class="hint">仅删除节点会保留并提升子项；修复和删除均可撤销。不会猜测失效链接的目标。网络链接显示“未检测”而不判为死链。</p><div id="qc-list" class="qc-list"></div><p id="qc-status" role="status"></p>`,[{text:'关闭',run:closeModal}]);
    function paint(){report=auditBookmarks(S.nodes,S.info.pageCount);for(const r of linkResults){report.issues=report.issues.filter(x=>!(x.id===r.id&&x.code==="unchecked"));report.issues.push({id:r.id,title:S.nodes.find(n=>n.id===r.id)?.title||"",code:r.status==="dead"?"dead-link":r.status==="ok"?"link-ok":"link-unknown",message:r.status==="dead"?`链接失效：${r.message}`:r.status==="ok"?`链接可达：${r.message}`:`无法确认：${r.message}`});}const s=report.stats;
      $('#qc-summary').textContent=`${s.total} 个书签 · ${s.roots} 个根节点 · ${s.depth} 层 · 覆盖 ${s.targetPages} 页 · ${s.affected} 个待复核节点`;
      const selected=$('#qc-filter').value,counts=new Map();for(const x of report.issues)counts.set(x.code,(counts.get(x.code)||0)+1);
      $('#qc-filter').innerHTML='<option value="all">全部问题</option>'+[...counts].map(([code,count])=>`<option value="${code}">${esc(report.issues.find(x=>x.code===code).message)} (${count})</option>`).join('');
      if(counts.has(selected))$('#qc-filter').value=selected;
      visible=report.issues.filter(x=>$('#qc-filter').value==='all'||x.code===$('#qc-filter').value);
      $('#qc-list').innerHTML=visible.slice(0,1000).map(x=>`<label class="qc-row"><input type="checkbox" data-id="${esc(x.id)}" ${chosen.has(x.id)?'checked':''}><span>${esc(x.title||'（空标题）')}</span><small>${esc(x.message)}</small><button type="button" data-go="${esc(x.id)}">定位</button></label>`).join('')||'<p>此类别没有待复核问题。</p>';
      $('#qc-status').textContent=`已选 ${chosen.size} 个节点 · ${visible.length} 个问题${visible.length>1000?'（显示前 1000 条；全选涵盖全部）':''}`;
    }
    const apply=fn=>{try{if(!chosen.size)return;const nodes=fn();commit(nodes);chosen.clear();paint();toast('书签已更新，可撤销');}catch(e){$('#qc-status').textContent=e.message;}};
    $('#qc-list').onchange=e=>{const id=e.target.dataset.id;if(id){e.target.checked?chosen.add(id):chosen.delete(id);paint();}};
    $('#qc-list').onclick=e=>{const id=e.target.dataset.go;if(id){const n=S.nodes.find(n=>n.id===id);S.selected=new Set([id]);if(n?.target.page)surface.go(n.target.page);}};
    $('#qc-links').onclick=async()=>{const b=$('#qc-links');b.disabled=true;try{const items=S.nodes.filter(n=>chosen.has(n.id)&&n.target?.actionType==='URI').map(n=>({id:n.id,uri:n.target.uri}));$('#qc-status').textContent=`正在检测 ${items.length} 个链接…`;linkResults=await window.desktop.checkBookmarkLinks(items);if($('#qc-list'))paint();}catch(e){if($('#qc-status'))$('#qc-status').textContent=e.message;}finally{b.disabled=false;}};
    $('#qc-filter').onchange=paint;$('#qc-select').onclick=()=>{chosen=new Set(visible.map(x=>x.id));paint();};$('#qc-clear').onclick=()=>{chosen.clear();paint();};
    $('#qc-repair').onclick=()=>apply(()=>repairBookmarks(S.nodes,chosen,S.info.pageCount,{targetPage:$('#qc-page').value?Number($('#qc-page').value):undefined}));
    $('#qc-delete').onclick=()=>apply(()=>deleteBookmarks(S.nodes,chosen));$('#qc-delete-tree').onclick=()=>apply(()=>deleteBookmarks(S.nodes,chosen,true));paint();
  }
  function sort(){
    if(!S.pdf)return;
    modal('排序书签',`<div class="form-grid"><label>排序依据<select id="bs-by"><option value="page">目标页码</option><option value="title">标题</option></select></label><label>范围<select id="bs-scope">${scope}</select></label><label>层级<input id="bs-level" type="number" min="1" value="1"></label><label>顺序<select id="bs-order"><option value="asc">升序</option><option value="desc">降序</option></select></label></div><label class="check"><input id="bs-recursive" type="checkbox">包括全部子层级</label><label class="check"><input id="bs-case" type="checkbox" checked>忽略大小写</label><label class="check"><input id="bs-natural" type="checkbox" checked>自然数字顺序（第 2 章在第 10 章之前）</label><p class="hint">每组同级书签分别排序，子树随父节点移动；外部或无效目标排在末尾。</p><p id="bs-status" role="status"></p>`,[{text:'取消',run:closeModal},{text:'应用排序',primary:true,run:()=>{try{if($('#bs-scope').value==='selected'&&!S.selected.size)throw Error('请先选中书签');commit(sortBookmarks(S.nodes,{by:$('#bs-by').value,descending:$('#bs-order').value==='desc',level:Number($('#bs-level').value),recursive:$('#bs-recursive').checked,ignoreCase:$('#bs-case').checked,natural:$('#bs-natural').checked,ids:$('#bs-scope').value==='all'?null:S.selected}));closeModal();toast('排序已应用，可撤销');}catch(e){$('#bs-status').textContent=e.message;}}}]);
  }
  function every(){
    if(!S.pdf)return;
    modal('每 N 页生成书签',`<div class="form-grid"><label>页码范围<input id="bn-range" value="1-${S.info.pageCount}"></label><label>子集<select id="bn-parity"><option value="all">全部</option><option value="odd">奇数页</option><option value="even">偶数页</option></select></label><label>每 N 个所选页面<input id="bn-interval" type="number" min="1" value="1"></label><label>编号起点<input id="bn-start" type="number" value="1"></label><label>编号补零位数<input id="bn-pad" type="number" min="0" max="12" value="0"></label><label>插入位置<select id="bn-parent"><option value="root">根级末尾</option><option value="selected">所选书签下</option></select></label></div><label>标题模板<input id="bn-template" value="第 {page} 页"></label><p class="hint">可用：{page} 物理页码、{index} 编号、{pages} 总页数、{label} 页标签、{filename} 文件名、{text} 页面首行文字。间隔按筛选后的页面计数。</p><label class="check"><input id="bn-skip" type="checkbox" checked>跳过已有同标题且同目标页的书签</label><p id="bn-preview" class="callout"></p>`,[{text:'取消',run:closeModal},{text:'生成书签',id:'bn-apply',primary:true,run:async()=>{
      const button=$('#bn-apply');button.disabled=true;
      try{const parent=$('#bn-parent').value==='selected'?[...S.selected][0]:null;if($('#bn-parent').value==='selected'&&!parent)throw Error('请先选择一个父书签');
        const opts=options(),labels=await S.pdf.getPageLabels()||[],firstLines=[];
        if(opts.template.includes('{text}'))for(const n of everyNBookmarks(opts)){const p=await S.pdf.getPage(n.target.page),t=await p.getTextContent();let line='';for(const item of t.items){line+=item.str||'';if(item.hasEOL&&line.trim())break;}firstLines[n.target.page-1]=line.trim();}
        let added=everyNBookmarks({...opts,parent,labels,firstLines});const existing=new Set(S.nodes.map(n=>JSON.stringify([n.title,n.target?.page])));
        if($('#bn-skip').checked)added=added.filter(n=>!existing.has(JSON.stringify([n.title,n.target.page])));
        commit(flattenChildren(childrenMap([...S.nodes,...added])));closeModal();toast(`已生成 ${added.length} 个书签`);
      }catch(e){$('#bn-preview').textContent=e.message;button.disabled=false;}}}]);
    function options(){return {pageCount:S.info.pageCount,range:$('#bn-range').value,parity:$('#bn-parity').value,interval:Number($('#bn-interval').value),template:$('#bn-template').value,start:Number($('#bn-start').value),pad:Number($('#bn-pad').value),filename:S.name.replace(/\.pdf$/i,'')};}
    function preview(){try{const nodes=everyNBookmarks(options());$('#bn-preview').textContent=`预计 ${nodes.length} 个书签：${nodes.slice(0,4).map(n=>n.title).join(' · ')}`;$('#bn-apply').disabled=!nodes.length;}catch(e){$('#bn-preview').textContent=e.message;$('#bn-apply').disabled=true;}}
    for(const el of $('#modal-body').querySelectorAll('input,select'))el.addEventListener('input',preview);preview();
  }
  for(const [id,title,run] of [['bookmark-qc','统计 / QC',qc],['bookmark-every','每 N 页书签',every],['bookmark-sort','排序书签',sort]]){const b=document.createElement('button');b.id=id;b.innerHTML=icon(id==='bookmark-every'?'bookmark-interval':id)+'<span>'+title+'</span>';b.dataset.doc='';b.onclick=run;menu.append(b);}
}

import {nativeRequest,releaseSource} from './native-source.mjs';
import {icon} from './icons.mjs';
import {pageRange} from './generation.mjs';
const encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export function installDocumentAssembly({S,exportPDF,session,writeFile}) {
  const button=document.createElement('button');button.innerHTML=icon('pages')+'合并 / 拆分';button.id='document-assembly';button.title='多格式合并、自由排序、书签整合与拆分';
  document.querySelector('.more-tools-menu').append(button);
  async function run(a) {
    if(S.busy)throw Error('正在处理文档');if(a.action==='split'&&!S.pdf)throw Error('请先打开文档');
    const capture=session.capture();
    const bytes=S.pdf?await exportPDF():new Uint8Array();session.assert(capture);
    try {
    if(a.action==='split') {
      let groups;
      if(a.ranges)groups=a.ranges.map(r=>pageRange(r,S.info.pageCount));
      else {
        const size=a.every??1;
        if(!Number.isInteger(size)||size<1||size>S.info.pageCount)throw Error('每份页数无效');
        groups=Array.from({length:Math.ceil(S.info.pageCount/size)},(_,i)=>Array.from({length:Math.min(size,S.info.pageCount-i*size)},(_,j)=>i*size+j+1));
      }
      if(!groups.length||groups.length>100)throw Error('每次拆分最多 100 份');
      const outputs=[];
      for(let i=0;i<groups.length;i++) {
        session.assert(capture);
        const result=await nativeRequest({command:'document-assemble',bytes,parts:[{current:true,pages:groups[i]}],bookmarks:a.bookmarks!==false});
        session.assert(capture);
        const saved=await writeFile(S.name.replace(/\.pdf$/i,'')+'-part-'+String(i+1).padStart(3,'0')+'.pdf',decode(result.bytes),'pdf');
        if(!saved)return {saved:outputs.length,cancelled:true};
        outputs.push({part:i+1,pages:groups[i]});
      }
      return {saved:outputs.length,outputs};
    }
    const parts=a.parts||(S.pdf?[{current:true,name:S.name}]:[]);
    if(!a.parts) {
      const files=await window.desktop.mergeFiles();if(!files.length)return {cancelled:true};session.assert(capture);
      parts.push(...files.map(file=>({name:file.name,data:encode(new Uint8Array(file.bytes))})));
    }
    const result=await nativeRequest({command:'document-assemble',bytes,parts,bookmarks:a.bookmarks!==false,bookmarkMode:a.bookmarkMode});session.assert(capture);
    const saved=await writeFile((S.name||'Documents').replace(/\.pdf$/i,'')+'-merged.pdf',decode(result.bytes),'pdf');
    return {saved:!!saved,pageCount:result.pageCount,manifest:result.manifest,bookmarkMode:result.bookmarkMode};
    } finally { if(bytes!==S.bytes) await releaseSource(bytes); }
  }
  button.onclick=()=>{button.closest('details').open=false;
    if(S.busy)return;
    const capture=session.capture(), dialog=document.createElement('dialog');dialog.className='assembly-dialog';
    dialog.innerHTML='<header><h2>合并与拆分 PDF</h2><button data-close aria-label="关闭">'+icon('close')+'</button></header><p>包含当前未保存的编辑，结果另存为新文件。</p><label>操作<select data-mode><option value="merge">多格式合并</option><option value="split">拆分 PDF</option></select></label><section data-merge><ol data-files></ol><button data-add>添加文件…</button><p class="hint">支持 PDF、Office、图片与文本。拖动文件或用上下按钮排序；可自定义每份文件的书签标题。</p></section><section data-split hidden><label>每份页数<input data-every type="number" min="1" value="1"></label><label>或指定分组（分号分隔）<input data-ranges placeholder="1-3;4-6;7,9"></label></section><label>书签组织<select data-bookmark-mode><option value="combined">文件名 + 合并原有书签</option><option value="preserve">仅合并原有书签</option><option value="files">仅文件名书签</option><option value="none">不添加书签</option></select></label><p data-status role="status"></p><footer><button data-run>另存结果…</button></footer>';
    document.body.append(dialog);dialog.showModal();
    const q=s=>dialog.querySelector(s),files=S.pdf?[{current:true,name:S.name}]:[];
    let dragIndex=-1;
    const paint=()=>{q('[data-files]').replaceChildren(...files.map((f,i)=>{
      const li=document.createElement('li');li.className='merge-file-row';li.draggable=true;
      li.ondragstart=e=>{if(busy){e.preventDefault();return;}dragIndex=i;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(i));};
      li.ondragover=e=>{e.preventDefault();};li.ondrop=e=>{e.preventDefault();if(busy||dragIndex<0||dragIndex===i)return;const item=files.splice(dragIndex,1)[0];files.splice(i,0,item);dragIndex=-1;paint();};
      const label=document.createElement('span');label.className='merge-file-name';label.textContent=(i+1)+'. '+f.name;label.setAttribute('translate','no');li.append(label);
      const bookmark=document.createElement('input');bookmark.value=f.bookmark??f.name.replace(/\.[^.]+$/,'');bookmark.setAttribute('aria-label','书签标题');bookmark.placeholder='书签标题';bookmark.oninput=()=>f.bookmark=bookmark.value;li.append(bookmark);
      for(const [symbol,delta,text] of [['arrow-up',-1,'上移'],['arrow-down',1,'下移'],['close',0,'移除']]){
        const b=document.createElement('button');b.innerHTML=icon(symbol);b.setAttribute('aria-label',text);b.title=text;b.disabled=delta?i+delta<0||i+delta>=files.length:false;
        b.onclick=()=>{if(busy)return;if(delta)[files[i],files[i+delta]]=[files[i+delta],files[i]];else files.splice(i,1);paint();};li.append(b);
      }return li;
    }));};
    let busy=false;paint();q('[data-mode] option[value="split"]').disabled=!S.pdf;const close=()=>{if(busy)return;dialog.close();dialog.remove();};q('[data-close]').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
    q('[data-mode]').onchange=()=>{q('[data-merge]').hidden=q('[data-mode]').value!=='merge';q('[data-split]').hidden=q('[data-mode]').value!=='split';};
    q('[data-add]').onclick=async()=>{try{session.assert(capture);const picked=await window.desktop.mergeFiles();session.assert(capture);if(files.length+picked.length>100)throw Error('每批最多 100 个文件');for(const file of picked)files.push({name:file.name,data:encode(new Uint8Array(file.bytes))});paint();}catch(e){q('[data-status]').textContent=e.message;}};
    q('[data-run]').onclick=async()=>{if(busy)return;busy=true;const inputs=[...dialog.querySelectorAll('input,button,select')];inputs.forEach(el=>el.disabled=true);try{session.assert(capture);q('[data-status]').textContent='正在处理…';const ranges=q('[data-ranges]').value.trim();const result=await run({action:q('[data-mode]').value,every:Number(q('[data-every]').value),ranges:ranges?ranges.split(';').map(s=>s.trim()).filter(Boolean):undefined,parts:files,bookmarkMode:q('[data-bookmark-mode]').value,bookmarks:q('[data-bookmark-mode]').value!=='none'});q('[data-status]').textContent=result.cancelled?'已取消后续保存':result.saved?'已保存结果':'已取消保存';}catch(e){q('[data-status]').textContent=e.message;}finally{busy=false;inputs.forEach(el=>el.disabled=false);paint();}};
  };
  return run;
}

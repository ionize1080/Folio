import {nativeRequest,releaseSource} from './native-source.mjs';
import {pageRange} from './generation.mjs';
const encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export function installDocumentAssembly({S,exportPDF,session,writeFile}) {
  const button=document.createElement('button');button.textContent='合并 / 拆分';button.id='document-assembly';button.title='合并 PDF、按页数或页码范围拆分';
  button.dataset.doc='';document.querySelector('.more-tools-menu').append(button);
  async function run(a) {
    if(!S.pdf||S.busy)throw Error('请先打开文档');
    const capture=session.capture();
    const bytes=await exportPDF();session.assert(capture);
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
    const parts=a.parts||[{current:true}];
    if(!a.parts) {
      const file=await window.desktop.open('pdf');if(!file)return {cancelled:true};session.assert(capture);
      parts.push({data:encode(new Uint8Array(file.bytes))});
    }
    const result=await nativeRequest({command:'document-assemble',bytes,parts,bookmarks:a.bookmarks!==false});session.assert(capture);
    const saved=await writeFile(S.name.replace(/\.pdf$/i,'')+'-merged.pdf',decode(result.bytes),'pdf');
    return {saved:!!saved,pageCount:result.pageCount};
    } finally { if(bytes!==S.bytes) await releaseSource(bytes); }
  }
  button.onclick=()=>{button.closest('details').open=false;
    if(!S.pdf||S.busy)return;
    const capture=session.capture(), dialog=document.createElement('dialog');dialog.className='assembly-dialog';
    dialog.innerHTML='<header><h2>合并与拆分 PDF</h2><button data-close aria-label="关闭">×</button></header><p>包含当前未保存的编辑，结果另存为新文件。</p><label>操作<select data-mode><option value="merge">合并 PDF</option><option value="split">拆分 PDF</option></select></label><section data-merge><ol data-files></ol><button data-add>添加 PDF…</button><p class="hint">使用上下按钮调整合并顺序。</p></section><section data-split hidden><label>每份页数<input data-every type="number" min="1" value="1"></label><label>或指定分组（分号分隔）<input data-ranges placeholder="1-3;4-6;7,9"></label></section><label class="check"><input data-bookmarks type="checkbox" checked>保留并重新定位书签</label><p data-status role="status"></p><footer><button data-run>另存结果…</button></footer>';
    document.body.append(dialog);dialog.showModal();
    const q=s=>dialog.querySelector(s),files=[{current:true,name:S.name}];
    const paint=()=>{q('[data-files]').replaceChildren(...files.map((f,i)=>{const li=document.createElement('li');const label=document.createElement('span');label.textContent=f.name;li.append(label);for(const [text,delta] of [['↑',-1],['↓',1],['移除',0]]){const b=document.createElement('button');b.textContent=text;b.disabled=delta?i+delta<0||i+delta>=files.length:files.length===1;b.onclick=()=>{if(delta)[files[i],files[i+delta]]=[files[i+delta],files[i]];else files.splice(i,1);paint();};li.append(b);}return li;}));};paint();
    let busy=false;const close=()=>{if(busy)return;dialog.close();dialog.remove();};q('[data-close]').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
    q('[data-mode]').onchange=()=>{q('[data-merge]').hidden=q('[data-mode]').value!=='merge';q('[data-split]').hidden=q('[data-mode]').value!=='split';};
    q('[data-add]').onclick=async()=>{try{session.assert(capture);const file=await window.desktop.open('pdf');session.assert(capture);if(file){files.push({name:file.name,data:encode(new Uint8Array(file.bytes))});paint();}}catch(e){q('[data-status]').textContent=e.message;}};
    q('[data-run]').onclick=async()=>{if(busy)return;busy=true;const inputs=[...dialog.querySelectorAll('input,button,select')];inputs.forEach(el=>el.disabled=true);try{session.assert(capture);q('[data-status]').textContent='正在处理…';const ranges=q('[data-ranges]').value.trim();const result=await run({action:q('[data-mode]').value,every:Number(q('[data-every]').value),ranges:ranges?ranges.split(';').map(s=>s.trim()).filter(Boolean):undefined,parts:files.map(({name,...p})=>p),bookmarks:q('[data-bookmarks]').checked});q('[data-status]').textContent=result.cancelled?'已取消后续保存':result.saved?'已保存结果':'已取消保存';}catch(e){q('[data-status]').textContent=e.message;}finally{busy=false;inputs.forEach(el=>el.disabled=false);paint();}};
  };
  return run;
}

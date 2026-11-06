import {icon} from './icons.mjs';
export function installOfficeImport({writeFile}){
  const run=async()=>{
    const input=await window.desktop.open('office');if(!input)return {cancelled:true};
    const extension=input.name.split('.').pop().toLowerCase();
    const r=await window.desktop.native({command:'document-utilities',action:'import-office',bytes:input.bytes,options:{extension}});
    const bytes=Uint8Array.from(atob(r.bytes),c=>c.charCodeAt(0));
    const saved=await writeFile(input.name.replace(/\.[^.]+$/,'')+'.pdf',bytes,'pdf');
    return {saved:!!saved,pages:r.pages,engine:r.engine};
  };
  const b=document.createElement('button');b.id='office-import';b.innerHTML=icon('file')+'文件转 PDF';
  document.querySelector('.more-tools-menu').append(b);
  b.onclick=()=>{
    b.closest('details').open=false;
    const d=document.createElement('dialog');d.className='assembly-dialog';d.setAttribute('aria-label','文件转 PDF');
    d.innerHTML='<header><h2>文件转 PDF</h2><button data-close aria-label="关闭">'+icon('close')+'</button></header><p>将 Word、Excel、PowerPoint、OpenDocument、Markdown 和文本转换为 PDF。</p><p class="hint">本地处理。复杂 Office 文件的字体与分页可能受原始排版影响。</p><p role="status" data-status></p><footer><button class="primary" data-run>选择文件并转换…</button></footer>';
    document.body.append(d);d.showModal();let busy=false;
    const close=()=>{if(!busy){d.close();d.remove();b.focus();}};d.querySelector('[data-close]').onclick=close;d.oncancel=e=>{e.preventDefault();close();};
    d.querySelector('[data-run]').onclick=async()=>{if(busy)return;busy=true;d.querySelector('[data-run]').disabled=true;const status=d.querySelector('[data-status]');status.textContent='正在转换…';try{const r=await run();status.textContent=r.saved?`已保存 PDF · ${r.pages} 页`:'已取消';}catch(e){status.textContent=e.message;}finally{busy=false;d.querySelector('[data-run]').disabled=false;}};
  };
  return run;
}

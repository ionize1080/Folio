// UI-only progress, never appended to the model context or saved as reasoning.
(() => {
  const states = new Map(); let active;
  const box = document.createElement('div'); box.id='folio-progress';
  box.setAttribute('role','status'); box.setAttribute('aria-live','polite');box.hidden=true;
  box.style.cssText='font-size:12px;line-height:18px;padding:3px 6px;color:var(--mantine-color-text);border-inline-start:2px solid var(--mantine-color-blue-6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  function attach() {
    const slot=document.getElementById('folio-progress-slot');
    if(slot && box.parentElement!==slot) slot.append(box);
  }
  new MutationObserver(attach).observe(document.body,{childList:true,subtree:true});
  attach();
  const labels={'document.describe':'读取文档信息','bookmark.read':'读取书签','bookmark.calibrate':'校准书签目标','bookmark.whitespace':'调整书签留白','bookmark.batch':'批量修改书签','bookmark.generate':'匹配本地标题','bookmark.replace':'写入书签','ocr.local':'本地文字识别','ocr.apply':'写入识别结果','page.text':'提取页面文字','page.image':'读取待复核图像','page.objects':'检查页面对象','page.edit':'应用页面修改','document.snapshot':'准备文档副本','document.toc':'本地识别目录'};
  function render(){const s=states.get(active);box.hidden=!s;if(s)box.textContent=s.text+' · '+Math.floor((Date.now()-s.started)/1000)+' 秒'}
  window.folioProgress={
    begin(id){active=id;states.set(id,{started:Date.now(),text:'已收到请求，正在准备工具'});render()},
    phase(id,text){const s=states.get(id);if(s){s.text=text;render()}},
    chunk(id,c){if(c.type==='reasoning-delta')this.phase(id,'模型正在分析');else if(c.type==='text-delta')this.phase(id,'正在生成回复');else if(c.type==='tool-call'){const a=c.input||c.args||{};this.phase(id,'正在'+(labels[a.operation]||labels[c.toolName?.replace(/^mcp__folio_pdf__folio_/,'bookmark.')]||'执行文档工具'))}else if(c.type==='tool-result')this.phase(id,'工具已返回，正在核对结果')},
    end(id){states.delete(id);if(active===id)active=[...states.keys()].at(-1);render()}
  };
  window.folioControls?.subscribe(s=>{if(s.progress && active)window.folioProgress.phase(active,s.progress)});
  setInterval(()=>{if(active)render()},1000);
})();

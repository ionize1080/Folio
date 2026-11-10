import {icon} from './icons.mjs';
import {blankPagePlan, paperSizes, unitScale} from './blank-pages.mjs';

export function chooseBlankPages({pageCount, currentPage, position = 'after', getSize}) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'blank-pages-dialog';
    d.setAttribute('aria-label', '插入空白页');
    d.innerHTML = `<header><h2>${icon('new-page')}插入空白页</h2><button data-close aria-label="关闭">${icon('close')}</button></header>
      <form method="dialog"><fieldset><legend>页面</legend>
      <div class="form-grid"><label>尺寸来源<select data-mode><option value="position">与插入位置页面相同</option><option value="page">与指定页面相同</option><option value="standard">标准纸张</option><option value="custom">自定义尺寸</option></select></label>
      <label>单位<select data-unit><option value="mm">mm</option><option value="pt">pt</option><option value="in">in</option></select></label>
      <label data-reference-field hidden>参考页码<input data-reference type="number" min="1" max="${pageCount}" value="${currentPage}"></label>
      <label data-paper-field hidden>纸张<select data-paper>${Object.keys(paperSizes).map(s => `<option${s === 'A4' ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>宽度<input data-width type="number" min="0.01" step="any" value="210"></label><label>高度<input data-height type="number" min="0.01" step="any" value="297"></label>
      <label>方向<select data-orientation><option value="keep">保留</option><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
      <label>数量<input data-count type="number" min="1" max="1000" value="1"></label></div></fieldset>
      <fieldset><legend>插入位置</legend><div class="form-grid"><label>目标页面<select data-target><option value="current">当前页</option><option value="first">第一页</option><option value="last">最后一页</option><option value="custom">指定页码</option></select></label>
      <label>位置<select data-position><option value="after">之后</option><option value="before">之前</option></select></label>
      <label data-target-page-field hidden>页码<input data-page type="number" min="1" max="${pageCount}" value="${currentPage}"></label></div></fieldset>
      <div class="blank-page-preview"><i data-paper-preview aria-hidden="true"></i><output data-summary aria-live="polite"></output></div>
      <p data-status role="status"></p><footer><button type="button" data-cancel>取消</button><button class="primary" type="submit" data-insert>插入空白页</button></footer></form>`;
    document.body.append(d); d.showModal();
    const q = s => d.querySelector(s);
    q('[data-position]').value = position;
    let epoch = 0, closed = false, lastUnit = 'mm', plan = null;
    const finish = value => {if(closed)return; closed=true; ++epoch; d.close(); d.remove(); resolve(value);};
    q('[data-close]').type = 'button';
    q('[data-close]').onclick = q('[data-cancel]').onclick = () => finish(null);
    d.oncancel = e => {e.preventDefault();finish(null);};
    const options = () => ({mode:q('[data-mode]').value, paper:q('[data-paper]').value, unit:q('[data-unit]').value,
      width:q('[data-width]').value, height:q('[data-height]').value, count:q('[data-count]').value,
      orientation:q('[data-orientation]').value, position:q('[data-position]').value,
      page:({first:1,last:pageCount,current:currentPage})[q('[data-target]').value] ?? Number(q('[data-page]').value)});
    async function update() {
      const token = ++epoch; plan = null; q('[data-insert]').disabled = true;
      const a = options(), custom = a.mode === 'custom';
      q('[data-reference-field]').hidden = a.mode !== 'page';
      q('[data-reference]').disabled = a.mode !== 'page';
      q('[data-paper-field]').hidden = a.mode !== 'standard';
      q('[data-target-page-field]').hidden = q('[data-target]').value !== 'custom';
      q('[data-page]').disabled = q('[data-target]').value !== 'custom';
      q('[data-width]').disabled = q('[data-height]').disabled = !custom;
      try {
        let reference;
        if(['position','page'].includes(a.mode)) {
          const n = a.mode === 'page' ? Number(q('[data-reference]').value) : a.page;
          if(!Number.isInteger(n) || n < 1 || n > pageCount) throw Error('参考页码超出范围');
          reference = await getSize(n);
        }
        const result = blankPagePlan(a, pageCount, reference);
        if(closed || token !== epoch)return;
        plan = result;
        if(!custom) {
          q('[data-width]').value = +(result.width / unitScale[a.unit]).toFixed(2);
          q('[data-height]').value = +(result.height / unitScale[a.unit]).toFixed(2);
        }
        const paper=q('[data-paper-preview]');
        paper.style.width = `${Math.min(64,64 * result.width/result.height)}px`;
        paper.style.height = `${Math.min(64,64 * result.height/result.width)}px`;
        q('[data-summary]').textContent = `${(result.width/unitScale[a.unit]).toFixed(2)} × ${(result.height/unitScale[a.unit]).toFixed(2)} ${a.unit} · ${result.count}`;
        q('[data-status]').textContent = ''; q('[data-insert]').disabled = false;
      } catch(e) {if(!closed && token === epoch)q('[data-status]').textContent=e.message;}
    }
    q('[data-unit]').addEventListener('change', () => {
      const unit=q('[data-unit]').value;
      if(q('[data-mode]').value === 'custom') for(const name of ['width','height'])q(`[data-${name}]`).value = +(Number(q(`[data-${name}]`).value)*unitScale[lastUnit]/unitScale[unit]).toFixed(4);
      lastUnit=unit;
    });
    d.addEventListener('input', update); d.addEventListener('change', update);
    d.querySelector('form').onsubmit = e => {e.preventDefault();if(plan)finish(plan);};
    update();
  });
}

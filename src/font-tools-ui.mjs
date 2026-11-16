import {nativeRequest} from './native-source.mjs';
import {icon} from './icons.mjs';
const SAMPLES=[['中英混排','文字示例 Aa 123'],['English','The quick brown fox jumps over the lazy dog 0123456789'],['标点符号','“引号”、（括号）《书名》—— … ¥€$ ±×÷ ①②③'],['常用汉字','永和九年，岁在癸丑，暮春之初，会于会稽山阴之兰亭。']];
export function installFontTools(){
 const button=document.createElement('button');button.id='font-tools';button.innerHTML=icon('text-lines')+'字体工作台';document.querySelector('.more-tools-menu').append(button);
 button.onclick=()=>{
  button.closest('details').open=false;
  const d=document.createElement('dialog');d.className='document-tools font-tools-dialog';d.setAttribute('aria-label','字体工作台');
  d.innerHTML='<header><div><h2>字体工作台</h2><p>查找字体，检查字符覆盖与字形</p></div><button data-close aria-label="关闭">'+icon('close')+'</button></header>'
   +'<div class="document-tools-body"><nav><label>查找字体<input type="search" data-query placeholder="名称或字体家族" autocomplete="off"></label><p data-count class="ft-count" role="status" aria-live="polite"></p><div data-fonts class="ft-list" role="listbox" tabindex="0" aria-label="字体列表"></div><button data-more hidden>加载更多</button></nav>'
   +'<section class="document-tool-detail"><div class="ft-title"><h3 data-name>选择字体</h3><span data-badge class="ft-badge" hidden></span></div>'
   +'<div class="ft-presets" role="group" aria-label="样本文字预设">'+SAMPLES.map(([n],i)=>`<button type="button" data-preset="${i}">${n}</button>`).join('')+'</div>'
   +'<label>样本文字<textarea data-sample rows="2" maxlength="400"></textarea></label>'
   +'<label class="ft-size">预览字号<input type="range" data-size min="12" max="72" value="28"><output data-size-out>28 pt</output></label>'
   +'<p data-status role="status" aria-live="polite"></p><div class="ft-stage"><img data-image alt="字体样本预览" hidden><p data-empty class="ft-empty">从左侧选择一款字体，立即预览并检查字符覆盖。</p></div><dl data-info></dl></section></div>'
   +'<footer><span>字体更改通过编辑器应用；AI 可使用相同字体能力</span><button data-close>完成</button></footer>';
  document.body.append(d);d.showModal();let closed=false,serial=0,pserial=0,key=null,offset=0,total=0,selected='',first=true;
  const q=s=>d.querySelector(s),fontList=q('[data-fonts]'),close=()=>{closed=true;d.close();d.remove();button.focus();};d.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);d.oncancel=e=>{e.preventDefault();close();};
  const request=(action,options)=>nativeRequest({command:'font-tools',action,options});
  q('[data-sample]').value=SAMPLES[0][1];
  const rows=()=>[...fontList.querySelectorAll('[role=option]')];
  const mark=id=>{for(const r of rows()){const on=r.dataset.id===id;r.setAttribute('aria-selected',on);if(on)r.scrollIntoView({block:'nearest'});}};
  const addRows=fonts=>{const frag=document.createDocumentFragment();for(const f of fonts){const r=document.createElement('div');r.setAttribute('role','option');r.dataset.id=f.id;r.setAttribute('aria-selected','false');const a=document.createElement('b'),b=document.createElement('small');a.textContent=f.family||f.name;a.style.fontFamily=`"${f.family||f.name}",system-ui`;b.textContent=f.style||'';r.append(a,b);frag.append(r);}fontList.append(frag);};
  const list=async(reset=true)=>{
   const current=++serial;if(reset){offset=0;fontList.replaceChildren();}q('[data-count]').textContent='正在查找…';
   try{const r=await request('catalog',{query:q('[data-query]').value,offset,limit:100});if(closed||current!==serial)return;
    addRows(r.fonts);offset+=r.fonts.length;total=r.total;q('[data-more]').hidden=offset>=total;q('[data-count]').textContent=total?`${total} 款字体`:'没有匹配的字体';if(selected)mark(selected);
    if(first&&r.fonts.length){first=false;choose(r.fonts[0].id);}
   }catch(e){if(!closed)q('[data-count]').textContent=e.message;}
  };
  const choose=async id=>{selected=id;key=null;mark(id);q('[data-status]').textContent='正在读取字体…';
   try{const r=await request('select',{fontId:id});if(closed||selected!==id)return;key=r.fontKey;q('[data-name]').textContent=r.fontName;preview();}catch(e){if(!closed)q('[data-status]').textContent=e.message;}};
  const preview=async()=>{
   if(!key)return;const captured=key,run=++pserial,text=q('[data-sample]').value||' ',size=+q('[data-size]').value;
   q('[data-status]').textContent='正在检查字符与字形…';
   try{const [pv,coverage,info]=await Promise.all([request('preview',{fontKey:key,text,size}),request('coverage',{fontKey:key,text}),request('inspect',{fontKey:key})]);if(closed||captured!==key||run!==pserial)return;
    q('[data-image]').src='data:image/png;base64,'+pv.image;q('[data-image]').hidden=false;q('[data-empty]').hidden=true;
    q('[data-status]').textContent=coverage.complete?'样本文字全部覆盖':'缺少字符：'+coverage.missing.join('');q('[data-status]').dataset.state=coverage.complete?'ok':'warn';
    const restricted=!!(info.embeddingFlags&2),badge=q('[data-badge]');badge.hidden=false;badge.textContent=restricted?'受限嵌入':'可嵌入';badge.dataset.state=restricted?'warn':'ok';
    const dl=q('[data-info]');dl.replaceChildren();
    const feats=[...new Set(Object.values(info.features||{}).flat())];
    for(const [label,value] of [['字体家族',info.family],['字体样式',info.style],['PostScript 名称',info.postScriptName],['字形数',info.glyphs],['Unicode 字符',info.unicodeCharacters],['字体表',info.tables.map(t=>t.tag).join(', ')],['OpenType 特性',feats.join(', ')||'无'],['可变轴',info.axes.map(a=>`${a.tag} ${a.min}–${a.max}`).join(', ')||'无']]){if(value===undefined||value==='')continue;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);dl.append(dt,dd);}
   }catch(e){if(!closed)q('[data-status]').textContent=e.message;}
  };
  fontList.onclick=e=>{const r=e.target.closest('[role=option]');if(r)choose(r.dataset.id);};
  fontList.onkeydown=e=>{const all=rows();if(!all.length)return;let i=all.findIndex(r=>r.getAttribute('aria-selected')==='true');
   if(e.key==='ArrowDown')i=Math.min(all.length-1,i+1);else if(e.key==='ArrowUp')i=Math.max(0,i-1);else if(e.key==='Home')i=0;else if(e.key==='End')i=all.length-1;else return;
   e.preventDefault();choose(all[i].dataset.id);};
  let timer;q('[data-query]').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!closed)list();},250);};
  q('[data-query]').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();fontList.focus();}};
  q('[data-more]').onclick=()=>list(false);
  let ptimer;const later=()=>{clearTimeout(ptimer);ptimer=setTimeout(()=>{if(!closed)preview();},300);};
  q('[data-sample]').oninput=later;
  q('[data-size]').oninput=()=>{q('[data-size-out]').textContent=q('[data-size]').value+' pt';later();};
  d.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{q('[data-sample]').value=SAMPLES[+b.dataset.preset][1];preview();});
  list();
 };
}

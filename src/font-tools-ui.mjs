import {nativeRequest} from './native-source.mjs';
import {icon} from './icons.mjs';
export function installFontTools(){
 const button=document.createElement('button');button.id='font-tools';button.innerHTML=icon('text-lines')+'字体工作台';document.querySelector('.more-tools-menu').append(button);
 button.onclick=()=>{
  button.closest('details').open=false;
  const d=document.createElement('dialog');d.className='document-tools font-tools-dialog';d.setAttribute('aria-label','字体工作台');
  d.innerHTML='<header><div><h2>字体工作台</h2><p>查找字体，检查字符覆盖与字形</p></div><button data-close aria-label="关闭">'+icon('close')+'</button></header><div class="document-tools-body"><nav><label>查找字体<input type="search" data-query placeholder="名称或字体家族"></label><select data-fonts size="14" aria-label="字体列表"></select><button data-more hidden>加载更多</button></nav><section class="document-tool-detail"><h3 data-name>选择字体</h3><label>样本文字<textarea data-sample rows="3">文字示例 Aa 123</textarea></label><button data-preview>预览与检查</button><p data-status role="status" aria-live="polite"></p><img data-image alt="字体样本预览" hidden><dl data-info></dl></section></div><footer><span>字体更改通过编辑器应用；AI 可使用相同字体能力</span><button data-close>完成</button></footer>';
  document.body.append(d);d.showModal();let closed=false,serial=0,key=null,offset=0,total=0,selected='';
  const q=s=>d.querySelector(s),close=()=>{closed=true;d.close();d.remove();button.focus();};d.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);d.oncancel=e=>{e.preventDefault();close();};
  const request=(action,options)=>nativeRequest({command:'font-tools',action,options});
  const list=async(reset=true)=>{
   const current=++serial;if(reset){offset=0;q('[data-fonts]').replaceChildren();}q('[data-status]').textContent='正在查找…';
   try{const r=await request('catalog',{query:q('[data-query]').value,offset,limit:100});if(closed||current!==serial)return;
    for(const f of r.fonts)q('[data-fonts]').add(new Option(f.name+' · '+f.style,f.id));offset+=r.fonts.length;total=r.total;q('[data-more]').hidden=offset>=total;q('[data-status]').textContent=`${total} 款字体`;
   }catch(e){if(!closed)q('[data-status]').textContent=e.message;}
  };
  let timer;q('[data-query]').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!closed)list();},250);};q('[data-more]').onclick=()=>list(false);
  q('[data-fonts]').onchange=async()=>{const id=q('[data-fonts]').value;selected=id;key=null;try{const r=await request('select',{fontId:id});if(closed||selected!==id)return;key=r.fontKey;q('[data-name]').textContent=r.fontName;q('[data-preview]').click();}catch(e){if(!closed)q('[data-status]').textContent=e.message;}};
  q('[data-preview]').onclick=async()=>{
   if(!key){q('[data-status]').textContent='请先选择字体';return;}const captured=key,text=q('[data-sample]').value;
   q('[data-status]').textContent='正在检查字符与字形…';
   try{const [preview,coverage,info]=await Promise.all([request('preview',{fontKey:key,text}),request('coverage',{fontKey:key,text}),request('inspect',{fontKey:key})]);if(closed||captured!==key)return;
    q('[data-image]').src='data:image/png;base64,'+preview.image;q('[data-image]').hidden=false;q('[data-status]').textContent=coverage.complete?'样本文字全部覆盖':'缺少字符：'+coverage.missing.join('');q('[data-info]').replaceChildren();
    for(const [label,value] of [['字体家族',info.family],['字形数',info.glyphs],['Unicode 字符',info.unicodeCharacters],['字体表',info.tables.map(t=>t.tag).join(', ')],['可变轴',info.axes.map(a=>`${a.tag} ${a.min}–${a.max}`).join(', ')||'无']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);q('[data-info]').append(dt,dd);}
   }catch(e){if(!closed)q('[data-status]').textContent=e.message;}
  };list();
 };
}

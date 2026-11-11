const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Release notes are untrusted. Render a bounded Markdown subset, never raw HTML,
// remote images, executable URLs, or arbitrary attributes.
export function renderMarkdown(text=''){
  const inline=s=>escape(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,label,url)=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  let html='',list=false,code=false;
  for(const line of String(text).slice(0,64000).replace(/<!--[^]*?-->/g,'').split(/\r?\n/)){
    if(line.startsWith('```')){if(list){html+='</ul>';list=false;}html+=code?'</code></pre>':'<pre><code>';code=!code;continue;}
    if(code){html+=escape(line)+'\n';continue;}
    if(/^\s*[-*]\s+/.test(line)){if(!list){html+='<ul>';list=true;}html+='<li>'+inline(line.replace(/^\s*[-*]\s+/,''))+'</li>';continue;}
    if(list){html+='</ul>';list=false;}
    const heading=/^(#{1,4})\s+(.+)$/.exec(line);
    if(heading){const n=heading[1].length+1;html+=`<h${n}>${inline(heading[2])}</h${n}>`;}
    else if(line.trim())html+='<p>'+inline(line)+'</p>';
  }
  return html+(list?'</ul>':'')+(code?'</code></pre>':'');
}

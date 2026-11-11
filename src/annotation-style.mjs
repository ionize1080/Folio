export const annotationPalette=['#F2C94C','#8BC9AC','#7DB8DA','#BCA4DB','#EA9AA2','#EAA578','#5267DB','#344054'];
export const annotationTypes={highlight:'Highlight',underline:'Underline',squiggly:'Squiggly',strikeout:'StrikeOut',rectangle:'Square',ink:'Ink',marker:'Ink',note:'Text'};
export function annotationStyle(a){
  if(!annotationTypes[a.type])throw Error('批注类型无效');
  const color=a.color||'#F2C94C',opacity=a.opacity??(['highlight','marker'].includes(a.type)?.35:1),width=a.width??(a.type==='marker'?12:1.5);
  if(!/^#[\da-f]{6}$/i.test(color)||!Number.isFinite(opacity)||opacity<.05||opacity>1||!Number.isFinite(width)||width<.25||width>72)throw Error('批注颜色、透明度或线宽无效');
  if(a.paths&&(!Array.isArray(a.paths)||a.paths.length>1000||a.paths.some(p=>!Array.isArray(p)||p.length<4||p.length>40000||p.length%2||p.some(v=>!Number.isFinite(v)))))throw Error('手绘路径无效');
  if(['ink','marker'].includes(a.type)&&!a.paths?.length)throw Error('手绘批注需要有效路径');
  return {color,opacity,width,dash:a.dash==='dashed'?'[5 3] 0 d':a.dash==='dotted'?'[1 3] 0 d':'[] 0 d'};
}
export function appearanceCommands(a,style,rgb){
  const [x,y,right,top]=a.rect,w=right-x,h=top-y,c=rgb.join(' '),{width,dash}=style;
  const commands=[`q /GS gs ${c} RG ${c} rg ${width} w 1 J 1 j ${dash}`];
  if(a.type==='highlight')commands.push(`${x} ${y} ${w} ${h} re f`);
  else if(a.type==='rectangle')commands.push(`${x+width/2} ${y+width/2} ${Math.max(0,w-width)} ${Math.max(0,h-width)} re S`);
  else if(a.paths)for(const p of a.paths){commands.push(`${p[0]} ${p[1]} m`);for(let i=2;i<p.length;i+=2)commands.push(`${p[i]} ${p[i+1]} l`);commands.push('S');}
  else if(a.type==='squiggly') {const step=Math.max(2,width*2);commands.push(`${x} ${y+step} m`);for(let i=1;i<=Math.ceil(w/step);i++)commands.push(`${Math.min(right,x+i*step)} ${y+(i%2?0:step)} l`);commands.push('S');}
  else{const line=a.type==='strikeout'?(y+top)/2:y+width;commands.push(`${x} ${line} m ${right} ${line} l S`);}
  return commands.join('\n')+'\nQ';
}

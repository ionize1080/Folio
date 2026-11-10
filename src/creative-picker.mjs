import {t} from './i18n.mjs';

export function objectLabel(item,page,ordinal=1){
  if(item.name)return item.name;
  const label=['photo','image'].includes(item.kind)?t('图片'):item.kind==='path'?t('原有路径'):t('矢量图');
  const dimensions=item.width&&item.height?[item.width,item.height]:item.box?.slice(2);
  return `${label} ${ordinal} · ${t('第 {0} 页',{0:page})}${dimensions?` · ${dimensions.map(n=>Math.round(n)).join(' × ')}`:''}`;
}

export function artworkOption(label,value,thumbnail){
  const option=new Option(label,value);
  if(thumbnail){const img=document.createElement('img');img.src=thumbnail;img.alt='';img.width=48;img.height=34;option.prepend(img);}
  return option;
}

// One page render supplies every preview. This avoids extracting/decoding every
// PDF image (and waiting for native workers) before the chooser can be used.
const thumbnails=new WeakMap();
export async function objectThumbnails(pdf,pageNumber,items,{cancelled=()=>false,revision=''}={}){
  let cache=thumbnails.get(pdf);if(!cache){cache=new Map();thumbnails.set(pdf,cache);}
  const key=`${pageNumber}:${revision}`,saved=cache.get(key);
  if(saved){for(const item of items)if(saved.has(item.key))item.thumbnail=saved.get(item.key);if(items.every(item=>saved.has(item.key)))return;}
  const page=await pdf.getPage(pageNumber);if(cancelled())return;
  const natural=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(1.5,1200/Math.max(natural.width,natural.height))});
  const surface=document.createElement('canvas');surface.width=Math.ceil(viewport.width);surface.height=Math.ceil(viewport.height);
  const render=page.render({canvasContext:surface.getContext('2d',{alpha:false}),viewport});
  const complete=new Map(saved);
  try{
  await render.promise;
  if(cancelled())return;
  for(const [index,item] of items.entries()){
    if(complete.has(item.key))continue;
    if(index&&index%32===0){await new Promise(resolve=>requestAnimationFrame(resolve));if(cancelled())return;}
    const box=item.bounds||(item.box&&[item.box[0],item.box[1],item.box[0]+item.box[2],item.box[1]+item.box[3]]);
    if(!box||box.length!==4||!box.every(Number.isFinite)){complete.set(item.key,'');continue;}
    const rect=viewport.convertToViewportRectangle(box),x=Math.max(0,Math.min(rect[0],rect[2])),y=Math.max(0,Math.min(rect[1],rect[3]));
    const width=Math.min(surface.width-x,Math.abs(rect[2]-rect[0])),height=Math.min(surface.height-y,Math.abs(rect[3]-rect[1]));
    if(width<=0||height<=0){complete.set(item.key,'');continue;}
    const thumb=document.createElement('canvas');thumb.width=96;thumb.height=68;
    const context=thumb.getContext('2d'),scale=Math.min(96/width,68/height),w=width*scale,h=height*scale;
    context.drawImage(surface,x,y,width,height,(96-w)/2,(68-h)/2,w,h);item.thumbnail=thumb.toDataURL('image/png');complete.set(item.key,item.thumbnail);
  }
  cache.set(key,complete);while(cache.size>3)cache.delete(cache.keys().next().value);
  }finally{surface.width=surface.height=0;}
}

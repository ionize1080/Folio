// PDF writers may emit one text item per glyph. Paint continuous line bands
// without changing DOM ranges, text order, or the bytes copied to the clipboard.
export function mergeSelectionRects(rectangles) {
  const result=[];
  for(const axis of ['horizontal','vertical','other']){
    const source=rectangles.filter(r=>(r.axis||'horizontal')===axis&&r.width>0&&r.height>0);
    if(axis==='other'){result.push(...source);continue;}
    const vertical=axis==='vertical', bands=[];
    const values=source.map(r=>({start:vertical?r.y:r.x,end:vertical?r.y+r.height:r.x+r.width,
      low:vertical?r.x:r.y,high:vertical?r.x+r.width:r.y+r.height}));
    values.sort((a,b)=>(a.low+a.high)-(b.low+b.high)||a.start-b.start);
    for(const r of values){
      const band=bands.at(-1),size=r.high-r.low;
      if(band&&Math.min(band.high,r.high)-Math.max(band.low,r.low)>=Math.min(band.high-band.low,size)*.55&&
         Math.abs((band.low+band.high-r.low-r.high)/2)<=Math.max(band.high-band.low,size)*.45){
        band.items.push(r);
      }else bands.push({low:r.low,high:r.high,items:[r]});
    }
    for(const band of bands){
      band.items.sort((a,b)=>a.start-b.start);let current;const intervals=[];
      for(const r of band.items){
        const gap=Math.max(1,Math.min(r.high-r.low,current?current.high-current.low:r.high-r.low)*.6);
        if(current&&r.start<=current.end+gap){current.end=Math.max(current.end,r.end);current.low=Math.min(current.low,r.low);current.high=Math.max(current.high,r.high);}
        else{current={...r};intervals.push(current);}
      }
      // Convert only this band's newly created intervals to page rectangles.
      for(const r of intervals){
        result.push(vertical?{x:r.low,y:r.start,width:r.high-r.low,height:r.end-r.start,axis}:{x:r.start,y:r.low,width:r.end-r.start,height:r.high-r.low,axis});
      }
    }
  }
  return result;
}

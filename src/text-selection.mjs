import {mergeSelectionRects} from './selection-geometry.mjs';
// Keep native DOM ranges for copy/accessibility, but resolve pointer positions at
// actual glyphs and paint each selection once. Browser painting of overlapping
// transformed PDF spans otherwise produces dark stripes and left-margin bars.
export function installTextSelection(surface){
  const host=surface.host;let anchor=null,dragging=false,frame=0,lastEvent,measurements=new WeakMap();
  const spans=(root=host)=>[...root.querySelectorAll(root===host?'.pdf-page:not(.page-fallback) .textLayer span':'.textLayer span')].filter(el=>el.firstChild?.nodeType===3&&el.textContent.trim());
  const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
  const overlays=new Set();
  // Only the page under the pointer can hold the nearest glyph; measuring every span on
  // every rendered page made dragging cost grow with the number of visible pages.
  const pageAt=(x,y)=>{const el=document.elementFromPoint(x,y)?.closest('.pdf-page:not(.page-fallback)');if(el&&host.contains(el))return el;
    let nearest=null,cost=Infinity;for(const page of host.querySelectorAll('.pdf-page:not(.page-fallback)')){const d=distance(page.getBoundingClientRect(),x,y);if(d<cost){nearest=page;cost=d;}}return nearest;};
  const distance=(r,x,y)=>Math.max(r.left-x,0,x-r.right)**2+Math.max(r.top-y,0,y-r.bottom)**2;
  function caret(x,y,strict=false){
    const page=pageAt(x,y);if(!page)return null;const box=page.getBoundingClientRect(),layer=page.querySelector('.textLayer');
    let cached=measurements.get(page);
    // Cache only for this pointer gesture. Page-relative geometry survives scrolling;
    // zooming or replacement of the text layer invalidates it immediately.
    if(!cached||cached.layer!==layer||cached.width!==box.width||cached.height!==box.height){
      const local=r=>({left:r.left-box.left,right:r.right-box.left,top:r.top-box.top,bottom:r.bottom-box.top});
      cached={layer,width:box.width,height:box.height,items:spans(page).map(el=>({el,rect:local(el.getBoundingClientRect())})),glyphs:new WeakMap()};measurements.set(page,cached);
    }
    x-=box.left;y-=box.top;let best=null,cost=Infinity;
    for(const item of cached.items){const d=distance(item.rect,x,y);if(d<cost){best=item.el;cost=d;}}
    if(!best||strict&&cost>144)return null;
    const node=best.firstChild,text=node.data;let glyphs=cached.glyphs.get(best),answer=null,score=Infinity;
    if(!glyphs||glyphs.text!==text){const range=document.createRange(),pieces=segmenter?[...segmenter.segment(text)].map(s=>[s.index,s.index+s.segment.length]):Array.from(text).reduce((a,c)=>{const start=a.at(-1)?.[1]||0;a.push([start,start+c.length]);return a;},[]);
      glyphs={text,rtl:getComputedStyle(best).direction==='rtl',items:pieces.map(([start,end])=>{range.setStart(node,start);range.setEnd(node,end);const r=range.getBoundingClientRect();return {start,end,left:r.left-box.left,right:r.right-box.left,top:r.top-box.top,bottom:r.bottom-box.top};})};cached.glyphs.set(best,glyphs);
    }
    for(const r of glyphs.items){if(r.left===r.right&&r.top===r.bottom)continue;const d=distance(r,x,y);if(d<score){const after=(x>(r.left+r.right)/2)!==glyphs.rtl;answer={node,offset:after?r.end:r.start};score=d;}}
    return answer;
  }
  function paint(){frame=0;const sel=getSelection(),empty=!sel?.rangeCount||sel.isCollapsed;
    if(empty&&!overlays.size)return;
    for(const old of overlays)old.remove();overlays.clear();
    if(empty)return;const selected=sel.getRangeAt(0),paths=new Map();
    for(const shell of host.querySelectorAll('.pdf-page:not(.page-fallback)')){
     if(!selected.intersectsNode(shell))continue;const box=shell.getBoundingClientRect(),rectangles=[];
     for(const el of spans(shell)){
      const node=el.firstChild;if(!selected.intersectsNode(node))continue;
      let start=selected.startContainer===node?selected.startOffset:0,end=selected.endContainer===node?selected.endOffset:node.length;
      if(start>=end)continue;
      // Ignore layout-only whitespace at the edges; selection text itself stays
      // unchanged so copying does not silently rewrite the user's content.
      while(start<end&&/\s/u.test(node.data[start]))start++;while(end>start&&/\s/u.test(node.data[end-1]))end--;if(start===end)continue;
      const r=document.createRange();r.setStart(node,start);r.setEnd(node,end);
      const angle=(parseFloat(el.style.getPropertyValue('--rotate'))||0)*Math.PI/180;
      const axis=Math.abs(Math.sin(angle))<.01?'horizontal':Math.abs(Math.cos(angle))<.01?'vertical':'other';
      for(const rect of r.getClientRects()){
        const x=Math.max(0,rect.left-box.left),y=Math.max(0,rect.top-box.top),w=Math.min(box.width,rect.right-box.left)-x,h=Math.min(box.height,rect.bottom-box.top)-y;
        if(w>0&&h>0)rectangles.push({x,y,width:w,height:h,axis});
      }
     }if(rectangles.length)paths.set(shell,rectangles);
    }
    for(const [shell,rectangles] of paths){const d=mergeSelectionRects(rectangles).map(({x,y,width:w,height:h})=>`M${x},${y}h${w}v${h}h${-w}Z`).join('');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('text-selection-overlay');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);svg.append(p);shell.append(svg);overlays.add(svg);}
  }
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(paint);};
  // Overlays are page-relative and scroll with their page. Only a changed selection
  // or a freshly rendered text layer needs repainting (the surface schedules it).
  document.addEventListener('selectionchange',schedule);
  host.addEventListener('pointerdown',e=>{
    if(e.button!==0||surface.hand||surface.space||!e.target.closest('.textLayer'))return;
    measurements=new WeakMap();const point=caret(e.clientX,e.clientY,true);if(!point){getSelection()?.removeAllRanges();return;}
    e.preventDefault();const sel=getSelection();anchor=e.shiftKey&&sel?.anchorNode&&host.contains(sel.anchorNode)?{node:sel.anchorNode,offset:sel.anchorOffset}:point;
    sel.setBaseAndExtent(anchor.node,anchor.offset,point.node,point.offset);dragging=true;host.setPointerCapture(e.pointerId);schedule();
  });
  host.addEventListener('pointermove',e=>{
    if(!dragging||!anchor?.node.isConnected)return;lastEvent=e;
    if(host.dataset.selectionFrame)return;host.dataset.selectionFrame='1';requestAnimationFrame(()=>{
      delete host.dataset.selectionFrame;if(!dragging||!anchor?.node.isConnected)return;
      const p=caret(lastEvent.clientX,lastEvent.clientY);if(p)getSelection().setBaseAndExtent(anchor.node,anchor.offset,p.node,p.offset);
      const box=host.getBoundingClientRect();if(lastEvent.clientY<box.top+20)host.scrollTop-=20;else if(lastEvent.clientY>box.bottom-20)host.scrollTop+=20;schedule();
    });
  });
  const stop=e=>{if(dragging&&e.type==='pointerup'&&anchor?.node.isConnected){const p=caret(e.clientX,e.clientY);if(p)getSelection().setBaseAndExtent(anchor.node,anchor.offset,p.node,p.offset);}dragging=false;measurements=new WeakMap();schedule();};host.addEventListener('pointerup',stop);host.addEventListener('pointercancel',stop);
  host.addEventListener('dblclick',e=>{if(surface.hand||surface.space||!e.target.closest('.textLayer'))return;measurements=new WeakMap();const point=caret(e.clientX,e.clientY,true);if(!point)return;e.preventDefault();const text=point.node.data,segments=[...new Intl.Segmenter(undefined,{granularity:'word'}).segment(text)],word=segments.find(s=>s.index<=point.offset&&s.index+s.segment.length>point.offset);if(word)getSelection().setBaseAndExtent(point.node,word.index,point.node,word.index+word.segment.length);schedule();});
  return {paint,schedule};
}

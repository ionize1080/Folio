// Keep drawing units at the same physical size when the canvas boundary changes.
// The PDF matrix maps a unit square, whereas artwork coordinates have a top-left origin.
export function canvasPlacement(matrix, before, after) {
  const [x,y,w,h]=before,[nx,ny,nw,nh]=after,[a,b,c,d,e,f]=matrix;
  if(![...matrix,...before,...after].every(Number.isFinite)||Math.min(w,h,nw,nh)<=0)throw Error('画布尺寸无效');
  const u=(nx-x)/w,v=1-(ny+nh-y)/h;
  return [a*nw/w,b*nw/w,c*nh/h,d*nh/h,e+a*u+c*v,f+b*u+d*v];
}
export function contentBounds(document,kind) {
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  const pending=[...(document.layers||[])];
  while(pending.length){const item=pending.pop();if(item.visible===false||item.opacity===0)continue;
    if(item.children?.length){pending.push(...item.children);continue;}
    const b=Array.isArray(item.bounds)?item.bounds:item.bounds&&[item.bounds.x,item.bounds.y,item.bounds.width,item.bounds.height];
    if(!b||!b.every(Number.isFinite)||b[2]<=0||b[3]<=0)continue;
    const pad=kind==='vector'?Math.max(0,Number(item.strokeWidth)||0)/2:0;
    left=Math.min(left,b[0]-pad);top=Math.min(top,b[1]-pad);right=Math.max(right,b[0]+b[2]+pad);bottom=Math.max(bottom,b[1]+b[3]+pad);
  }
  return Number.isFinite(left)?[left,top,right-left,bottom-top]:null;
}
export function expandedCanvas(bounds,content,margin=Math.max(16,Math.min(bounds[2],bounds[3])*.08)) {
  if(!content)return null;
  const [x,y,w,h]=bounds,[l,t,cw,ch]=content,r=l+cw,b=t+ch;
  if(l>=x&&t>=y&&r<=x+w&&b<=y+h)return null;
  const nx=l<x?Math.floor(l-margin):x,ny=t<y?Math.floor(t-margin):y;
  return [nx,ny,(r>x+w?Math.ceil(r+margin):x+w)-nx,(b>y+h?Math.ceil(b+margin):y+h)-ny];
}
export function studioTransform(kind,state) {
  const ui=state.ui,v=kind==='photo'?ui.views[ui.session.active]:ui.view;
  const center=Array.isArray(v.center)?v.center:[v.center.x,v.center.y],rect=ui.canvasRect;
  const scale=kind==='photo'?(ui.window.pixelsPerPoint||1):1,zoom=v.zoom/scale;
  const a=(v.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),flip=v.flip?-1:1;
  const cx=rect[0]+rect[2]/2,cy=rect[1]+rect[3]/2;
  return {rect,toScreen:([x,y])=>{const dx=(x-center[0])*zoom,dy=(y-center[1])*zoom;return [cx+(dx*c-dy*s)*flip,cy+dx*s+dy*c];},toDocument:([x,y])=>{const dx=(x-cx)*flip/zoom,dy=(y-cy)/zoom;return [center[0]+dx*c+dy*s,center[1]-dx*s+dy*c];}};
}

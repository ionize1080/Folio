// PDF uses bottom-left coordinates; both editing canvases use top-left coordinates.
// This maps a page reference into artwork space once. The native camera then moves
// the reference and the artwork together, including view rotation and mirroring.
export function referenceQuad(pageBounds,matrix,artBounds){
  const [l,b,r,t]=pageBounds,[a,c0,c,d,e,f]=matrix,[x,y,w,h]=artBounds;
  if(![...pageBounds,...matrix,...artBounds].every(Number.isFinite)||r<=l||t<=b||w<=0||h<=0)throw Error('页面或作品尺寸无效');
  const det=a*d-c0*c;if(Math.abs(det)<1e-10)throw Error('作品放置矩阵无效');
  return [[l,t],[r,t],[r,b],[l,b]].map(([px,py])=>{
    const u=((px-e)*d-(py-f)*c)/det,v=((py-f)*a-(px-e)*c0)/det;
    return [x+u*w,y+(1-v)*h];
  });
}
export function artworkBounds(kind,state){
  const d=state.document;
  if(kind==='photo')return [0,0,d.width,d.height];
  const ab=d.artboards?.[0];if(!ab)throw Error('请先创建画板');return [ab.x,ab.y,ab.width,ab.height];
}

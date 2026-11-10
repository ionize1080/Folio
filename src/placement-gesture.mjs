// Resize in the object's own axes, preserving shear, rotation and handedness.
export function dragPlacement(base, start, end, corner, lock=true) {
  const m=[...base],dx=end[0]-start[0],dy=end[1]-start[1];
  if(corner===null){m[4]+=dx;m[5]+=dy;return m;}
  const [a,b,c,d,e,f]=base,det=a*d-b*c;
  if(Math.abs(det)<1e-9)throw Error('作品尺寸无效');
  const u=(d*(end[0]-e)-c*(end[1]-f))/det,v=(-b*(end[0]-e)+a*(end[1]-f))/det;
  const [hx,hy]=corner,ox=1-hx,oy=1-hy;
  let sx=Math.max(.01,(u-ox)/(hx-ox)),sy=Math.max(.01,(v-oy)/(hy-oy));
  if(lock)sx=sy=Math.abs(sx-1)>Math.abs(sy-1)?sx:sy;
  return [a*sx,b*sx,c*sy,d*sy,e+a*ox*(1-sx)+c*oy*(1-sy),f+b*ox*(1-sx)+d*oy*(1-sy)];
}

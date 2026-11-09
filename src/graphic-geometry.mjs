export function placement(value={}, base=[200,0,0,200,72,72]) {
  const keys=['matrix','x','y','width','height','rotation','flipX','flipY','crop','perspective'];
  for(const k of Object.keys(value))if(!keys.includes(k))throw Error('Unknown geometry field: '+k);
  let matrix=value.matrix ? [...value.matrix] : [...base];
  if(!Array.isArray(matrix)||matrix.length!==6||!matrix.every(Number.isFinite))throw Error('Invalid image matrix');
  if(['width','height','rotation','flipX','flipY'].some(k=>value[k]!==undefined)) {
    const oldWidth=Math.hypot(matrix[0],matrix[1]),oldHeight=Math.hypot(matrix[2],matrix[3]);
    const width=value.width??oldWidth,height=value.height??oldHeight;
    const angle=value.rotation===undefined?0:value.rotation*Math.PI/180-Math.atan2(matrix[1],matrix[0]);
    if(![width,height,angle].every(Number.isFinite)||width<=0||height<=0)throw Error('Invalid size or rotation');
    const sx=width/oldWidth*(value.flipX?-1:1),sy=height/oldHeight*(value.flipY?-1:1),c=Math.cos(angle),s=Math.sin(angle),[a,b,u,v,x,y]=matrix;
    // Resize existing axes; keep shear and handedness unless explicitly changed.
    matrix=[(a*c-b*s)*sx,(a*s+b*c)*sx,(u*c-v*s)*sy,(u*s+v*c)*sy,x,y];
  }
  if(value.x!==undefined)matrix[4]=value.x;
  if(value.y!==undefined)matrix[5]=value.y;
  if(!matrix.every(v=>Number.isFinite(v)&&Math.abs(v)<1e7)||Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])<1e-9)throw Error('Invalid image transform');
  return {matrix,...(value.crop!==undefined?{crop:value.crop}:{}),...(value.perspective!==undefined?{perspective:value.perspective}:{})};
}

export function pathFrame(path) {
  const points=path.segments||[];
  if(!points.length)throw Error('Path has no points');
  const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
  const w=Math.max(1e-3,Math.max(...points.map(p=>p.x))-x),h=Math.max(1e-3,Math.max(...points.map(p=>p.y))-y);
  const [a,b,c,d,e,f]=path.matrix;
  return {x,y,w,h,matrix:[a*w,b*w,c*h,d*h,e+a*x+c*y,f+b*x+d*y]};
}
export function pathPlacement(value,path) {
 const {x,y,w,h,matrix}=pathFrame(path),[a,b,c,d,e,f]=placement(value,matrix).matrix;
 return {matrix:[a/w,b/w,c/h,d/h,e-a*x/w-c*y/h,f-b*x/w-d*y/h]};
}

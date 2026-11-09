// View changes preserve artwork coordinates. Rotation is measured in screen axes.
export function viewPlan({bounds,canvas,center,zoom,rotation=0,maxZoom=640,minZoom=.001},options={}){
  const [x,y,w,h]=bounds,[, ,cw,ch]=canvas;
  if(![x,y,w,h,cw,ch,zoom,...center].every(Number.isFinite)||w<=0||h<=0||cw<=0||ch<=0)throw Error('画布尚未准备好');
  const mode=options.mode||'fit',margin=options.margin??24;
  if(!Number.isFinite(margin)||margin<0)throw Error('视图边距无效');
  const a=rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a),rw=Math.abs(c)*w+Math.abs(s)*h,rh=Math.abs(s)*w+Math.abs(c)*h;
  const zx=Math.max(1,cw-2*margin)/rw,zy=Math.max(1,ch-2*margin)/rh,target=[x+w/2,y+h/2];
  let next=zoom,point=[...center];
  if(['fit','width','height','fill'].includes(mode)){
    next=mode==='width'?zx:mode==='height'?zy:mode==='fill'?Math.max(zx,zy):Math.min(zx,zy);point=target;
  }else if(mode==='actual')next=1;
  else if(mode==='zoom')next=Number(options.percent)/100;
  else if(mode==='in')next=zoom*Math.SQRT2;
  else if(mode==='out')next=zoom/Math.SQRT2;
  else if(mode==='center')point=target;
  else if(mode==='center-x'||mode==='center-y'){
    const dx=target[0]-center[0],dy=target[1]-center[1];
    const px=mode==='center-x'?dx*c-dy*s:0,py=mode==='center-y'?dx*s+dy*c:0;
    point=[center[0]+px*c+py*s,center[1]-px*s+py*c];
  }else throw Error('未知视图操作');
  if(!Number.isFinite(next)||next<=0)throw Error('缩放比例必须大于 0');
  return {zoom:Math.max(minZoom,Math.min(maxZoom,next)),center:point};
}

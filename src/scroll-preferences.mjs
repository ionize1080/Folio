// WheelEvent cannot reliably identify hardware. Line-mode events and the common
// Chromium detent multiples are adjusted; fine pixel deltas retain native motion.
export function scrollDelta(event,lines=3,lineHeight=24){
  lines=Math.max(1,Math.min(30,Number(lines)||3));
  if(event.deltaMode===1)return event.deltaY/3*lines*lineHeight;
  if(event.deltaMode===2)return event.deltaY*lineHeight*lines*10;
  const d=event.deltaY,a=Math.abs(d);
  if(!event.deltaX&&a>=80&&(a%100===0||a%120===0))return Math.sign(d)*(a/(a%120===0?120:100))*lines*lineHeight;
  return d;
}

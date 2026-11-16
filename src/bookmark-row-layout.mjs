export function bookmarkRowLayout(count,height){
  const offsets=new Float64Array(count+1);
  for(let i=0;i<count;i++)offsets[i+1]=offsets[i]+height(i);
  return {total:offsets[count],top:i=>offsets[Math.max(0,Math.min(count,i))],
    height:i=>offsets[i+1]-offsets[i],
    indexAt:y=>{let lo=0,hi=count;while(lo<hi){const mid=(lo+hi)>>>1;if(offsets[mid+1]<=y)lo=mid+1;else hi=mid;}return Math.min(lo,Math.max(0,count-1));}};
}

// Bounded page-space bins. Preserve input order so ambiguous overlap keeps
// the same deterministic owner as the previous exhaustive scan.
export class PageSpatialIndex {
  constructor(items, bounds, size=64) {
    this.size=size;this.items=items;this.bounds=items.map(bounds);this.bins=new Map();this.large=[];
    this.bounds.forEach((b,i)=>{
      const [x0,y0,x1,y1]=this.range(b);
      if ((x1-x0+1)*(y1-y0+1)>256) {this.large.push(i);return;}
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const key=`${x}:${y}`;let bin=this.bins.get(key);
        if(!bin)this.bins.set(key,bin=[]);bin.push(i);
      }
    });
  }
  range(b){return b.map(v=>Math.floor(v/this.size));}
  search(b,t=0){
    const [x0,y0,x1,y1]=this.range(b);let ids;
    if((x1-x0+1)*(y1-y0+1)>256)ids=this.items.keys();
    else{
      const found=new Set(this.large);
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const i of this.bins.get(`${x}:${y}`)||[])found.add(i);
      ids=[...found].sort((a,b)=>a-b);
    }
    return [...ids].filter(i=>{const a=this.bounds[i];return a[2]>b[0]+t&&a[0]<b[2]-t&&a[3]>b[1]+t&&a[1]<b[3]-t;}).map(i=>this.items[i]);
  }
}

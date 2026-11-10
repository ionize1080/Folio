// Runs inside the tested browser renderer. Packaged checks supply PDF bytes and
// a folio:// base, so no application code or decoder is loaded from the checkout.
module.exports=async function checkPdfLoading({specimen,baseURL,filesBase,documents}){
  const pdfjs=await import(new URL('vendor/pdf.mjs',baseURL).href);
  const {pdfLoadingOptions}=await import(new URL('pdf-loading.mjs',baseURL).href);
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('vendor/pdf.worker.mjs',baseURL).href;
  const render=async(kind,scale=1)=>{
    const input=documents
      ? {data:Uint8Array.from(atob(documents[kind]),c=>c.charCodeAt(0))}
      : {url:new URL(specimen.files[kind],filesBase).href};
    const pdf=await pdfjs.getDocument({...pdfLoadingOptions,...input}).promise;
    try{
      const pg=await pdf.getPage(1),v=pg.getViewport({scale}),c=document.createElement('canvas');
      c.width=Math.ceil(v.width);c.height=Math.ceil(v.height);
      await pg.render({canvasContext:c.getContext('2d'),viewport:v}).promise;
      return {image:c.getContext('2d').getImageData(0,0,c.width,c.height),png:c.toDataURL('image/png')};
    }finally{await pdf.destroy();}
  };
  const source=await render('source'),results={};
  for(const kind of ['background','saved']){
    const actual=await render(kind),a=source.image,b=actual.image;
    if(a.width!==b.width||a.height!==b.height)throw Error('Edited page dimensions changed');
    let outside=0,outsideMax=0,photo=0,photoSum=0,photoPixels=0;const outsideSamples=[];
    const [x0,y0,x1,y1]=specimen.ignored,[l,t,r,bottom]=specimen.image;
    for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){
      const i=(y*a.width+x)*4,d=Math.max(...[0,1,2].map(c=>Math.abs(a.data[i+c]-b.data[i+c])));
      if((x<x0||x>x1||y<y0||y>y1)&&d>2){outside++;outsideMax=Math.max(outsideMax,d);if(outsideSamples.length<8)outsideSamples.push({x,y,d});}
      if(x>=l+2&&x<r-2&&y>=t+2&&y<bottom-2){photoPixels++;photoSum+=d;if(d>2)photo++;}
    }
    results[kind]={outsideChangedPixels:outside,outsideMaxError:outsideMax,outsideSamples,imageChangedPixels:photo,imagePixels:photoPixels,imageMeanError:photoSum/Math.max(1,photoPixels),png:actual.png};
  }
  const thumb=await render('background',.4),img=thumb.image,[l,t,r,b]=specimen.image,colors=new Set();
  for(let y=Math.ceil((t+2)*.4);y<(b-2)*.4;y++)for(let x=Math.ceil((l+2)*.4);x<(r-2)*.4;x++){
    const i=(y*img.width+x)*4;colors.add([...img.data.slice(i,i+3)].map(v=>Math.floor(v/24)).join(','));
  }
  results.thumbnailColors=colors.size;results.source=source.png;return results;
};

import {nativeRequest} from "./native-source.mjs";
import {controls} from "./image-color-model.mjs";

const groups = {
  tone: {black:"0..254",white:"1..255",gamma:"0.1..10",outputBlack:"0..255",outputWhite:"0..255",levels:"{r,g,b}: per channel [black,gamma,white,outBlack,outWhite]"},
  curves: {curves:"2..16 increasing [input,output] pairs, 0..255",interpolation:"linear or smooth",channelCurves:"r/g/b point arrays",curveTables:"rgb/r/g/b: 256 output byte values"},
  color: {balance:"shadows/midtones/highlights: RGB offsets -100..100",blackWhite:"boolean",bwMix:"6 weights -200..300",mixer:"3 rows of [red,green,blue,constant], -200..200",monochrome:"boolean",selective:"reds/yellows/greens/cyans/blues/magentas/whites/neutrals/blacks: 4 CMYK offsets -100..100",selectiveAbsolute:"boolean"},
  filters: {preset:"none, scan-color, scan-gray",lookup:"none, warm, cool, cinema, cube",cube:"{size:2..33,data:RGB floats 0..1}",lutAmount:"0..100",photoColor:"RGB bytes",photoLuminosity:"boolean",invert:"boolean",thresholdEnabled:"boolean",gradientEnabled:"boolean",gradient:"2..16 [position,r,g,b] stops from 0 to 255"},
  geometry: {crop:"edge percentages [left,top,right,bottom]",perspective:"four normalized corners TL,TR,BR,BL (null resets)",matrix:"absolute PDF affine [a,b,c,d,e,f] for placement, scaling, flipping or rotation. Verify placement with page.image after apply."}
};
for(const [group,,items] of controls) for(const [key,,low,high] of items)
  (groups[group] ||= {})[key] = low + ".." + high;

function mergeAdjustments(base, patch) {
  if (patch === undefined) return {...base};
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw Error("adjustments must be an object");
  const out = {...base};
  for (const [k,v] of Object.entries(patch)) {
    if (["__proto__","prototype","constructor"].includes(k)) throw Error("Invalid adjustment");
    if (v === null) delete out[k];
    else if (["levels","balance","selective","channelCurves","curveTables"].includes(k))
      out[k] = {...out[k],...v};
    else out[k] = v;
    // A pencil table overrides point curves in the native renderer.
    if(k==="curves" && out.curveTables) {out.curveTables={...out.curveTables};delete out.curveTables.rgb;}
    if(k==="channelCurves" && out.curveTables) {out.curveTables={...out.curveTables};for(const c of Object.keys(v||{})) delete out.curveTables[c];}
  }
  return out;
}

export function installImageTools({S,rev,applyContent,approve}) {
  const candidates = new Map(), inspections = new Map();
  let cacheRevision;
  return async function run(a,deadline) {
    if (a.action==="help") return a.group ? (groups[a.group] || {groups:Object.keys(groups)}) : groups;
    if(!S.pdf || S.busy) throw Error("Open an idle document first");
    const revision = rev();
    if (revision !== cacheRevision) { candidates.clear(); inspections.clear(); cacheRevision=revision; }
    const fresh=()=>{if(rev()!==revision || Date.now()>deadline)throw Error("Document changed or request expired");};
    if (!["inspect","preview","apply","replace","generate"].includes(a.action)) throw Error("Unknown image action");
    if ((a.action==="apply" || a.revision!==undefined) && a.revision!==revision)
      throw Error("Stale image revision. Inspect or preview the image again.");
    if (!approve(a)) throw Error("用户拒绝操作");
    fresh();
    const candidate=a.previewId && candidates.get(a.previewId);
    if(a.previewId && !candidate) throw Error("Preview expired. Preview the image again.");
    if(candidate && ((a.page!==undefined && a.page!==candidate.page) || (a.index!==undefined && a.index!==candidate.index))) throw Error("Preview target differs");
    const page = a.page ?? candidate?.page ?? S.page;
    if(!Number.isInteger(page) || page<1 || page>S.info.pageCount) throw Error("Invalid image page");
    if (!inspections.has(page)) {
      const r = await nativeRequest({command:"inspect",bytes:S.bytes,page,imagesOnly:true});
      fresh();
      const objects=r.objects.filter(o=>o.type==="image").map(o=>({...o,matrix:o.matrix.map((v,i)=>v+(i>=4?(r.pageOrigin?.[i-4]||0):0))}));
      if(inspections.size>=3) inspections.delete(inspections.keys().next().value);
      inspections.set(page,objects);
    }
    const images=inspections.get(page);
    const tool=S.imageEdit?.selection?.();
    const objSelection=S.objectSelection?.selection?.();
    const selected=tool?.page===page ? tool.indices : (objSelection?.items||[]).filter(o=>o.type==="image" && page===objSelection.page).map(o=>o.index);
    const idx=a.index ?? candidate?.index ?? (selected.length===1?selected[0]:images.length===1?images[0].index:undefined);
    const metadata=()=>({page,revision,selected,images:images.slice(0,100).map(({index,bounds,matrix,editable,reason})=>{
      const current=S.nativeEdits.find(e=>e.type==="image"&&e.page===page&&e.index===index);
      const {cube,curveTables,...adjustments}=current?.adjustments||{};
      return {index,bounds,matrix:current?.matrix||matrix,editable:editable&&!current?.delete,reason,crop:current?.crop,adjustments,
        ...(cube?{lutSize:cube.size}:{}),...(curveTables?{pencilChannels:Object.keys(curveTables)}:{})};
    }),total:images.length});
    if(a.action==="inspect") return metadata();
    if(idx===undefined) return {...metadata(),needsTarget:true,next:"Choose an image index."};
    const object=images.find(o=>o.index===idx);
    if(!object?.editable) throw Error(object?.reason || "Image unavailable");
    if(S.imageEdit?.editing || S.flowDraftDirty) throw Error("Apply or cancel the pending on-page edit first.");
    const prior=S.nativeEdits.find(e=>e.type==="image" && e.page===page && e.index===idx);
    if(prior?.delete) throw Error("Image has been deleted");
    const base=candidate || prior;
    const edit={id:prior?.id || crypto.randomUUID(),type:"image",index:idx,page,signature:object.signature,matrix:object.matrix,...base,
      adjustments:mergeAdjustments(a.reset ? {} : base?.adjustments,a.adjustments)};
    for(const k of Object.keys(a.geometry||{})) {
      if(!["matrix","crop","perspective"].includes(k)) throw Error("Unknown geometry field");
      edit[k]=a.geometry[k];
    }
    if (!Array.isArray(edit.matrix) || edit.matrix.length!==6 || !edit.matrix.every(Number.isFinite) ||
      Math.abs(edit.matrix[0]*edit.matrix[3]-edit.matrix[1]*edit.matrix[2])<1e-9) throw Error("Invalid image matrix");
    if(a.action==="replace" || a.action==="generate") {
      let replacement;
      if(a.action==="replace") replacement=await window.desktop.pickImage();
      else {
        if(!a.prompt?.trim())throw Error("Supply an image prompt");
        let reference;
        if(a.region || a.useReference) {
          const ref=await nativeRequest({command:"image-preview",bytes:S.bytes,page,index:idx,imageData:edit.imageData,
            adjustments:{},vision:{region:a.region,detail:"detail"}});
          reference="data:"+ref.mimeType+";base64,"+ref.data;
        }
        fresh();
        replacement=await window.desktop.generateImage({prompt:a.prompt,reference});
      }
      if(!replacement) throw Error("Image selection cancelled");
      fresh();
      const composed=await nativeRequest({command:"image-replace",bytes:S.bytes,page,index:idx,
        imageData:edit.imageData,replacement,region:a.region});
      edit.imageData=composed.imageData;
      if(!a.region)edit.imageFit=a.fit||"contain";
    }
    if(a.action==="apply") {
      if(!candidate && !a.adjustments && !a.geometry && !a.reset) throw Error("Supply a previewId or changes");
      const edits=S.nativeEdits.filter(e=>e!==prior);
      fresh();
      await applyContent([...edits,edit],S.ocr);
      return {page,index:idx,revision:rev(),applied:true,next:"Preview this image again to inspect the applied pixels, or use page.image for its placement."};
    }
    const result=await nativeRequest({command:"image-preview",bytes:S.bytes,page,index:idx,
      imageData:edit.imageData,adjustments:edit.adjustments,vision:{detail:a.detail||"auto",region:a.region,crop:edit.crop||[0,0,0,0],perspective:edit.perspective}});
    fresh();
    const {data,mimeType,...metrics}=result, previewId=crypto.randomUUID();
    const bytes = value => value.imageData?.length || 0;
    let stored=bytes(edit)+[...candidates.values()].reduce((n,v)=>n+bytes(v),0);
    while(candidates.size && (candidates.size>=6 || stored>45*1024**2)) {
      const [key,old]=candidates.entries().next().value;stored-=bytes(old);candidates.delete(key);
    }
    candidates.set(previewId,edit);
    return {content:[{type:"text",text:JSON.stringify({page,index:idx,revision,previewId,...metrics,
      next:"Inspect these pixels. To refine, preview again with this previewId and just the changed adjustments. Apply the chosen previewId and revision."})},{type:"image",mimeType,data}]};
  };
}

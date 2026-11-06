import {nativeRequest} from "./native-source.mjs";
import {controls} from "./image-color-model.mjs";
import {placement} from "./graphic-geometry.mjs";

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

const assetStores = new WeakMap();
export function installImageTools({S,rev,applyContent,approve}) {
  if(!assetStores.has(S))assetStores.set(S,new Map());
  const candidates = new Map(), inspections = new Map(), assets = assetStores.get(S);
  let cacheRevision;
  return async function run(a,deadline) {
    if(a.id && a.page===undefined){const target=S.nativeEdits.find(e=>e.id===a.id&&e.type==='inserted-image'&&!e.delete);if(target)a={...a,page:target.page};}
    if(a.rotation!==undefined)a={...a,geometry:{rotation:Number(a.rotation),...a.geometry}};
    if (a.action==="help") return a.group ? (groups[a.group] || {groups:Object.keys(groups)}) : groups;
    if(!S.pdf || S.busy) throw Error("Open an idle document first");
    const revision = rev();
    if(a.action==='generate_new') {
      if(!approve(a))throw Error('用户拒绝操作');
      const prompts=a.prompts??[a.prompt];
      if(!Array.isArray(prompts)||!prompts.length||prompts.length>4||prompts.some(p=>typeof p!=='string'||!p.trim()))throw Error('Supply 1–4 prompts');
      const results=await Promise.allSettled(prompts.map(async prompt=>{
        const imageData=await window.desktop.generateImage({prompt,...a.parameters});
        const assetId=crypto.randomUUID();
        while(assets.size>=8 || [...assets.values()].reduce((n,v)=>n+v.imageData.length,0)+imageData.length>90*1024**2) {
          if(!assets.size)throw Error('Generated image exceeds cache budget');
          assets.delete(assets.keys().next().value);
        }
        assets.set(assetId,{imageData,created:Date.now()});return {assetId,prompt};
      }));
      return {results:results.map((r,i)=>r.status==='fulfilled'?r.value:{prompt:prompts[i],error:r.reason.message}),revision:rev(),next:'Use insert with assetId, the latest revision, page and geometry. Generated assets remain available while other edits run.'};
    }
    const writeActions=['insert','update','move','delete'];
    if(writeActions.includes(a.action)) {
      if(a.revision!==revision)throw Error('Stale image revision. Inspect again.');
      if(!approve(a))throw Error('用户拒绝操作');
      const page=a.page??S.page;
      const targetPage=a.targetPage??page;
      if(![page,targetPage].every(p=>Number.isInteger(p)&&p>=1&&p<=S.info.pageCount))throw Error('Invalid page');
      if(S.imageEdit?.editing||S.flowDraftDirty)throw Error('Apply or cancel the pending on-page edit first');
      const fresh=()=>{if(rev()!==revision||Date.now()>deadline)throw Error('Document changed or request expired');};
      const added=a.id&&S.nativeEdits.find(e=>e.id===a.id&&e.type==='inserted-image'&&e.page===page&&!e.delete);
      let prior, edit, remove;
      if(a.action==='insert') {
        const asset=assets.get(a.assetId);
        let imageData=asset?.imageData;
        if(!imageData && !a.assetId)imageData=await window.desktop.pickImage();
        if(!imageData)throw Error('Image asset expired or selection cancelled');
        edit={id:crypto.randomUUID(),type:'inserted-image',page:targetPage,imageData,...placement(a.geometry),adjustments:mergeAdjustments({},a.adjustments),imageFit:a.fit||'contain'};
      } else if(added) {
        prior=added;
        edit={...added,page:targetPage,...placement(a.geometry,added.matrix),adjustments:mergeAdjustments(a.reset?{}:added.adjustments,a.adjustments),imageFit:a.fit??added.imageFit};
        if(a.action==='delete')edit=null;
      } else {
        if(a.id)throw Error('Inserted image ID not found');
        const inspected=await nativeRequest({command:'inspect',bytes:S.bytes,page,imagesOnly:true});fresh();
        const obj=inspected.objects.find(o=>o.index===a.index&&o.type==='image');
        if(!obj?.editable)throw Error(obj?.reason||'Image not found');
        prior=S.nativeEdits.find(e=>e.page===page&&e.index===a.index&&e.type==='image');
        if(prior?.delete)throw Error('Image already deleted');
        const matrix=obj.matrix.map((v,i)=>v+(i>=4?(inspected.pageOrigin?.[i-4]||0):0));
        edit={id:prior?.id||crypto.randomUUID(),type:'image',page,index:obj.index,signature:obj.signature,matrix,opacity:obj.opacity??1,blendMode:obj.blendMode??'Normal',...prior,...placement(a.geometry,prior?.matrix||matrix),adjustments:mergeAdjustments(a.reset?{}:prior?.adjustments,a.adjustments),imageFit:a.fit??prior?.imageFit??'contain'};
        if(a.action==='delete')edit.delete=true;
        else if(targetPage!==page || (a.geometry && edit.matrix.some((v,i)=>Math.abs(v-(prior?.matrix||matrix)[i])>1e-8))) {
          const pixels=await nativeRequest({command:'image-export',bytes:S.bytes,page,index:obj.index,imageData:edit.imageData});fresh();
          remove={id:crypto.randomUUID(),type:'image',page,index:obj.index,signature:obj.signature,delete:true};
          edit={...edit,id:crypto.randomUUID(),type:'inserted-image',page:targetPage,imageData:pixels.imageData};delete edit.index;delete edit.signature;
        }
      }
      if(edit) {if(a.opacity!==undefined)edit.opacity=a.opacity;if(a.blendMode!==undefined)edit.blendMode=a.blendMode;}
      fresh();await applyContent([...S.nativeEdits.filter(e=>e!==prior),...(remove?[remove]:[]),...(edit?[edit]:[])],S.ocr);
      return {applied:true,revision:rev(),id:edit?.id,page:targetPage,target:edit?{id:edit.id,page:targetPage}:undefined,next:edit?'For further edits use this target.id and target.page with the latest revision. Rotation belongs in geometry.rotation.':undefined};
    }
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
    const metadata=()=>({page,revision,selected,inserted:S.nativeEdits.filter(e=>e.type==='inserted-image'&&e.page===page&&!e.delete).map(({id,matrix,crop,adjustments,imageFit,opacity=1,blendMode="Normal"})=>({id,matrix,crop,adjustments,fit:imageFit,opacity,blendMode})),images:images.slice(0,100).map(({index,bounds,matrix,editable,reason,opacity=1,blendMode='Normal'})=>{
      const current=S.nativeEdits.find(e=>e.type==="image"&&e.page===page&&e.index===index);
      const {cube,curveTables,...adjustments}=current?.adjustments||{};
      return {index,bounds,matrix:current?.matrix||matrix,editable:editable&&!current?.delete,reason,crop:current?.crop,adjustments,opacity:current?.opacity??opacity,blendMode:current?.blendMode??blendMode,
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
    Object.assign(edit,placement(a.geometry,edit.matrix));
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
        replacement=await window.desktop.generateImage({prompt:a.prompt,reference,...a.parameters});
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

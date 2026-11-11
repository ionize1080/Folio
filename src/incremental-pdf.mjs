import {PDFContext, PDFDocument, PDFDict, PDFArray, PDFStream, PDFName, PDFRef} from './vendor/pdf-lib.js';
const encode = s => new TextEncoder().encode(s);
// A private object graph, sharing immutable stream payloads. Saving never mutates
// the open document or copies/recompresses its images, fonts and content streams.
export function forkDocument(doc) {
  const context = PDFContext.create(), memo = new Map();
  function copy(value) {
    if (memo.has(value)) return memo.get(value);
    if (!(value instanceof PDFDict || value instanceof PDFArray)) return value;
    const result = value.clone(context); Object.setPrototypeOf(result,Object.getPrototypeOf(value));memo.set(value,result);
    if(value instanceof PDFDict) for(const [k,v] of value.entries()) result.set(k,copy(v));
    else for(let i=0;i<value.size();i++) result.set(i,copy(value.get(i)));
    return result;
  }
  context.header=doc.context.header;
  context.trailerInfo={...doc.context.trailerInfo};
  for(const [ref,obj] of doc.context.enumerateIndirectObjects()) context.assign(ref,copy(obj));
  context.largestObjectNumber=doc.context.largestObjectNumber;
  return {doc:new PDFDocument(context,false,false),copy};
}
export function previousXref(bytes) {
  const tail=new TextDecoder('latin1').decode(bytes.subarray(Math.max(0,bytes.length-4096)));
  const match=/startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if(!match)return null;
  const offset=Number(match[1]);
  if(!Number.isSafeInteger(offset)||offset<0||offset>=bytes.length)return null;
  const head=new TextDecoder('latin1').decode(bytes.subarray(offset,offset+100));
  return /^(xref\b|\d+\s+\d+\s+obj\b)/.test(head)?offset:null;
}
export function reserveOriginalRefs(doc,bytes){
  const offset=previousXref(bytes);if(offset===null)return false;
  const decode=b=>new TextDecoder('latin1').decode(b);
  const head=decode(bytes.subarray(offset,offset+4096));
  const trailer=head.startsWith('xref')?decode(bytes.subarray(Math.max(offset,bytes.length-8192))):head.split('stream')[0];
  const match=/\/Size\s+(\d+)\b/.exec(trailer);
  if(!match)return false;
  // pdf-lib discards the enclosing ObjStm and XRef objects after parsing. Their
  // numbers remain live in the original revision and MUST never be reused.
  doc.context.largestObjectNumber=Math.max(doc.context.largestObjectNumber,Number(match[1])-1);return true;
}
export async function incrementalRevision(base,doc,bytes,progress=()=>{}) {
  const prev=previousXref(bytes);
  if(prev===null || base.isEncrypted) return null;
  const changed=[], old=base.context.indirectObjects;
  const live=liveReferences(doc),written=base.folioWrittenRefs;
  for(const [ref,obj] of doc.context.enumerateIndirectObjects()) {
    if(!live.has(ref))continue;
    const before=old.get(ref);
    if(!written||written.has(ref)){
      if(obj===before)continue; // Includes unchanged (potentially huge) streams.
      if(before && !(obj instanceof PDFStream) && before.toString()===obj.toString())continue;
    }
    changed.push([ref,obj]);
  }
  const parts=[encode('\n')],entries=[];let offset=bytes.length+1;
  for(let i=0;i<changed.length;i++) {
    const [ref,obj]=changed[i], head=encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`), end=encode('\nendobj\n');
    const body=new Uint8Array(obj.sizeInBytes());obj.copyBytesInto(body,0);
    entries.push({ref,offset});parts.push(head,body,end);offset+=head.length+body.length+end.length;
    if(i%100===0){progress({stage:'写入增量对象',completed:i,total:changed.length});await new Promise(r=>setTimeout(r,0));}
  }
  const xref=offset;let table='xref\n0 1\n0000000000 65535 f \n';
  for(let i=0;i<entries.length;) {
    let j=i+1;while(j<entries.length&&entries[j].ref.objectNumber===entries[j-1].ref.objectNumber+1)j++;
    table+=`${entries[i].ref.objectNumber} ${j-i}\n`;
    for(;i<j;i++)table+=`${String(entries[i].offset).padStart(10,'0')} ${String(entries[i].ref.generationNumber).padStart(5,'0')} n \n`;
  }
  const trailer=doc.context.obj({Size:doc.context.largestObjectNumber+1,Prev:prev});
  for(const key of ['Root','Info','ID'])if(doc.context.trailerInfo[key])trailer.set(PDFName.of(key),doc.context.trailerInfo[key]);
  parts.push(encode(`${table}trailer\n${trailer}\nstartxref\n${xref}\n%%EOF\n`));
  const delta=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;
  for(const part of parts){delta.set(part,at);at+=part.length;}
  progress({stage:'增量序列化完成',completed:changed.length,total:changed.length});
  return {delta,objects:changed.length,writtenRefs:new Set([...(written||old.keys()),...live])};
}
export function joinRevision(bytes,delta){const out=new Uint8Array(bytes.length+delta.length);out.set(bytes);out.set(delta,bytes.length);return out;}

// Native editors can renumber every object. Import their complete graph with
// fresh references, reusing only byte-identical streams with reference-free
// dictionaries. Never guess that equal object numbers identify equal content.
const fingerprints=new WeakMap(),indexes=new WeakMap();
function directKey(value){
  if(value instanceof PDFRef)return null;
  if(value instanceof PDFDict){const parts=[];for(const [k,v] of value.entries().sort(([a],[b])=>a.toString().localeCompare(b.toString()))){if(k===PDFName.of('Length'))continue;const key=directKey(v);if(key===null)return null;parts.push(k+':'+key);}return '{'+parts.join(',')+'}';}
  if(value instanceof PDFArray){const parts=value.asArray().map(directKey);return parts.includes(null)?null:'['+parts.join(',')+']';}
  return value.toString();
}
async function streamKey(stream){
  if(fingerprints.has(stream))return fingerprints.get(stream);
  const dict=directKey(stream.dict);if(dict===null)return null;
  const data=stream.getContents(),hash=await crypto.subtle.digest('SHA-256',data);
  const key=dict+':'+data.length+':'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');fingerprints.set(stream,key);return key;
}
export async function graftDocument(base,source,progress=()=>{}){
  const fork=forkDocument(base),context=fork.doc.context,refs=new Map(),memo=new Map();
  let streams=indexes.get(base);
  if(!streams){streams=new Map();for(const [ref,obj] of base.context.enumerateIndirectObjects())if(obj instanceof PDFStream){const key=await streamKey(obj);if(key!==null)streams.set(key,ref);}indexes.set(base,streams);}
  const objects=source.context.enumerateIndirectObjects();let reused=0;
  for(let i=0;i<objects.length;i++){
    const [ref,obj]=objects[i],key=obj instanceof PDFStream?await streamKey(obj):null,match=key&&streams.get(key);
    refs.set(ref.toString(),match||context.nextRef());if(match)reused++;
    if(i%100===0){progress({stage:'复用原有页面资源',completed:i,total:objects.length});await new Promise(r=>setTimeout(r,0));}
  }
  function copy(value){
    if(value instanceof PDFRef){const ref=refs.get(value.toString());if(!ref)throw Error('页面资源引用缺失，已停止保存');return ref;}
    if(memo.has(value))return memo.get(value);
    if(value instanceof PDFStream){const out=value.clone(context);memo.set(value,out);out.dict=copy(value.dict);return out;}
    if(!(value instanceof PDFDict||value instanceof PDFArray))return value;
    const out=value.clone(context);Object.setPrototypeOf(out,Object.getPrototypeOf(value));memo.set(value,out);
    if(value instanceof PDFDict)for(const [k,v] of value.entries())out.set(k,copy(v));
    else for(let i=0;i<value.size();i++)out.set(i,copy(value.get(i)));return out;
  }
  for(const [ref,obj] of objects){const target=refs.get(ref.toString());if(!context.indirectObjects.has(target))context.assign(target,copy(obj));else memo.set(obj,context.lookup(target));}
  context.trailerInfo={};for(const k of ['Root','Info','ID'])if(source.context.trailerInfo[k])context.trailerInfo[k]=copy(source.context.trailerInfo[k]);
  const doc=new PDFDocument(context,false,false),header=source.context.header;
  const declared=source.catalog.get(PDFName.of('Version'));
  const version=Math.max(Number(header.major+'.'+header.minor),declared instanceof PDFName?Number(declared.decodeText()):0);
  if(version>Number(base.context.header.major+'.'+base.context.header.minor))doc.catalog.set(PDFName.of('Version'),PDFName.of(version.toFixed(1)));
  return {doc,copy,refs,reused};
}

export async function appendSnapshot(original,snapshot,progress){
  const base=await PDFDocument.load(original,{updateMetadata:false,throwOnInvalidObject:true});
  if(!reserveOriginalRefs(base,original))return snapshot;
  const source=await PDFDocument.load(snapshot,{updateMetadata:false,throwOnInvalidObject:true}),next=await graftDocument(base,source,progress);
  const revision=await incrementalRevision(base,next.doc,original,progress);
  return revision?joinRevision(original,revision.delta):snapshot;
}

export function liveReferences(doc){
  const seen=new Set(),live=new Set(),pending=Object.values(doc.context.trailerInfo).filter(Boolean);
  while(pending.length){let value=pending.pop();if(value instanceof PDFRef){if(live.has(value))continue;live.add(value);value=doc.context.lookup(value);}
    if(!value||seen.has(value))continue;seen.add(value);if(value instanceof PDFStream)value=value.dict;
    if(value instanceof PDFDict)pending.push(...value.values());else if(value instanceof PDFArray)pending.push(...value.asArray());
  }
  return live;
}
export function removeUnreachable(doc){
  const live=liveReferences(doc);for(const [ref] of doc.context.enumerateIndirectObjects())if(!live.has(ref))doc.context.delete(ref);return live;
}

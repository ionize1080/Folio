import {PDFContext, PDFDocument, PDFDict, PDFArray, PDFStream, PDFName, PDFRef,
  PDFNumber, PDFString, PDFHexString, PDFObjectParser, PDFCrossRefStream} from './vendor/pdf-lib.js';
const encode = s => new TextEncoder().encode(s);
const ascii = new TextDecoder('latin1');
const sectionCache = new WeakMap();
const sectionKeys = new Set(['Size', 'Prev', 'XRefStm', 'Root', 'Info', 'ID', 'Encrypt']);
const streamKeys = new Set(['Type', 'Length', 'Filter', 'DecodeParms', 'W', 'Index', 'DL', 'F', 'FFilter', 'FDecodeParms']);
function objectBytes(object) {
  const bytes = new Uint8Array(object.sizeInBytes());
  object.copyBytesInto(bytes, 0);
  return bytes;
}
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
function readSectionAt(bytes, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length) return null;
  const data = bytes.subarray(offset);
  const header = /^(xref\b|\d+\s+\d+\s+obj\b)/.exec(ascii.decode(data.subarray(0, 100)));
  if (!header) return null;
  const classic = header[0] === 'xref';
  const ranges = [];
  // The first-page trailer of a linearized file can be several MB before EOF.
  // Follow its actual xref subsections, never search the PDF payload for /Size.
  const parser = PDFObjectParser.forBytes(data, PDFContext.create());
  const cursor = parser.bytes;
  cursor.moveTo(header[0].length);
  parser.skipWhitespaceAndComments();
  if (classic) {
    while (cursor.peek() >= 48 && cursor.peek() <= 57) {
      const first = parser.parseRawInt();
      parser.skipWhitespace();
      const count = parser.parseRawInt();
      parser.skipWhitespace();
      const end = cursor.offset() + count * 20;
      if (!Number.isSafeInteger(end) || end > data.length) return null;
      ranges.push({first, count, position:offset + cursor.offset()});
      cursor.moveTo(end);
      parser.skipWhitespaceAndComments();
    }
    if (!parser.matchKeyword(encode('trailer'))) return null;
    parser.skipWhitespaceAndComments();
  }
  const trailer = parser.parseDict();
  if (!classic) {
    parser.skipWhitespaceAndComments();
    const widths = trailer.get(PDFName.of('W'));
    if (trailer.get(PDFName.of('Type')) !== PDFName.of('XRef') ||
        !(widths instanceof PDFArray) || widths.size() !== 3 ||
        !parser.matchKeyword(encode('stream'))) return null;
  }
  const size = trailer.get(PDFName.of('Size'));
  if (!(size instanceof PDFNumber) || !Number.isSafeInteger(size.asNumber()) ||
      size.asNumber() < 1 || size.asNumber() > 2147483647) return null;
  return {offset, classic, trailer, ranges, size:size.asNumber()};
}

function readLastSection(bytes) {
  const tail = ascii.decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
  const marker = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  const latest = marker && readSectionAt(bytes, Number(marker[1]));
  if (!latest) return null;
  // Older Folio versions emitted this exact table header even on stream-based
  // originals. Index those revisions together once so the next append can
  // point directly to the underlying stream without rewriting signed bytes.
  const legacyHeader = 'xref\n0 1\n0000000000 65535 f \n';
  const history = [];
  let section = latest;
  while (section.classic &&
         ascii.decode(bytes.subarray(section.offset, section.offset + legacyHeader.length)) === legacyHeader &&
         !section.trailer.has(PDFName.of('XRefStm'))) {
    const prev = section.trailer.get(PDFName.of('Prev'));
    if (!(prev instanceof PDFNumber) || prev.asNumber() >= section.offset) break;
    history.push(section.ranges);
    section = readSectionAt(bytes, prev.asNumber());
    if (!section) return null;
  }
  if (history.length && !section.classic) latest.bridge = {previous:section.offset, history};
  return latest;
}

function lastSection(bytes) {
  if (!sectionCache.has(bytes)) {
    let section = null;
    try { section = readLastSection(bytes); } catch { /* Invalid syntax takes the full-save path. */ }
    sectionCache.set(bytes, section);
  }
  return sectionCache.get(bytes);
}

export function previousXref(bytes) {
  return lastSection(bytes)?.offset ?? null;
}
export function reserveOriginalRefs(doc,bytes){
  const section = lastSection(bytes);
  if (!section) return false;
  // In a linearized PDF the authoritative first-page trailer is physically
  // before the main trailer. pdf-lib's sequential scan may discard its Info.
  const info = section.trailer.get(PDFName.of('Info'));
  if (info instanceof PDFRef && doc.context.lookup(info) instanceof PDFDict) doc.context.trailerInfo.Info = info;
  const ids = section.trailer.get(PDFName.of('ID'));
  if (ids instanceof PDFArray) doc.context.trailerInfo.ID = ids;
  // pdf-lib discards the enclosing ObjStm and XRef objects after parsing. Their
  // numbers remain live in the original revision and MUST never be reused.
  doc.context.largestObjectNumber=Math.max(doc.context.largestObjectNumber,section.size-1);return true;
}
function revisionTrailer(section, doc) {
  const trailer = doc.context.obj({Size:doc.context.largestObjectNumber + 1, Prev:section.bridge?.previous ?? section.offset});
  for (const [key, value] of section.trailer.entries()) {
    const name = key.decodeText();
    if (!sectionKeys.has(name) && (section.classic || !streamKeys.has(name))) trailer.set(key, value);
  }
  for (const key of ['Root', 'Info']) {
    const value = doc.context.trailerInfo[key];
    if (value) trailer.set(PDFName.of(key), value);
  }
  // ID[0] belongs to the original file even when a native editor supplies a
  // freshly numbered snapshot. ID strings are arbitrary bytes, not UTF-8 text.
  const ids = section.trailer.get(PDFName.of('ID')) || doc.context.trailerInfo.ID;
  const permanent = ids instanceof PDFArray && ids.get(0);
  if (permanent instanceof PDFString || permanent instanceof PDFHexString) {
    const revision = crypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(revision, n => n.toString(16).padStart(2, '0')).join('');
    const newIds = doc.context.obj([permanent, PDFHexString.of(hex)]);
    trailer.set(PDFName.of('ID'), newIds);
    doc.context.trailerInfo.ID = newIds;
  }
  return trailer;
}
function streamEntries(bytes, section, changes) {
  if (!section.bridge) return changes;
  const latest = new Map(changes.map(entry => [entry.ref.objectNumber, entry]));
  for (const ranges of section.bridge.history) {
    for (const {first, count, position} of ranges) {
      for (let i = 0; i < count; i++) {
        const number = first + i;
        if (!number || latest.has(number)) continue;
        const start = position + i * 20;
        const row = /^(\d{10}) (\d{5}) ([nf])/.exec(ascii.decode(bytes.subarray(start, start + 20)));
        if (!row) return null;
        latest.set(number, {ref:PDFRef.of(number, Number(row[2])), offset:Number(row[1]), free:row[3] === 'f'});
      }
    }
  }
  return [...latest.values()].sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);
}
export async function incrementalRevision(base,doc,bytes,progress=()=>{}) {
  const section=lastSection(bytes);
  if(!section || base.isEncrypted || section.trailer.has(PDFName.of('Encrypt'))) return null;
  const changed=[], old=base.context.indirectObjects;
  // Reading metadata through pdf-lib may create an Info dictionary even when
  // the physical base has none. Object identity cannot prove it was written.
  const info = base.context.trailerInfo.Info;
  const unsavedInfo = info === section.trailer.get(PDFName.of('Info')) ? null : info;
  const live=liveReferences(doc),written=base.folioWrittenRefs;
  for(const [ref,obj] of doc.context.enumerateIndirectObjects()) {
    if(!live.has(ref))continue;
    const before=old.get(ref);
    if(ref !== unsavedInfo && (!written||written.has(ref))){
      if(obj===before)continue; // Includes unchanged (potentially huge) streams.
      if(before && !(obj instanceof PDFStream) && before.toString()===obj.toString())continue;
    }
    changed.push([ref,obj]);
  }
  // A classic section needs a subsection even on a no-op save. Re-emit the
  // catalog instead of replacing object zero and severing the original free list.
  const classic = section.classic && !section.bridge;
  if (classic && changed.length === 0) {
    const root = doc.context.trailerInfo.Root;
    changed.push([root, doc.context.lookup(root)]);
  }
  const parts=[encode('\n')],entries=[];let offset=bytes.length+1,lastYield=performance.now();
  progress({stage:'写入增量对象',completed:0,total:changed.length});
  for(let i=0;i<changed.length;i++) {
    const [ref,obj]=changed[i], head=encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`), end=encode('\nendobj\n');
    const body=objectBytes(obj);
    entries.push({ref,offset});parts.push(head,body,end);offset+=head.length+body.length+end.length;
    // Yield by elapsed work, not object count. Thousands of tiny bookmarks
    // otherwise spend most of their save waiting for Windows timer ticks.
    if(i%100===0&&performance.now()-lastYield>=8){progress({stage:'写入增量对象',completed:i,total:changed.length});await new Promise(r=>setTimeout(r,0));lastYield=performance.now();}
  }
  const xref = offset;
  if (classic) {
    let table = 'xref\r\n';
    for (let i = 0; i < entries.length;) {
      let j = i + 1;
      while (j < entries.length && entries[j].ref.objectNumber === entries[j - 1].ref.objectNumber + 1) j++;
      table += `${entries[i].ref.objectNumber} ${j - i}\r\n`;
      for (; i < j; i++) {
        const {offset, ref} = entries[i];
        if (offset > 9999999999) return null;
        table += `${String(offset).padStart(10,'0')} ${String(ref.generationNumber).padStart(5,'0')} n\r\n`;
      }
    }
    parts.push(encode(table + 'trailer\r\n'), objectBytes(revisionTrailer(section, doc)), encode('\r\n'));
  } else {
    // A stream-based input retains a stream-based /Prev chain. Include the
    // stream's own location and reserve its object number for subsequent saves.
    const rows = streamEntries(bytes, section, entries);
    if (!rows) return null;
    const ref = doc.context.nextRef();
    const stream = PDFCrossRefStream.of(revisionTrailer(section, doc), [], false);
    for (const entry of rows) {
      if (entry.free) stream.addDeletedEntry(entry.ref, entry.offset);
      else stream.addUncompressedEntry(entry.ref, entry.offset);
    }
    stream.addUncompressedEntry(ref, xref);
    parts.push(encode(`${ref.objectNumber} 0 obj\n`), objectBytes(stream), encode('\nendobj\n'));
  }
  parts.push(encode(`startxref\n${xref}\n%%EOF\n`));
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
  const objects=source.context.enumerateIndirectObjects();let reused=0,lastYield=performance.now();
  progress({stage:'复用原有页面资源',completed:0,total:objects.length});
  for(let i=0;i<objects.length;i++){
    const [ref,obj]=objects[i],key=obj instanceof PDFStream?await streamKey(obj):null,match=key&&streams.get(key);
    refs.set(ref.toString(),match||context.nextRef());if(match)reused++;
    if(i%100===0&&performance.now()-lastYield>=8){progress({stage:'复用原有页面资源',completed:i,total:objects.length});await new Promise(r=>setTimeout(r,0));lastYield=performance.now();}
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

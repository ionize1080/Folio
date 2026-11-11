// One immutable input for save, append and output comparison. Applied native
// content lives in PDF.js; the structural worker can still hold original bytes.
const contentSnapshots=new WeakMap();
export async function buildExportSnapshot(S, settings, session) {
  const token = session.capture();
  const pdf = S.pdf;
  const snapshot = structuredClone({
    nodes: S.nodes,
    rotations: S.rotation,
    annotations: S.annotations,
    metadata: S.metadata,
    showBookmarks: settings.showBookmarks,
  });
  let contentBytes=null,contentRevision=null;
  if(S.nativeEdits.length||S.ocr.length){
    let cached=contentSnapshots.get(pdf);
    if(!cached){cached={id:crypto.randomUUID(),bytes:Promise.resolve(pdf.getData()).then(b=>new Uint8Array(b))};contentSnapshots.set(pdf,cached);cached.bytes.catch(()=>contentSnapshots.delete(pdf));}
    contentBytes=await cached.bytes;contentRevision=cached.id;
  }
  session.assert(token);
  if (pdf !== S.pdf) throw Error("文档已变化，本次结果未应用");
  return { ...snapshot, contentBytes, contentRevision };
}

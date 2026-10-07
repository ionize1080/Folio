// One immutable input for save, append and output comparison. Applied native
// content lives in PDF.js; the structural worker can still hold original bytes.
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
  const contentBytes =
    S.nativeEdits.length || S.ocr.length
      ? new Uint8Array(await pdf.getData())
      : null;
  session.assert(token);
  if (pdf !== S.pdf) throw Error("文档已变化，本次结果未应用");
  return { ...snapshot, contentBytes };
}

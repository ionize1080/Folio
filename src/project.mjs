export const PROJECT_FORMAT = "folio-project/1";
export function encodeBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
export async function digest(bytes) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function encodeProject(bytes, name, state) {
  const { ocrReference, ...portable } = state;
  return new TextEncoder().encode(
    JSON.stringify({
      format: PROJECT_FORMAT,
      source: {
        name: name.replace(/\.folio$/i, ".pdf"),
        sha256: await digest(bytes),
        base64: encodeBase64(bytes),
      },
      state: portable,
    }),
  );
}
export async function decodeProject(bytes) {
  const p = JSON.parse(new TextDecoder().decode(bytes));
  if (
    p.format !== PROJECT_FORMAT ||
    typeof p.source?.base64 !== "string" ||
    typeof p.source?.name !== "string" ||
    !p.state ||
    !Array.isArray(p.state.nodes) ||
    !Array.isArray(p.state.nativeEdits) ||
    !Array.isArray(p.state.ocr) ||
    !Array.isArray(p.state.annotations)
  )
    throw Error("Folio 工程格式无效");
  if (p.source.base64.length > 1024 * 1024 * 1024) throw Error("工程原件过大");
  const data = Uint8Array.from(atob(p.source.base64), (c) => c.charCodeAt(0));
  if ((await digest(data)) !== p.source.sha256)
    throw Error("工程原件校验不一致");
  return {
    bytes: data,
    name: p.source.name,
    state: {
      nodes: p.state.nodes,
      nativeEdits: p.state.nativeEdits,
      structures: Array.isArray(p.state.structures) ? p.state.structures : [],
      ocr: p.state.ocr,
      annotations: p.state.annotations,
      rotation: p.state.rotation || {},
      metadata: p.state.metadata || {},
      ocrReference: null,
    },
  };
}

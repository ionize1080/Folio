const encoder = new TextEncoder(),
  hashes = new WeakMap();
export async function digest(bytes) {
  if (!hashes.has(bytes))
    hashes.set(
      bytes,
      crypto.subtle
        .digest("SHA-256", bytes)
        .then((b) =>
          [...new Uint8Array(b)]
            .map((x) => x.toString(16).padStart(2, "0"))
            .join(""),
        ),
    );
  return hashes.get(bytes);
}
export function fromBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 16384)
    s += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(s);
}
const packed = new WeakMap();
export async function packState(state) {
  const assets = new Map(),
    nativeEdits = [];
  for (const edit of state.nativeEdits || []) {
    let result = packed.get(edit);
    if (!result) {
      const { fragment, ink, ...small } = edit,
        files = [];
      if (fragment) {
        const data = fromBase64(fragment),
          id = "assets/" + (await digest(data)) + ".pdf";
        small.fragmentAsset = id;
        files.push([id, data]);
      }
      if (ink) {
        const data = encoder.encode(JSON.stringify(ink)),
          id = "assets/" + (await digest(data)) + ".json";
        small.inkAsset = id;
        files.push([id, data]);
      }
      result = { small, files };
      if (Object.isFrozen(edit)) packed.set(edit, result);
    }
    nativeEdits.push(result.small);
    for (const [id, data] of result.files) assets.set(id, data);
  }
  const { ocrReference, ...portable } = state;
  return { state: { ...portable, nativeEdits }, assets };
}
export function unpackState(state, assets) {
  if (
    !state ||
    !Array.isArray(state.nodes) ||
    !Array.isArray(state.nativeEdits) ||
    !Array.isArray(state.ocr) ||
    !Array.isArray(state.annotations)
  )
    throw Error("工程编辑状态无效");
  if (
    state.nodes.length > 200000 ||
    state.nativeEdits.length > 20000 ||
    state.ocr.length > 1000000 ||
    state.annotations.length > 200000
  )
    throw Error("工程编辑数量超过上限");
  const numeric = new Set([
    "page",
    "index",
    "size",
    "width",
    "height",
    "x",
    "y",
    "charSpacing",
    "wordSpacing",
    "horizontalScale",
    "lineHeight",
    "columns",
    "firstIndent",
    "paragraphBefore",
    "paragraphGap",
    "layerOrder",
  ]);
  function check(v, depth = 0) {
    if (depth > 32) throw Error("工程编辑嵌套过深");
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (["__proto__", "prototype", "constructor"].includes(k))
        throw Error("工程包含无效字段");
      if (
        numeric.has(k) &&
        x !== null &&
        (typeof x !== "number" || !Number.isFinite(x))
      )
        throw Error("工程数值无效：" + k);
      if (typeof x === "object") check(x, depth + 1);
    }
  }
  const nativeEdits = state.nativeEdits.map((edit) => {
    if (!edit || typeof edit !== "object" || Array.isArray(edit))
      throw Error("工程内容编辑无效");
    check(edit);
    const { fragmentAsset, inkAsset, ...out } = edit;
    if (fragmentAsset) {
      const data = assets.get(fragmentAsset);
      if (!data) throw Error("工程缺少文字编辑资源");
      out.fragment = toBase64(data);
    }
    if (inkAsset) {
      const data = assets.get(inkAsset);
      if (!data) throw Error("工程缺少文字几何资源");
      out.ink = JSON.parse(new TextDecoder().decode(data));
    }
    return out;
  });
  return {
    ...state,
    nativeEdits,
    ocrReference: null,
    structures: Array.isArray(state.structures) ? state.structures : [],
    rotation: state.rotation || {},
    metadata: state.metadata || {},
  };
}

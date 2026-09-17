import {
  digest,
  packState,
  unpackState,
  fromBase64,
  toBase64,
} from "./portable-state.mjs";
import { zipBlob, unzipStored } from "./zip-store.mjs";
export { digest };
export const PROJECT_FORMAT = "folio-project/2";
export const encodeBase64 = toBase64;
export async function encodeProject(
  bytes,
  name,
  state,
  { blob = false, local = false } = {},
) {
  if (!local && typeof window !== "undefined" && typeof Worker !== "undefined")
    return projectJob("encode", { bytes, name, state, blob });
  const packed = await packState(state),
    entries = new Map([
      ["source.pdf", bytes],
      ["state.json", new TextEncoder().encode(JSON.stringify(packed.state))],
      ...packed.assets,
    ]);
  const manifest = {
    format: PROJECT_FORMAT,
    sourceName: name.replace(/\.folio$/i, ".pdf"),
    files: {},
  };
  for (const [key, data] of entries)
    manifest.files[key] = { size: data.length, sha256: await digest(data) };
  entries.set(
    "manifest.json",
    new TextEncoder().encode(JSON.stringify(manifest)),
  );
  const zip = zipBlob(entries);
  return blob ? zip : new Uint8Array(await zip.arrayBuffer());
}
export async function decodeProject(input, { local = false } = {}) {
  if (!local && typeof window !== "undefined" && typeof Worker !== "undefined")
    return projectJob("decode", { input });
  const bytes =
    input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input;
  if (bytes[0] === 80 && bytes[1] === 75) {
    const files = unzipStored(bytes),
      decode = (key) => {
        if (!files.has(key)) throw Error("工程缺少 " + key);
        return JSON.parse(new TextDecoder().decode(files.get(key)));
      },
      m = decode("manifest.json");
    if (
      m.format !== PROJECT_FORMAT ||
      typeof m.sourceName !== "string" ||
      m.sourceName.length > 260 ||
      !m.files ||
      typeof m.files !== "object"
    )
      throw Error("工程清单格式无效");
    if (Object.keys(m.files).length !== files.size - 1)
      throw Error("工程清单资源数量不一致");
    for (const [key, item] of Object.entries(m.files)) {
      const data = files.get(key);
      if (
        !data ||
        item.size !== data.length ||
        item.sha256 !== (await digest(data))
      )
        throw Error("工程资源校验不一致：" + key);
    }
    const data = files.get("source.pdf");
    if (!data?.length || data.length > 768 * 1024 ** 2)
      throw Error("工程原文缺失或过大");
    return {
      bytes: data.slice(),
      name: m.sourceName,
      state: unpackState(decode("state.json"), files),
    };
  }
  const p = JSON.parse(new TextDecoder().decode(bytes));
  if (
    p.format !== "folio-project/1" ||
    typeof p.source?.base64 !== "string" ||
    typeof p.source?.name !== "string" ||
    p.source.base64.length > 1024 ** 3
  )
    throw Error("Folio 工程格式无效");
  const data = fromBase64(p.source.base64);
  if ((await digest(data)) !== p.source.sha256)
    throw Error("工程原件校验不一致");
  return {
    bytes: data,
    name: p.source.name,
    state: unpackState(p.state, new Map()),
  };
}

function projectJob(method, args) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./project-worker.mjs", import.meta.url),
      { type: "module" },
    );
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      finish();
      reject(Error("工程处理超时，已有文档未改变"));
    }, 120000);
    worker.onmessage = ({ data }) => {
      finish();
      data.error ? reject(Error(data.error)) : resolve(data.result);
    };
    worker.onerror = (e) => {
      finish();
      reject(Error(e.message || "工程处理失败"));
    };
    worker.postMessage({ method, args });
  });
}

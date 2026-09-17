const sources = new WeakMap();
export async function nativeRequest(data) {
  if (!window.desktop?.native) throw Error("此功能需要完整桌面运行包");
  if (
    !data.bytes ||
    !window.desktop.registerSource ||
    !["inspect", "layout", "apply", "flow-background", "table-render"].includes(
      data.command,
    )
  )
    return window.desktop.native(data);
  const bytes = data.bytes;
  let entry = sources.get(bytes);
  if (!entry) {
    entry = { promise: window.desktop.registerSource(bytes) };
    sources.set(bytes, entry);
  }
  let registered;
  try {
    registered = await entry.promise;
  } catch (e) {
    if (sources.get(bytes) === entry) sources.delete(bytes);
    throw e;
  }
  const { bytes: ignored, ...args } = data;
  return window.desktop.native({ ...args, sourceHandle: registered.handle });
}
export async function releaseSource(bytes) {
  const entry = bytes && sources.get(bytes);
  if (!entry) return;
  sources.delete(bytes);
  try {
    await window.desktop.releaseSource((await entry.promise).handle);
  } catch {}
}

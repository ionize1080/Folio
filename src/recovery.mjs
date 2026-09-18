import { digest, packState, unpackState } from "./portable-state.mjs";
const ocrCache = new WeakMap();
const BUDGET = 1024 * 1024 * 1024;
function open() {
  return new Promise((resolve, reject) => {
    const q = indexedDB.open("folio-recovery", 3);
    q.onupgradeneeded = () => {
      for (const n of ["session", "assets"])
        if (!q.result.objectStoreNames.contains(n))
          q.result.createObjectStore(n);
    };
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}
const request = (q) =>
  new Promise((resolve, reject) => {
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
export async function recoveryStore(value, sessionId = null) {
  let record, assets;
  if (value) {
    if (!value.bytes?.length) throw Error("草稿原文缺失，未覆盖已有恢复记录");
    const source = "source/" + (await digest(value.bytes)),
      packed = await packState(value.state);
    assets = new Map(packed.assets);
    assets.set(source, value.bytes);
    let ocrBytes = ocrCache.get(value.state.ocr);
    if (!ocrBytes) {
      ocrBytes = new TextEncoder().encode(JSON.stringify(packed.state.ocr));
      if (Object.isFrozen(value.state.ocr))
        ocrCache.set(value.state.ocr, ocrBytes);
    }
    const ocrKey = "ocr/" + (await digest(ocrBytes));
    assets.set(ocrKey, ocrBytes);
    record = {
      ...value,
      sessionId: value.sessionId || sessionId || source,
      bytes: undefined,
      assetVersion: 3,
      source,
      refs: [...assets.keys()],
      sizes: Object.fromEntries([...assets].map(([k, v]) => [k, v.byteLength])),
      state: { ...packed.state, ocr: [], ocrAsset: ocrKey },
    };
  }
  const db = await open();
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction(["session", "assets"], "readwrite"),
        ss = t.objectStore("session"),
        aa = t.objectStore("assets"),
        all = ss.getAll();
      all.onsuccess = () => {
        const existing = all.result;
        const id =
          record?.sessionId ||
          sessionId ||
          existing.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0]
            ?.sessionId ||
          "current";
        const retained = existing.filter(
          (r) => (r.sessionId || "current") !== id,
        );
        if (record) retained.push(record);
        const sizes = new Map();
        for (const r of retained)
          for (const [k, n] of Object.entries(r.sizes || {})) sizes.set(k, n);
        if ([...sizes.values()].reduce((a, b) => a + b, 0) > BUDGET) {
          t.abort();
          return;
        }
        if (record) {
          for (const [k, v] of assets) {
            const q = aa.getKey(k);
            q.onsuccess = () => {
              if (q.result === undefined) aa.put(v, k);
            };
          }
          ss.put(record, id);
        } else ss.delete(id);
        // Every retained session pins its required assets, independent of its age.
        const live = new Set(
          retained.flatMap((r) =>
            r.assetVersion === 3
              ? r.refs
              : r.assetVersion === 2
                ? ["document", "ocr"]
                : [],
          ),
        );
        const cursor = aa.openKeyCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) {
            if (!live.has(c.key)) aa.delete(c.key);
            c.continue();
          }
        };
      };
      t.oncomplete = resolve;
      t.onerror = t.onabort = () =>
        reject(
          Error(
            t.error?.name === "QuotaExceededError"
              ? "草稿空间不足，已保留上一份快照，请保存工程"
              : "草稿未写入或超过 1 GB 配额，已保留上一份快照，请保存工程",
          ),
        );
    });
  } finally {
    db.close();
  }
}
export async function recoveryList() {
  const db = await open();
  try {
    return (
      await request(db.transaction("session").objectStore("session").getAll())
    )
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      .map((r) => ({
        sessionId: r.sessionId || "current",
        name: r.name,
        savedAt: r.savedAt,
      }));
  } finally {
    db.close();
  }
}
export async function recoveryRead(sessionId = null) {
  const db = await open();
  try {
    const records = await request(
        db.transaction("session").objectStore("session").getAll(),
      ),
      r = sessionId
        ? records.find((x) => (x.sessionId || "current") === sessionId)
        : records.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
    if (!r) return null;
    const at = db.transaction("assets").objectStore("assets");
    if (r.assetVersion === 3) {
      const values = await Promise.all(r.refs.map((k) => request(at.get(k)))),
        assets = new Map(r.refs.map((k, i) => [k, values[i]]));
      if (values.some((v) => !v))
        throw Error("恢复资源不完整；已有快照保留，请重新选择原文件或恢复工程");
      r.bytes = assets.get(r.source);
      if ("source/" + (await digest(r.bytes)) !== r.source)
        throw Error("恢复原文校验失败");
      for (const [key, bytes] of assets)
        if (key.startsWith("assets/") || key.startsWith("ocr/")) {
          const h = await digest(bytes);
          if (!key.includes(h)) throw Error("恢复编辑资源校验失败");
        }
      r.state.ocr = JSON.parse(
        new TextDecoder().decode(assets.get(r.state.ocrAsset)),
      );
      delete r.state.ocrAsset;
      r.state = unpackState(r.state, assets);
    } else if (r.assetVersion === 2) {
      const [bytes, ocr] = await Promise.all([
        request(at.get("document")),
        request(at.get("ocr")),
      ]);
      r.bytes = bytes;
      r.state.ocr = ocr || [];
    }
    if (!r.bytes?.length) throw Error("恢复原文缺失，未打开空会话");
    return r;
  } finally {
    db.close();
  }
}

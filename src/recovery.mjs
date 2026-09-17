// Store large immutable assets once; bookmark changes only replace small metadata.
let lastBytes, lastOCR;
function open() {
  return new Promise((resolve, reject) => {
    const q = indexedDB.open("folio-recovery", 2);
    q.onupgradeneeded = () => {
      if (!q.result.objectStoreNames.contains("session"))
        q.result.createObjectStore("session");
      if (!q.result.objectStoreNames.contains("assets"))
        q.result.createObjectStore("assets");
    };
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}
export async function recoveryStore(value) {
  const db = await open();
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction(["session", "assets"], "readwrite"),
        s = t.objectStore("session"),
        a = t.objectStore("assets");
      if (!value) {
        s.delete("current");
        a.clear();
      } else {
        if (value.bytes !== lastBytes) a.put(value.bytes, "document");
        if (value.state.ocr !== lastOCR) a.put(value.state.ocr, "ocr");
        s.put(
          {
            ...value,
            bytes: undefined,
            assetVersion: 2,
            state: { ...value.state, ocr: undefined, ocrReference: null },
          },
          "current",
        );
      }
      t.oncomplete = () => {
        lastBytes = value?.bytes;
        lastOCR = value?.state.ocr;
        resolve();
      };
      t.onerror = t.onabort = () =>
        reject(t.error || Error("恢复快照事务已取消"));
    });
  } finally {
    db.close();
  }
}
export async function recoveryRead() {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(["session", "assets"]),
        q = t.objectStore("session").get("current");
      const doc = t.objectStore("assets").get("document"),
        ocr = t.objectStore("assets").get("ocr");
      t.oncomplete = () => {
        const v = q.result;
        if (v?.assetVersion === 2) {
          v.bytes = doc.result;
          v.state.ocr = ocr.result || [];
        }
        resolve(v);
      };
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

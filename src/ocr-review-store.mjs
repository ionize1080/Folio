const open = () =>
  new Promise((resolve, reject) => {
    const r = indexedDB.open("folio-ocr-review", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("pages");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export async function readReview(key) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("pages"),
        s = tx.objectStore("pages"),
        r = s.getAll(
          IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]),
        );
      r.onsuccess = () =>
        resolve(new Map(r.result.map((v) => [v.page, v.blocks])));
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function writeReview(key, page, blocks) {
  const db = await open();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("pages", "readwrite"),
        s = tx.objectStore("pages");
      if (blocks === null) s.delete([key, page]);
      else s.put({ page, blocks }, [key, page]);
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () =>
        reject(tx.error || Error("校对草稿保存失败"));
    });
  } finally {
    db.close();
  }
}

const { makeTemp } = require("./temp-store.cjs");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
// Handles never expose filesystem paths. A leased source survives document close.
class SourceStore {
  constructor() {
    this.entries = new Map();
    this.root = null;
    this.rootPromise = null;
    this.registering = 0;
    this.generation = 0;
    this.pendingRegistrations = new Set();
    this.closed = false;
  }
  async register(bytes) {
    if (this.closed) throw Error("原文缓存已关闭");
    if (
      !bytes ||
      !Number.isSafeInteger(bytes.length) ||
      bytes.length < 5 ||
      bytes.length > 768 * 1024 ** 2
    )
      throw Error("原文大小无效");
    if (this.entries.size + this.registering >= 16)
      throw Error("打开的原文过多，请关闭文档后重试");
    const generation = this.generation;
    let finish, file;
    const pending = new Promise((resolve) => (finish = resolve));
    this.pendingRegistrations.add(pending);
    this.registering++;
    try {
      const data = Buffer.from(bytes),
        hash = crypto.createHash("sha256").update(data).digest("hex"),
        handle = crypto.randomUUID();
      if (!this.rootPromise)
        this.rootPromise = makeTemp("folio-source-").then(
          (p) => (this.root = p),
        );
      const root = await this.rootPromise;
      if (generation !== this.generation)
        throw Error("页面已重新加载，请重新打开文档");
      file = path.join(root, handle + ".pdf");
      await fs.writeFile(file, data, { mode: 0o600 });
      if (generation !== this.generation)
        throw Error("页面已重新加载，请重新打开文档");
      this.entries.set(handle, {
        file,
        hash,
        size: data.length,
        leases: 0,
        released: false,
      });
      return { handle, sha256: hash, size: data.length };
    } catch (error) {
      if (file) await fs.rm(file, { force: true }).catch(() => {});
      throw error;
    } finally {
      this.registering--;
      this.pendingRegistrations.delete(pending);
      finish();
    }
  }
  acquire(handle) {
    const entry = this.entries.get(handle);
    if (!entry || entry.released) throw Error("原文句柄已失效，请重新打开文档");
    entry.leases++;
    let done = false;
    return {
      ...entry,
      release: async () => {
        if (done) return;
        done = true;
        entry.leases--;
        await this.collect(handle);
      },
    };
  }
  async release(handle) {
    const e = this.entries.get(handle);
    if (e) e.released = true;
    await this.collect(handle);
  }
  async collect(handle) {
    const e = this.entries.get(handle);
    if (e?.released && !e.leases) {
      this.entries.delete(handle);
      await fs.rm(e.file, { force: true }).catch(() => {});
    }
  }
  async clear() {
    // A committed renderer navigation loses every JS-side handle. Invalidate
    // pending writes too, while keeping the directory reusable by the new page.
    this.generation++;
    const handles = [...this.entries.keys()];
    await Promise.all(handles.map((id) => this.release(id)));
  }
  async close() {
    // Terminal shutdown only; renderer reloads use clear().
    this.closed = true;
    await this.clear();
    await Promise.all([...this.pendingRegistrations]);
    if (!this.entries.size && this.root)
      await fs.rm(this.root, { recursive: true, force: true });
  }
}
module.exports = { SourceStore };

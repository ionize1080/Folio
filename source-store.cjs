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
  }
  async register(bytes) {
    if (
      !bytes ||
      !Number.isSafeInteger(bytes.length) ||
      bytes.length < 5 ||
      bytes.length > 768 * 1024 ** 2
    )
      throw Error("原文大小无效");
    if (this.entries.size + this.registering >= 16)
      throw Error("打开的原文过多，请关闭文档后重试");
    this.registering++;
    try {
      const data = Buffer.from(bytes),
        hash = crypto.createHash("sha256").update(data).digest("hex"),
        handle = crypto.randomUUID();
      if (!this.rootPromise)
        this.rootPromise = makeTemp("folio-source-").then(
          (p) => (this.root = p),
        );
      const root = await this.rootPromise,
        file = path.join(root, handle + ".pdf");
      await fs.writeFile(file, data, { mode: 0o600 });
      this.entries.set(handle, {
        file,
        hash,
        size: data.length,
        leases: 0,
        released: false,
      });
      return { handle, sha256: hash, size: data.length };
    } finally {
      this.registering--;
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
  async close() {
    for (const id of [...this.entries.keys()]) await this.release(id);
    if (!this.entries.size && this.root)
      await fs.rm(this.root, { recursive: true, force: true });
  }
}
module.exports = { SourceStore };

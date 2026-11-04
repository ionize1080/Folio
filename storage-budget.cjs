const fs = require("node:fs/promises"),
  path = require("node:path");
const DEFAULT_LIMIT_MB = 2048;
// Only files registered by trusted producers are eligible for eviction. Active
// source/atomic-write leases are counted but never removed to satisfy a quota.
class StorageBudget {
  constructor(limitMB = DEFAULT_LIMIT_MB) {
    this.limitMB = limitMB;
    this.entries = new Map();
    this.chain = Promise.resolve();
    this.serial = 0;
  }
  get limit() {
    return this.limitMB * 1024 ** 2;
  }
  async configure(file) {
    this.configFile = file;
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      this.validate(data.limitMB);
      this.limitMB = data.limitMB;
    } catch {}
    return this.status();
  }
  validate(value) {
    if (!Number.isInteger(value) || value < 64 || value > 262144)
      throw Error("磁盘上限应为64至262144 MB");
  }
  async setLimit(value) {
    this.validate(value);
    if (this.configFile) {
      await fs.mkdir(path.dirname(this.configFile), { recursive: true });
      const tmp = this.configFile + ".tmp";
      await fs.writeFile(tmp, JSON.stringify({ limitMB: value }), {
        mode: 0o600,
      });
      await fs.rename(tmp, this.configFile);
    }
    this.limitMB = value;
    await this.trim();
    return this.status();
  }
  status() {
    let bytes = 0,
      pinnedBytes = 0;
    for (const e of this.entries.values()) {
      bytes += e.bytes;
      if (e.pins) pinnedBytes += e.bytes;
    }
    return {
      limitMB: this.limitMB,
      bytes,
      pinnedBytes,
      effectiveLimitBytes: Math.max(this.limit, pinnedBytes),
      temporaryOverage: Math.max(0, pinnedBytes - this.limit),
    };
  }
  async add(file, { pinned = false, onEvict } = {}) {
    const resolved = path.resolve(file),
      stat = await fs.lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error("Invalid cache file");
    this.entries.set(resolved, {
      bytes: stat.size,
      pins: pinned ? 1 : 0,
      time: ++this.serial,
      onEvict,
    });
    await this.trim();
    return this.entries.has(resolved);
  }
  touch(file) {
    const e = this.entries.get(path.resolve(file));
    if (e) e.time = ++this.serial;
  }
  forget(file) {
    this.entries.delete(path.resolve(file));
  }
  async unpin(file) {
    const e = this.entries.get(path.resolve(file));
    if (e && e.pins) e.pins--;
    return this.trim();
  }
  lease(files) {
    const owned = [];
    for (const f of files) {
      const e = this.entries.get(path.resolve(f));
      if (e) {
        e.pins++;
        e.time = ++this.serial;
        owned.push(e);
      }
    }
    let done = false;
    return async () => {
      if (done) return;
      done = true;
      for (const e of owned) e.pins--;
      await this.trim();
    };
  }
  trim() {
    const job = this.chain.then(async () => {
      let { bytes, pinnedBytes } = this.status();
      const effective = Math.max(this.limit, pinnedBytes);
      let removed = 0;
      for (const [file, e] of [...this.entries].sort(
        (a, b) => a[1].time - b[1].time,
      )) {
        if (bytes <= effective) break;
        if (e.pins) continue;
        try {
          await fs.unlink(file);
          this.entries.delete(file);
          e.onEvict?.();
          bytes -= e.bytes;
          removed += e.bytes;
        } catch (error) {
          if (error.code === "ENOENT") {
            this.entries.delete(file);
            bytes -= e.bytes;
          }
        }
      }
      return { removed, ...this.status() };
    });
    this.chain = job.catch(() => {});
    return job;
  }
}
const storageBudget = new StorageBudget();
module.exports = { StorageBudget, storageBudget, DEFAULT_LIMIT_MB };

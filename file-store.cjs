const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
// Renderer receives opaque capabilities, never arbitrary writable filesystem paths.
class FileStore {
  constructor(pick, replace = fs.rename) {
    this.replace = replace;
    this.pick = pick;
    this.handles = new Map();
    this.tickets = new Map();
  }
  grant(file) {
    const id = crypto.randomUUID();
    this.handles.set(id, path.resolve(file));
    return id;
  }
  async prepare({
    name,
    kind,
    handle,
    forceAs = false,
    protect = true,
    working = false,
  }) {
    if (
      typeof name !== "string" ||
      name.length > 260 ||
      !["pdf", "json", "txt", "png", "html", "md", "folio", "csv", "xlsx"].includes(kind)
    )
      throw Error("Invalid save request");
    let file =
      kind === "pdf" && handle && !forceAs && (!protect || working)
        ? this.handles.get(handle)
        : null;
    if (!file) {
      file = await this.pick(path.basename(name), kind);
      if (!file) return null;
    }
    if (
      kind === "pdf" &&
      protect &&
      !working &&
      handle &&
      path.resolve(file).toLowerCase() ===
        this.handles.get(handle)?.toLowerCase()
    )
      throw Error("原文件保护已开启，请选择不同的副本文件名");
    const ticket = crypto.randomUUID();
    for (const [id, v] of this.tickets)
      if (Date.now() - v.time > 3600000) this.tickets.delete(id);
    this.tickets.set(ticket, { file, kind, time: Date.now() });
    return { ticket, name: path.basename(file) };
  }
  async save(options) {
    const { bytes, kind } = options;
    const prepared = options.ticket || (await this.prepare(options));
    if (!prepared) return null;
    const id = prepared.ticket,
      grant = this.tickets.get(id);
    if (!grant || grant.kind !== kind || Date.now() - grant.time > 3600000)
      throw Error("保存位置已失效，请重新选择");
    this.tickets.delete(id);
    const file = grant.file;
    // Flush a same-directory temporary file before replacing. Failed replacement leaves original intact.
    const tmp = file + ".folio-" + crypto.randomUUID() + ".tmp";
    let f;
    try {
      f = await fs.open(tmp, "wx");
      await f.writeFile(Buffer.from(bytes));
      await f.sync();
      await f.close();
      f = null;
      await this.replace(tmp, file);
    } catch (err) {
      await f?.close().catch(() => {});
      await fs.unlink(tmp).catch(() => {});
      const labels = {
        EPERM: "目标文件只读、被占用或没有替换权限",
        EACCES: "没有目标目录的写入权限",
        EBUSY: "目标文件被占用",
        ENOSPC: "磁盘空间不足",
      };
      throw Error(
        `保存 ${path.basename(file)} 失败：${labels[err.code] || err.message}`,
      );
    }
    return {
      name: path.basename(file),
      handle: this.grant(file),
      working: true,
    };
  }
}
module.exports = { FileStore };

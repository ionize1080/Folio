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
    this.streams = new Map();
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
      ![
        "pdf",
        "json",
        "txt",
        "png",
        "html",
        "md",
        "folio",
        "csv",
        "xlsx",
      ].includes(kind)
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
  async beginStream({ ticket, kind, total }) {
    const grant = this.tickets.get(ticket?.ticket);
    if (
      !grant ||
      grant.kind !== kind ||
      Date.now() - grant.time > 3600000 ||
      !Number.isSafeInteger(total) ||
      total < 0 ||
      total > 1024 ** 3
    )
      throw Error("保存位置或文件大小无效");
    for (const [id, entry] of this.streams)
      if (Date.now() - entry.time > 3600000) await this.abortStream(id);
    if (this.streams.size >= 2) throw Error("已有文件正在写入");
    this.tickets.delete(ticket.ticket);
    const id = crypto.randomUUID(),
      tmp = grant.file + ".folio-" + id + ".tmp",
      f = await fs.open(tmp, "wx");
    this.streams.set(id, {
      f,
      tmp,
      file: grant.file,
      total,
      offset: 0,
      time: Date.now(),
    });
    return id;
  }
  async appendStream({ id, offset, bytes }) {
    const e = this.streams.get(id);
    if (
      !e ||
      e.writing ||
      offset !== e.offset ||
      !bytes ||
      bytes.length > 4 * 1024 ** 2 ||
      e.offset + bytes.length > e.total
    )
      throw Error("文件写入序列无效");
    e.writing = true;
    try {
      await e.f.writeFile(Buffer.from(bytes));
      e.offset += bytes.length;
      e.time = Date.now();
      return e.offset;
    } catch (err) {
      await this.abortStream(id);
      throw err;
    } finally {
      e.writing = false;
    }
  }
  async finishStream(id) {
    const e = this.streams.get(id);
    if (!e || e.writing || e.offset !== e.total)
      throw Error("文件尚未完整写入");
    e.writing = true;
    try {
      await e.f.sync();
      await e.f.close();
      await this.replace(e.tmp, e.file);
      this.streams.delete(id);
      return {
        name: path.basename(e.file),
        handle: this.grant(e.file),
        working: true,
      };
    } catch (err) {
      await this.abortStream(id);
      throw Error("保存 " + path.basename(e.file) + " 失败：" + err.message);
    }
  }
  async abortStream(id) {
    const e = this.streams.get(id);
    if (e) {
      this.streams.delete(id);
      await e.f.close().catch(() => {});
      await fs.rm(e.tmp, { force: true }).catch(() => {});
    }
  }
  async close() {
    for (const id of [...this.streams.keys()]) await this.abortStream(id);
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

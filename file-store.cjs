const { storageBudget } = require("./storage-budget.cjs");
const fs = require("node:fs/promises"),
  syncFS = require("node:fs"),
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
    this.versions = new Map();
  }
  grant(file, bytes) {
    const id = crypto.randomUUID();
    file = path.resolve(file);
    this.handles.set(id, file);
    if (bytes || !this.versions.has(file)) {
      // Opening IPC supplies the bytes already read, avoiding another full read.
      const stat = syncFS.statSync(file);
      const hash = crypto.createHash("sha256");
      if (bytes) hash.update(bytes);
      else {
        const fd = syncFS.openSync(file, "r"),
          chunk = Buffer.alloc(1024 * 1024);
        try {
          let n;
          while ((n = syncFS.readSync(fd, chunk)))
            hash.update(chunk.subarray(0, n));
        } finally {
          syncFS.closeSync(fd);
        }
      }
      this.versions.set(file, {
        identity: this.identity(stat),
        sha256: hash.digest("hex"),
      });
    }
    return id;
  }
  identity(s) {
    return [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(":");
  }
  async version(file,onProgress) {
    let f;
    try {
      f = await fs.open(file, "r");
      const stat=await f.stat(),before = this.identity(stat),
        hash = crypto.createHash("sha256");
      const chunk = Buffer.alloc(1024 * 1024);
      let n,total=0;
      while ((n = (await f.read(chunk)).bytesRead)){
        hash.update(chunk.subarray(0, n));total+=n;
        if(total%(8*1024**2)===0||total===stat.size)onProgress?.({stage:'校验原文件',completed:total,total:stat.size});
      }
      if (before !== this.identity(await f.stat()))
        throw Error("文件正在被其他程序修改，请另存副本");
      const value={identity:before,sha256:hash.copy().digest('hex')};
      Object.defineProperty(value,'hashState',{value:hash});return value;
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    } finally {
      await f?.close();
    }
  }
  async checkVersion(file, expected,onProgress) {
    const actual=await this.version(file,onProgress);
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw Error(
        "目标文件已被其他程序修改、替换或删除。请另存副本，或重新打开文件后再保存。",
      );
    return actual;
  }
  async savedVersion(file, sha256) {
    this.versions.set(file, {
      identity: this.identity(await fs.stat(file)),
      sha256,
    });
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
        "docx",
        "zip",
        "xml",
        "ttf",
        "otf",
      ].includes(kind)
    )
      throw Error("Invalid save request");
    let file =
      kind === "pdf" && handle && !forceAs && (!protect || working)
        ? this.handles.get(handle)
        : null;
    const reuse = !!file;
    if (!file) {
      file = await this.pick(path.basename(name), kind);
      if (!file) return null;
    }
    file = path.resolve(file);
    const expected = reuse ? this.versions.get(file) : await this.version(file);
    // Full content verification happens immediately before writing. Checking a
    // second time here doubled disk reads on every incremental save.
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
    this.tickets.set(ticket, { file, kind, expected, time: Date.now() });
    return { ticket, name: path.basename(file), baseHash: expected?.sha256 };
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
      expected: grant.expected,
      hash: crypto.createHash("sha256"),
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
      await storageBudget.add(e.tmp, { pinned: true });
      e.hash.update(Buffer.from(bytes));
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
      await this.checkVersion(e.file, e.expected);
      await this.replace(e.tmp, e.file);
      storageBudget.forget(e.tmp);
      await storageBudget.trim();
      await this.savedVersion(e.file, e.hash.digest("hex"));
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
      storageBudget.forget(e.tmp);
      await storageBudget.trim();
    }
  }
  async close() {
    for (const id of [...this.streams.keys()]) await this.abortStream(id);
  }
  async save(options,onProgress) {
    const { bytes, kind } = options;
    if (
      !bytes ||
      !Number.isSafeInteger(bytes.length) ||
      bytes.length > 1024 ** 3
    )
      throw Error("保存文件大小无效");
    const prepared = options.ticket || (await this.prepare(options));
    if (!prepared) return null;
    const id = prepared.ticket,
      grant = this.tickets.get(id);
    if (!grant || grant.kind !== kind || Date.now() - grant.time > 3600000)
      throw Error("保存位置已失效，请重新选择");
    this.tickets.delete(id);
    const file = grant.file;
    if(options.append){
      if(kind!=='pdf'||!Number.isSafeInteger(options.baseLength)||options.baseLength<1||options.baseHash!==grant.expected?.sha256)
        throw Error('增量保存的原文件版本不匹配，请重新保存');
      const checked=await this.checkVersion(file,grant.expected,onProgress);
      let handle,started=false;
      try{
        handle=await fs.open(file,'r+');
        const stat=await handle.stat();
        if(stat.size!==options.baseLength||this.identity(stat)!==checked.identity)throw Error('文件已被修改，请另存副本');
        let at=0;started=true;
        const chunk=Buffer.from(bytes);
        while(at<chunk.length){const {bytesWritten}=await handle.write(chunk,at,Math.min(4*1024**2,chunk.length-at),options.baseLength+at);if(!bytesWritten)throw Error('增量写入中断');at+=bytesWritten;onProgress?.({stage:'写入修改',completed:at,total:chunk.length});}
        await handle.sync();await handle.close();handle=null;
        await this.savedVersion(file,checked.hashState.update(chunk).digest('hex'));
        return {name:path.basename(file),handle:this.grant(file),working:true,sha256:this.versions.get(file).sha256,incremental:true};
      }catch(err){if(handle&&started){await handle.truncate(options.baseLength);await handle.sync();}throw err;}
      finally{await handle?.close();}
    }
    // Flush a same-directory temporary file before replacing. Failed replacement leaves original intact.
    const tmp = file + ".folio-" + crypto.randomUUID() + ".tmp";
    let f;
    try {
      f = await fs.open(tmp, "wx");
      const data=Buffer.from(bytes);
      for(let at=0;at<data.length;){const {bytesWritten}=await f.write(data,at,Math.min(4*1024**2,data.length-at),at);if(!bytesWritten)throw Error('文件写入中断');at+=bytesWritten;onProgress?.({stage:'写入文件',completed:at,total:data.length});}
      await f.sync();
      await f.close();
      f = null;
      await storageBudget.add(tmp, { pinned: true });
      await this.checkVersion(file, grant.expected,onProgress);
      await this.replace(tmp, file);
      await this.savedVersion(
        file,
        crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
      );
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
    } finally {
      storageBudget.forget(tmp);
      await storageBudget.trim();
    }
    return {
      name: path.basename(file),
      handle: this.grant(file),
      working: true,
      sha256: this.versions.get(file).sha256,
    };
  }
}
module.exports = { FileStore };

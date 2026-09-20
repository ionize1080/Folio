const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { NativeBridge } = require("./native-bridge.cjs");
const MAX_SIZE = 8 * 1024 ** 3;
class LargeFiles {
  constructor(root, python, pick) {
    this.bridge = new NativeBridge(root, python);
    this.writer = new NativeBridge(root, python);
    this.pick = pick;
    this.entries = new Map();
    this.saving = false;
  }
  async register(file) {
    if (this.entries.size >= 2) throw Error("请先关闭已打开的大文件工作区");
    const f = await fs.open(file, "r");
    try {
      const stat = await f.stat();
      if (!stat.isFile() || stat.size < 5 || stat.size > MAX_SIZE)
        throw Error("大文件通道当前支持至 8 GiB，尚需按实际文档验收");
      const head = Buffer.alloc(5);
      await f.read(head, 0, 5, 0);
      if (head.toString() !== "%PDF-") throw Error("不是有效的 PDF 文件");
      const handle = crypto.randomUUID();
      this.entries.set(handle, { f, file, stat, password: "" });
      return {
        large: true,
        handle,
        name: path.basename(file),
        size: stat.size,
      };
    } catch (e) {
      await f.close();
      throw e;
    }
  }
  async entry(handle) {
    const e = this.entries.get(handle);
    if (!e) throw Error("文件句柄已失效");
    const s = await fs.stat(e.file);
    if (
      s.size !== e.stat.size ||
      s.mtimeMs !== e.stat.mtimeMs ||
      s.ino !== e.stat.ino
    )
      throw Error("原件已被其他程序修改，请重新打开");
    return e;
  }
  async read({ handle, offset, length }) {
    const e = await this.entry(handle);
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 1 ||
      length > 4 * 1024 ** 2 ||
      offset + length > e.stat.size
    )
      throw Error("读取范围无效");
    const bytes = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const r = await e.f.read(bytes, done, length - done, offset + done);
      if (!r.bytesRead) throw Error("文件意外结束");
      done += r.bytesRead;
    }
    await this.entry(handle);
    return bytes;
  }
  async info({ handle, password = "" }) {
    const e = await this.entry(handle);
    if (typeof password !== "string" || password.length > 4096)
      throw Error("密码格式无效");
    const result = await this.bridge.request({
      command: "large-info",
      input: e.file,
      password,
    });
    e.password = password;
    return result;
  }
  async page({ handle, page, scale = 1.5, textOnly = false }) {
    const e = await this.entry(handle);
    if (!textOnly) this.bridge.cancel();
    const result = await this.bridge.request({
      command: textOnly ? "large-text" : "large-page",
      input: e.file,
      password: e.password,
      page,
      scale,
    });
    await this.entry(handle);
    return result;
  }
  async save({ handle, outlines }) {
    if (this.saving) throw Error("已有保存任务");
    this.saving = true;
    let tmp;
    try {
      const e = await this.entry(handle);
      const target = await this.pick(
        path.basename(e.file).replace(/\.pdf$/i, "-bookmarks.pdf"),
      );
      if (!target) return { cancelled: true };
      if (
        path.resolve(target).toLowerCase() ===
        path.resolve(e.file).toLowerCase()
      )
        throw Error("大文件工作区请另存副本，保留原件");
      tmp = target + ".folio-" + crypto.randomUUID() + ".tmp";
      const reservation = await fs.open(tmp, "wx");
      await reservation.close();
      const result = await this.writer.request({
        command: "large-save",
        input: e.file,
        output: tmp,
        password: e.password,
        outlines,
      });
      await this.entry(handle);
      const f = await fs.open(tmp, "r+");
      try {
        await f.sync();
      } finally {
        await f.close();
      }
      if (process.platform === "win32") await this.writer.replace(tmp, target);
      else await fs.rename(tmp, target);
      tmp = null;
      return { ...result, name: path.basename(target) };
    } finally {
      if (tmp) await fs.rm(tmp, { force: true }).catch(() => {});
      this.saving = false;
    }
  }
  cancel() {
    this.bridge.cancel();
    this.writer.cancel();
  }
  async release(handle) {
    if (this.saving) throw Error("请先等待保存或取消完成");
    const e = this.entries.get(handle);
    if (e) {
      this.entries.delete(handle);
      e.password = "";
      await e.f.close();
    }
  }
  async close() {
    this.cancel();
    for (const e of this.entries.values()) await e.f.close();
    this.entries.clear();
  }
}
module.exports = { LargeFiles, MAX_SIZE };

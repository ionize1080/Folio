const { makeTemp } = require("./temp-store.cjs");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  { spawn } = require("node:child_process"),
  { StringDecoder } = require("node:string_decoder");
class NativeBridge {
  constructor(root, python, sources = null, deadlines = {}) {
    this.sources = sources;
    this.deadlines = deadlines;
    this.sequence = 0;
    this.epoch = 0;
    this.backgroundCache = new Map();
    this.root = root;
    this.python =
      python ||
      (process.platform === "win32"
        ? path.join(root, "runtime/python.exe")
        : "python");
    this.queue = Promise.resolve();
    this.process = null;
    this.pending = null;
    this.cache = new Map();
    this.cacheRoot = null;
  }
  start() {
    if (this.process) return;
    const child = spawn(
      this.python,
      ["-u", path.join(this.root, "worker.py")],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUTF8: "1", PYTHONNOUSERSITE: "1" },
      },
    );
    this.process = child;
    let details = "";
    child.stderr.on("data", (b) => (details = (details + b).slice(-16000)));
    const fail = (e) => {
      if (this.process !== child) return;
      this.process = null;
      this.epoch++;
      const pending = this.pending;
      this.pending = null;
      pending?.reject(e);
      child.kill();
    };
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      if (this.process !== child) return;
      buffer += decoder.write(chunk);
      if (buffer.length > 128 * 1024 ** 2)
        return fail(Error("本地引擎响应超过预算"));
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        const p = this.pending;
        try {
          const m = JSON.parse(line);
          if (!p || m.requestId !== p.requestId || m.epoch !== p.epoch)
            throw Error("请求标识不匹配");
          const kind = ["progress", "result", "error"].filter((k) =>
            Object.hasOwn(m, k),
          );
          if (kind.length !== 1) throw Error("响应类型无效");
          if (kind[0] === "progress") {
            p.onProgress?.(m.progress);
            continue;
          }
          this.pending = null;
          kind[0] === "error"
            ? p.reject(Error(String(m.error)))
            : p.resolve(m.result);
        } catch (e) {
          fail(Error("本地引擎协议失效，已重启隔离：" + e.message));
          return;
        }
      }
    });
    child.on("error", () => fail(Error("无法启动本地引擎，请完整解压运行包")));
    child.on("exit", (code) =>
      fail(
        Error(
          code === null
            ? "任务已取消"
            : "本地引擎退出：" + details.slice(-4000),
        ),
      ),
    );
  }
  request(args, onProgress) {
    const epoch = this.epoch;
    const job = () =>
      new Promise((resolve, reject) => {
        if (epoch !== this.epoch) return reject(Error("任务已取消"));
        this.start();
        const context = `${args.command}${args.page ? " · 第 " + args.page + " 页" : ""}`;
        const requestId = ++this.sequence;
        const limit =
          this.deadlines[args.command] ??
          ({
            apply: 900000,
            ocr: 900000,
            layout: 600000,
            "flow-background": 900000,
            "image-preview": 300000,
          }[args.command] ||
            300000);
        let timer;
        const finish = (fn, value) => {
          clearTimeout(timer);
          fn(value);
        };
        const pending = (this.pending = {
          requestId,
          epoch,
          resolve: (value) => finish(resolve, value),
          reject: (e) =>
            finish(
              reject,
              Object.assign(Error(context + "：" + e.message), { cause: e }),
            ),
          onProgress,
        });
        timer = setTimeout(() => {
          if (this.pending !== pending) return;
          this.pending = null;
          pending.reject(
            Error("本地任务超时，已停止工作进程；可重试，草稿仍保留"),
          );
          this.cancel();
        }, limit);
        this.process.stdin.write(
          JSON.stringify({ ...args, requestId, epoch }) + "\n",
          (e) => {
            if (e && this.pending === pending) {
              this.pending = null;
              pending.reject(e);
            }
          },
        );
      });
    const p = this.queue.then(job, job);
    this.queue = p.catch(() => {});
    return p;
  }
  async run({ command, bytes, sourceHandle, ...options }, onProgress) {
    if (command === "table-export")
      return this.request({
        command,
        table: options.table,
        format: options.format,
      });
    if (
      [
        "font-catalog",
        "font-select",
        "font-data",
        "font-recommend",
        "font-fast",
      ].includes(command)
    ) {
      // These requests do not depend on the document. Avoid writing a full PDF
      // to a temporary directory for every font name in the chooser.
      return this.request({
        command,
        fontId: options.fontId,
        fontKey: options.fontKey,
        previewText: options.previewText,
        missing: options.missing,
        sample: options.sample,
      });
    }
    if (
      ![
        "inspect",
        "image-preview",
        "apply",
        "ocr",
        "layout",
        "flow-background",
        "font-catalog",
        "font-select",
        "font-data",
        "table-render",
        "qpdf-status",
        "qpdf-decrypt",
      ].includes(command) ||
      (!bytes && !sourceHandle) ||
      (bytes && bytes.length > 768 * 1024 * 1024)
    )
      throw Error("本地请求无效");
    const source = sourceHandle ? this.sources?.acquire(sourceHandle) : null;
    if (sourceHandle && !source) throw Error("原文句柄无效");
    try {
      const key = ["apply", "flow-background"].includes(command)
        ? crypto
            .createHash("sha256")
            .update(source ? source.hash : Buffer.from(bytes))
            .update(JSON.stringify(options))
            .digest("hex")
        : null;
      if (command === "flow-background" && this.backgroundCache.has(key))
        return this.backgroundCache.get(key);
      if (command === "apply" && this.cache.has(key)) {
        const entry = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, entry);
        try {
          onProgress?.({ stage: "cache", message: "复用已构建内容" });
          return { bytes: await fs.readFile(entry), cached: true };
        } catch {
          this.cache.delete(key);
        }
      }
      const dir = await makeTemp("folio-native-");
      try {
        const input = source ? source.file : path.join(dir, "input.pdf"),
          output = path.join(dir, "output.pdf");
        if (!source) await fs.writeFile(input, Buffer.from(bytes));
        const args = { ...options, command, input };
        for (const key of ["resolvedForms", "requestId", "epoch", "bytes"])
          delete args[key];
        delete args.source;
        delete args.target;
        if (["apply", "qpdf-decrypt"].includes(command)) args.output = output;
        else delete args.output;
        const result = await this.request(
          { ...args, progress: !!onProgress },
          onProgress,
        );
        if (command === "qpdf-decrypt")
          return result.needsPassword
            ? result
            : { ...result, bytes: await fs.readFile(output) };
        if (command === "apply") {
          if (!this.cacheRoot)
            this.cacheRoot = await makeTemp("folio-content-cache-");
          const file = path.join(this.cacheRoot, key + ".pdf");
          await fs.copyFile(output, file);
          this.cache.set(key, file);
          while (this.cache.size > 2) {
            const [old, oldfile] = this.cache.entries().next().value;
            this.cache.delete(old);
            await fs.rm(oldfile, { force: true }).catch(() => {});
          }
          return { bytes: await fs.readFile(output), cached: false };
        }
        if (command === "flow-background") {
          this.backgroundCache.set(key, result);
          let total = [...this.backgroundCache.values()].reduce(
            (n, r) => n + (r.pdf?.length || 0) * 2,
            0,
          );
          while (this.backgroundCache.size > 4 || total > 64 * 1024 ** 2) {
            const [k, v] = this.backgroundCache.entries().next().value;
            this.backgroundCache.delete(k);
            total -= (v.pdf?.length || 0) * 2;
          }
        }
        return result;
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    } finally {
      await source?.release();
    }
  }
  async clearCache() {
    this.cache.clear();
    this.backgroundCache.clear();
    if (this.cacheRoot)
      await fs
        .rm(this.cacheRoot, { recursive: true, force: true })
        .catch(() => {});
    this.cacheRoot = null;
  }
  replace(source, target) {
    return this.request({ command: "replace", source, target });
  }
  cancel() {
    this.epoch++;
    const child = this.process;
    this.process = null;
    this.pending?.reject(Error("任务已取消"));
    this.pending = null;
    child?.kill();
  }
}
module.exports = { NativeBridge };

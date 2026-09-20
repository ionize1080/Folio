const { makeTemp } = require("./temp-store.cjs");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  { spawn } = require("node:child_process"),
  readline = require("node:readline");
class NativeBridge {
  constructor(root, python, sources = null) {
    this.sources = sources;
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
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      if (this.process !== child || !this.pending) return;
      const p = this.pending;
      try {
        const m = JSON.parse(line);
        if (m.progress) {
          p.onProgress?.(m.progress);
          return;
        }
        this.pending = null;
        m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
      } catch {
        this.pending = null;
        p.reject(Error("本地引擎返回无效结果"));
      }
    });
    const fail = (e) => {
      if (this.process !== child) return;
      this.process = null;
      this.pending?.reject(e);
      this.pending = null;
    };
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
        const pending = (this.pending = {
          resolve,
          reject: (e) =>
            reject(
              Object.assign(Error(context + "：" + e.message), { cause: e }),
            ),
          onProgress,
        });
        this.process.stdin.write(JSON.stringify(args) + "\n", (e) => {
          if (e && this.pending === pending) {
            this.pending = null;
            pending.reject(e);
          }
        });
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
      ["font-catalog", "font-select", "font-data", "font-recommend", "font-fast"].includes(
        command,
      )
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

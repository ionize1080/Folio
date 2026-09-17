const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  { spawn } = require("node:child_process"),
  readline = require("node:readline");
class NativeBridge {
  constructor(root, python) {
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
    child.stderr.on("data", (b) => (details = (details + b).slice(-2000)));
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
          code === null ? "任务已取消" : "本地引擎退出：" + details.slice(-500),
        ),
      ),
    );
  }
  request(args, onProgress) {
    const job = () =>
      new Promise((resolve, reject) => {
        this.start();
        this.pending = { resolve, reject, onProgress };
        this.process.stdin.write(JSON.stringify(args) + "\n", (e) => {
          if (e) {
            this.pending = null;
            reject(e);
          }
        });
      });
    const p = this.queue.then(job, job);
    this.queue = p.catch(() => {});
    return p;
  }
  async run({ command, bytes, ...options }, onProgress) {
    if (command === "table-export") return this.request({command,table:options.table,format:options.format});
    if (["font-catalog", "font-select", "font-data", "font-recommend"].includes(command)) {
      // These requests do not depend on the document. Avoid writing a full PDF
      // to a temporary directory for every font name in the chooser.
      return this.request({ command, fontId: options.fontId,
        fontKey: options.fontKey, previewText: options.previewText, missing:options.missing, sample:options.sample });
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
        "qpdf-status", "qpdf-decrypt",
      ].includes(command) ||
      !bytes ||
      bytes.length > 768 * 1024 * 1024
    )
      throw Error("本地请求无效");
    const key =
      command === "apply"
        ? crypto
            .createHash("sha256")
            .update(Buffer.from(bytes))
            .update(JSON.stringify(options))
            .digest("hex")
        : null;
    if (key && this.cache.has(key)) {
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-native-"));
    try {
      const input = path.join(dir, "input.pdf"),
        output = path.join(dir, "output.pdf");
      await fs.writeFile(input, Buffer.from(bytes));
      const args = { ...options, command, input };
      delete args.source;
      delete args.target;
      if (["apply", "qpdf-decrypt"].includes(command)) args.output = output;
      else delete args.output;
      const result = await this.request(
        { ...args, progress: !!onProgress },
        onProgress,
      );
      if (command === "qpdf-decrypt") return result.needsPassword ? result : { ...result, bytes: await fs.readFile(output) };
      if (command === "apply") {
        if (!this.cacheRoot)
          this.cacheRoot = await fs.mkdtemp(
            path.join(os.tmpdir(), "folio-content-cache-"),
          );
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
      return result;
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  async clearCache() {
    this.cache.clear();
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
    this.process?.kill();
  }
}
module.exports = { NativeBridge };

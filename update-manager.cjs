// Update trust is anchored to this repository, never to renderer-provided URLs.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const REPO = "ionize1080/Folio";
function version(s) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\da-z.-]+))?$/i.exec(s || "");
  return m ? [...m.slice(1, 4).map(Number), (m[4] || "").toLowerCase()] : null;
}
function compare(a, b) {
  a = version(a);
  b = version(b);
  if (!a || !b) throw Error("版本号无效");
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  if (a[3] === b[3]) return 0;
  if (!a[3]) return 1;
  if (!b[3]) return -1;
  const x = a[3].match(/\d+|[^\d]+/g),
    y = b[3].match(/\d+|[^\d]+/g);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    if (/^\d+$/.test(x[i]) && /^\d+$/.test(y[i]))
      return Math.sign(+x[i] - +y[i]);
    return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}
function selectRelease(releases, current, channel) {
  return (
    releases
      .filter(
        (r) =>
          !r.draft &&
          version(r.tag_name) &&
          (channel === "preview" ||
            (!r.prerelease && !version(r.tag_name)[3])) &&
          compare(r.tag_name, current) > 0,
      )
      .sort((a, b) => compare(b.tag_name, a.tag_name))
      .find((r) =>
        r.assets?.some((a) =>
          /^Folio-PDF-Studio-[\w.-]+-portable-win-x64\.zip$/.test(a.name),
        ),
      ) || null
  );
}
function config(value = {}) {
  if (!["stable", "preview"].includes(value.channel || "stable"))
    throw Error("更新通道无效");
  const proxy = (value.proxy || "").trim();
  if (proxy) {
    const u = new URL(proxy);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash
    )
      throw Error("代理请填写 http://主机:端口，不包含账号或路径");
  }
  return {
    channel: value.channel || "stable",
    proxy,
    autoCheck: !!value.autoCheck,
  };
}
function assetURL(s) {
  const u = new URL(s);
  if (
    u.protocol !== "https:" ||
    u.host !== "github.com" ||
    !u.pathname.startsWith("/" + REPO + "/releases/download/")
  )
    throw Error("更新资源地址不可信");
  return u.href;
}
class UpdateManager {
  constructor({
    app,
    session,
    notify = () => {},
    dirty = () => false,
    releaseChannel = "",
  }) {
    Object.assign(this, { app, session, notify, dirty });
    this.current =
      app.getVersion() + (releaseChannel ? "-" + releaseChannel : "");
    this.settings = config();
    this.state = { phase: "idle" };
    this.home = path.join(app.getPath("userData"), "updates");
    this.file = path.join(app.getPath("userData"), "network.json");
  }
  async init() {
    try {
      this.settings = config(JSON.parse(await fs.readFile(this.file, "utf8")));
    } catch {}
    await this.proxy();
    return this.info();
  }
  async proxy() {
    await this.session.setProxy(
      this.settings.proxy
        ? { mode: "fixed_servers", proxyRules: this.settings.proxy }
        : { mode: "system" },
    );
    await this.session.closeAllConnections();
  }
  info() {
    return {
      ...this.state,
      settings: this.settings,
      current: this.current,
      supported: process.platform === "win32" && this.app.isPackaged,
    };
  }
  status(phase, extra = {}) {
    this.state = { ...this.state, ...extra, phase };
    this.notify(this.info());
    return this.info();
  }
  async configure(v) {
    if (this.busy) throw Error("更新任务进行中");
    this.settings = config(v);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.settings));
    await this.proxy();
    this.release = null;
    this.ready = null;
    return this.status("idle", { release: null, error: null });
  }
  async fetch(url, options = {}) {
    const r = await this.session.fetch(url, {
      ...options,
      signal: this.abort?.signal,
      credentials: "omit",
      headers: {
        "User-Agent": "Folio-Updater",
        Accept: "application/vnd.github+json",
        ...options.headers,
      },
    });
    if (!r.ok) throw Error(`下载服务返回 HTTP ${r.status}`);
    return r;
  }
  async check() {
    return this.task(async () => {
      this.ready = null;
      this.status("checking", { error: null });
      const all = [];
      for (let p = 1; p <= 5; p++) {
        const r = await this.fetch(
          `https://api.github.com/repos/${REPO}/releases?per_page=100&page=${p}`,
        );
        const rows = await r.json();
        if (!Array.isArray(rows)) throw Error("发布列表无效");
        all.push(...rows);
        if (rows.length < 100) break;
      }
      this.release = selectRelease(all, this.current, this.settings.channel);
      return this.status(this.release ? "available" : "current", {
        release: this.release
          ? {
              version: this.release.tag_name,
              notes: (this.release.body || "").slice(0, 16000),
              url: this.release.html_url,
            }
          : null,
      });
    });
  }
  async task(fn) {
    if (this.busy) throw Error("更新任务进行中");
    this.busy = true;
    this.abort = new AbortController();
    this.deadline = setTimeout(() => this.abort.abort(), 30 * 60 * 1000);
    try {
      return await fn();
    } catch (e) {
      this.status("error", {
        error: e.name === "AbortError" ? "更新已取消或超时" : e.message,
      });
      throw e;
    } finally {
      clearTimeout(this.deadline);
      this.busy = false;
      this.abort = null;
    }
  }
  cancel() {
    this.abort?.abort();
  }
  async download() {
    if (!this.release) throw Error("请先检查更新");
    return this.task(async () => {
      const a = this.release.assets.find((a) =>
        /^Folio-PDF-Studio-[\w.-]+-portable-win-x64\.zip$/.test(a.name),
      );
      let hash = /^sha256:([a-f0-9]{64})$/i.exec(a.digest || "")?.[1];
      if (!hash) {
        const s = this.release.assets.find((a) =>
          /-SHA256\.txt$/i.test(a.name),
        );
        if (!s) throw Error("此版本缺少 SHA-256 校验，不能自动安装");
        const r = await this.fetch(assetURL(s.browser_download_url));
        const text = await r.text();
        if (text.length > 1024 * 1024) throw Error("校验文件过大");
        hash = text
          .split(/\r?\n/)
          .map((l) => l.trim().split(/\s+/))
          .find((p) => p.length === 2 && p[1] === a.name)?.[0];
      }
      if (!/^[a-f\d]{64}$/i.test(hash || "")) throw Error("下载校验值无效");
      if (
        !Number.isSafeInteger(a.size) ||
        a.size <= 0 ||
        a.size > 8 * 1024 ** 3
      )
        throw Error("下载大小无效");
      await fs.mkdir(this.home, { recursive: true });
      const file = path.join(this.home, a.name),
        part = file + ".part";
      this.ready = null;
      this.status("downloading", { received: 0, total: a.size, error: null });
      const r = await this.fetch(assetURL(a.browser_download_url), {
          headers: { Accept: "application/octet-stream" },
        }),
        handle = await fs.open(part, "w"),
        digest = crypto.createHash("sha256");
      let count = 0,
        complete = false,
        last = 0;
      try {
        for await (const chunk of r.body) {
          count += chunk.length;
          if (count > a.size) throw Error("下载大小超出发布信息");
          digest.update(chunk);
          await handle.writeFile(chunk);
          if (Date.now() - last > 200) {
            last = Date.now();
            this.status("downloading", { received: count });
          }
        }
        await handle.sync();
        complete = true;
      } finally {
        await handle.close();
        if (!complete) await fs.rm(part, { force: true });
      }
      if (
        count !== a.size ||
        digest.digest("hex").toLowerCase() !== hash.toLowerCase()
      ) {
        await fs.rm(part, { force: true });
        throw Error("更新包 SHA-256 校验失败");
      }
      await fs.rename(part, file);
      this.ready = { file, hash, version: this.release.tag_name };
      return this.status("ready", { received: count });
    });
  }
  async install() {
    if (process.platform !== "win32" || !this.app.isPackaged)
      throw Error("自动替换仅用于 Windows 便携发行包");
    if (this.busy || !this.ready) throw Error("请先下载并校验更新");
    if (this.dirty()) throw Error("请先保存或关闭当前文档，再安装更新");
    return this.task(async () => {
      this.status("installing");
      const target = path.dirname(this.app.getPath("exe"));
      const manifest = path.join(
        this.home,
        "install-" + crypto.randomUUID() + ".json",
      );
      await fs.writeFile(
        manifest,
        JSON.stringify({ ...this.ready, target, pid: process.pid }),
      );
      const script = path.join(this.home, "portable-update.ps1");
      await fs.writeFile(
        script,
        await fs.readFile(path.join(__dirname, "portable-update.ps1")),
      );
      const child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          "-Manifest",
          manifest,
        ],
        { detached: true, stdio: "ignore", cwd: this.home, windowsHide: true },
      );
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
      this.app.quit();
      return true;
    });
  }
}
module.exports = {
  UpdateManager,
  version,
  compare,
  selectRelease,
  config,
  assetURL,
};

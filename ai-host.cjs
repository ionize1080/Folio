const { storageBudget } = require("./storage-budget.cjs");
const net = require("node:net"),
  crypto = require("node:crypto"),
  path = require("node:path"),
  fs = require("node:fs"),
  { spawn } = require("node:child_process");
function installAIHost({ app, win, ipc }) {
  const pipe =
      "\\\\.\\pipe\\Folio-AI-" + crypto.randomBytes(16).toString("hex"),
    token = crypto.randomBytes(32).toString("hex"),
    pending = new Map(),
    clients = new Set();
  let child,
    startup,
    settleStartup,
    seq = 0,
    approvalAuto = false;
  const dock = new (require("./ai-dock.cjs").AIDock)({
    app,
    win,
    onState: (state) => {
      if (!win.isDestroyed()) win.webContents.send("ai-state", state);
    },
  });
  ipc("ai-approval", (auto) => {
    approvalAuto = auto === true;
    if (!dock.client?.destroyed)
      dock.client?.write(
        JSON.stringify({ action: "approval", auto: auto === true }) + "\n",
      );
  });
  ipc("ai-display", (mode) => dock.setMode(mode));
  ipc("ai-overlay", (hidden) => dock.setOverlay(hidden === true));
  ipc("ai-bounds", (bounds) => {
    if (
      Object.values(bounds).every(
        (n) => Number.isFinite(n) && n >= 0 && n < 20000,
      )
    ) {
      dock.bounds = bounds;
      dock.layout();
    }
  });
  const server = net.createServer((client) => {
    clients.add(client);
    client.setEncoding("utf8");
    client.on("close", () => clients.delete(client));
    client.on("error", () => client.destroy());
    let buffer = "";
    client.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 16 * 1024 * 1024) return client.destroy();
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        try {
          const m = JSON.parse(line);
          if (m.token !== token) throw Error("Invalid session");
          if (m.action === "ready") {
            dock.ready(m.handle, client);
            settleStartup?.();
            client.write(
              JSON.stringify({ action: "approval", auto: approvalAuto }) + "\n",
            );
            continue;
          }
          if (m.action === "display") {
            dock.setMode(m.mode);
            continue;
          }
          const id = ++seq;
          const timer = setTimeout(() => {
            pending.delete(id);
            if (!client.destroyed)
              client.write(
                JSON.stringify({ id: m.id, error: "操作超时" }) + "\n",
              );
          }, 300000);
          pending.set(id, { client, id: m.id, timer });
          win.webContents.send("ai-request", {
            id,
            params: m.params,
            deadline: Date.now() + 300000,
          });
        } catch {
          client.destroy();
        }
      }
    });
  });
  server.listen(pipe);
  const snapshotDirs = [];
  let latestSnapshot;
  ipc("ai-snapshot", async (bytes) => {
    if (!bytes || bytes.length > 768 * 1024 * 1024)
      throw Error("PDF大小超出预算");
    const dir = await require("./temp-store.cjs").makeTemp("folio-source-");
    snapshotDirs.push(dir);
    const file = path.join(dir, "document.pdf");
    await fs.promises.writeFile(file, Buffer.from(bytes));
    await storageBudget.add(file, { pinned: true });
    if (latestSnapshot) await storageBudget.unpin(latestSnapshot);
    latestSnapshot = file;
    return {
      path: file,
      cache: true,
      note: "下一份快照生成后旧快照可能按缓存上限轮替，请及时完成处理。",
    };
  });
  app.on("before-quit", () => {
    for (const dir of snapshotDirs)
      fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  let upstream;
  async function pdfClient() {
    if (upstream) return upstream;
    const root = app.isPackaged
      ? path.join(process.resourcesPath, "Chatbox")
      : path.join(__dirname, ".ai-runtime", "Chatbox");
    const { Client } = require(
      path.join(
        root,
        "node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js",
      ),
    );
    const { StdioClientTransport } = require(
      path.join(
        root,
        "node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js",
      ),
    );
    const client = new Client({ name: "Folio", version: "2.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: app.isPackaged
          ? path.join(process.resourcesPath, "pdf-runtime", "python.exe")
          : path.join(__dirname, ".venv-ai", "Scripts", "python.exe"),
        args: [
          app.isPackaged
            ? path.join(process.resourcesPath, "pdf-runtime", "pdf-server.py")
            : path.join(__dirname, "integrations", "pdf-server.py"),
        ],
        stderr: "pipe",
      }),
    );
    upstream = client;
    return client;
  }
  ipc("ai-pdf", async (m) => {
    const client = await pdfClient();
    if (m.action === "list") return client.listTools();
    if (m.action === "call") {
      const paths = [];
      const visit = (v) => {
        if (typeof v === "string") paths.push(v);
        else if (v && typeof v === "object") Object.values(v).forEach(visit);
      };
      visit(m.options);
      const release = storageBudget.lease(paths);
      try {
        return await client.callTool({
          name: m.name,
          arguments: m.options || {},
        });
      } finally {
        await release();
      }
    }
    throw Error("Unknown PDF action");
  });
  app.on("before-quit", () => upstream?.close());
  ipc("ai-reply", (m) => {
    const p = pending.get(m.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(m.id);
    if (!p.client.destroyed)
      p.client.write(
        JSON.stringify({ id: p.id, result: m.result, error: m.error }) + "\n",
      );
  });
  ipc("ai-open", () => {
    if (child) {
      if (!startup) dock.toggle();
      return startup || { running: true };
    }
    const root = app.isPackaged
      ? path.join(process.resourcesPath, "Chatbox")
      : path.join(__dirname, ".ai-runtime", "Chatbox");
    if (!fs.existsSync(path.join(root, "native", "package.json")))
      throw Error("Chatbox组件尚未准备，请运行准备脚本");
    const exe = app.isPackaged
      ? path.join(process.resourcesPath, "ChatboxRuntime", "electron.exe")
      : process.execPath;
    startup = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const process = child;
        settleStartup?.(Error("Chatbox 启动超时，请重试"));
        process?.kill();
      }, 60000);
      settleStartup = (error) => {
        clearTimeout(timer);
        settleStartup = null;
        startup = null;
        error ? reject(error) : resolve({ running: true });
      };
    });
    child = spawn(
      exe,
      [
        root,
        ...(!app.isPackaged && process.env.FOLIO_TEST_CHATBOX_PORT
          ? ["--remote-debugging-port=" + process.env.FOLIO_TEST_CHATBOX_PORT]
          : []),
      ],
      {
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: undefined,
          FOLIO_MCP_PIPE: pipe,
          FOLIO_MCP_TOKEN: token,
        },
      },
    );
    child.on("error", (error) => {
      settleStartup?.(Error("Chatbox 启动失败：" + error.message));
      child = null;
    });
    child.on("exit", () => {
      settleStartup?.(Error("Chatbox 在启动完成前退出，请检查组件是否完整"));
      child = null;
      dock.close();
    });
    return startup;
  });
  app.on("before-quit", () => {
    dock.close();
    child?.kill();
    for (const p of pending.values()) clearTimeout(p.timer);
    pending.clear();
    for (const c of clients) c.destroy();
    server.close();
  });
}
module.exports = { installAIHost };

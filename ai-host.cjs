const { storageBudget } = require("./storage-budget.cjs");
const net = require("node:net"),
  crypto = require("node:crypto"),
  path = require("node:path"),
  fs = require("node:fs"),
  { spawn } = require("node:child_process");
function installAIHost({ app, win, ipc, tabs, sender, requireActive }) {
  const pipe =
      "\\\\.\\pipe\\Folio-AI-" + crypto.randomBytes(16).toString("hex"),
    token = crypto.randomBytes(32).toString("hex"),
    pending = new Map(),
    clients = new Set();
  let startup,
    settleStartup,
    seq = 0,
    approvalAuto = false;
  const dock = new (require("./ai-dock.cjs").AIDock)({
    app,
    win,
    onState: (state) => {
      if (!win.isDestroyed()) for (const t of tabs.entries.values()) t.wc.send("ai-state", {...state,auto:approvalAuto});
    },
  });
  function route(params) {
    const id = params?.arguments?.documentId;
    const target = id === undefined ? tabs.active : tabs.byId(id);
    if (!approvalAuto && target !== tabs.active) tabs.select(target);
    return target.wc;
  }
  tabs.onSelect = tab => {
    dock.bounds = tab.bounds;
    dock.setOverlay(!!tab.overlay);
  };
  tabs.onReady = tab => tab.wc.send("ai-state", {...dock.state(),auto:approvalAuto});
  ipc("ai-approval", (auto) => {
    approvalAuto = auto === true;
    dock.approvalAuto = approvalAuto;
    for (const t of tabs.entries.values()) t.wc.send("ai-state", {...dock.state(),auto:approvalAuto});
    dock.send("folio:approval", approvalAuto);
  });
  ipc("ai-display", (mode) => dock.setMode(mode));
  ipc("ai-progress", (message) => dock.send("folio:progress", String(message).slice(0,200)));
  ipc("ai-overlay", hidden => {
    tabs.entries.get(sender()).overlay = hidden === true;
    if (requireActive()) dock.setOverlay(hidden === true);
  });
  ipc("ai-bounds", (bounds) => {
    if (
      Object.values(bounds).every(
        (n) => Number.isFinite(n) && n >= 0 && n < 20000,
      )
    ) {
      tabs.entries.get(sender()).bounds = bounds;
      if (!requireActive()) return;
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
          let owner;
          try { owner = route(m.params); }
          catch (error) { client.write(JSON.stringify({id:m.id,error:error.message}) + "\n"); continue; }
          const id = ++seq;
          const timer = setTimeout(() => {
            pending.delete(id);
            if (!client.destroyed)
              client.write(
                JSON.stringify({ id: m.id, error: "操作超时" }) + "\n",
              );
          }, 300000);
          pending.set(id, { client, id: m.id, timer, owner });
          owner.send("ai-request", {
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
  const snapshots = new Map();
  tabs.onRemove = tab => {
    const file = snapshots.get(tab.id);
    if (file) void storageBudget.unpin(file);
    snapshots.delete(tab.id);
    for (const [id, p] of pending) {
      if (p.owner !== tab.wc) continue;
      pending.delete(id);
      clearTimeout(p.timer);
      if (p.reject) p.reject(Error("Document closed"));
      else if (!p.client.destroyed) p.client.write(JSON.stringify({id:p.id,error:"Document closed"}) + "\n");
    }
  };
  ipc("ai-snapshot", async (bytes) => {
    if (!bytes || bytes.length > 768 * 1024 * 1024)
      throw Error("PDF大小超出预算");
    const id = tabs.entries.get(sender()).id;
    const dir = await require("./temp-store.cjs").makeTemp("folio-source-");
    snapshotDirs.push(dir);
    const file = path.join(dir, "document.pdf");
    await fs.promises.writeFile(file, Buffer.from(bytes));
    await storageBudget.add(file, { pinned: true });
    if (tabs.entries.get(sender())?.id !== id) { await storageBudget.unpin(file); throw Error("Document closed"); }
    const prior = snapshots.get(id);
    snapshots.set(id,file);
    if (prior) await storageBudget.unpin(prior);
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
  let upstream, toolList;
  const resultCache = new (require(app.isPackaged ? path.join(process.resourcesPath,'Chatbox/result-cache.cjs') : './integrations/chatbox/result-cache.cjs').ResultCache)();
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
    if(m.action === 'result')return resultCache.read(m);
    const client = await pdfClient();
    if (m.action === "list") return toolList ||= await client.listTools();
    if (m.action === "call") {
      const paths = [];
      const visit = (v) => {
        if (typeof v === "string") paths.push(v);
        else if (v && typeof v === "object") Object.values(v).forEach(visit);
      };
      visit(m.options);
      const release = storageBudget.lease(paths);
      try {
        return resultCache.put(await client.callTool({
          name: m.name,
          arguments: m.options || {},
        }));
      } finally {
        await release();
      }
    }
    throw Error("Unknown PDF action");
  });
  app.on("before-quit", () => upstream?.close());
  ipc("ai-reply", (m) => {
    const p = pending.get(m.id);
    if (!p || p.owner !== sender()) return;
    clearTimeout(p.timer);
    pending.delete(m.id);
    if (p.resolve) return m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
    if (!p.client.destroyed)
      p.client.write(
        JSON.stringify({ id: p.id, result: m.result, error: m.error }) + "\n",
      );
  });
  function request(params) {
    return new Promise((resolve,reject)=>{
      const id=++seq, timer=setTimeout(()=>{pending.delete(id);reject(Error("操作超时"))},300000);
      const owner = route(params);
      pending.set(id,{resolve,reject,timer,owner});
      owner.send("ai-request",{id,params,deadline:Date.now()+300000});
    });
  }
  ipc("ai-open", () => {
    if (startup) return startup;
    const root = app.isPackaged ? path.join(process.resourcesPath,"Chatbox") : path.join(__dirname,".ai-runtime/Chatbox");
    if(!fs.existsSync(path.join(root,"native/dist/main/main.js")))throw Error("Chatbox组件尚未准备");
    const profile = require(path.join(root,"profile.cjs")).prepareProfile(app.getPath("appData"),process.env.FOLIO_CHATBOX_PROFILE);
    startup = dock.open({root,profile,pipe,token,request,approvalAuto}).finally(()=>{startup=null});
    return startup;
  });
  app.on("before-quit", () => {
    dock.close();
    for (const p of pending.values()) clearTimeout(p.timer);
    pending.clear();
    for (const c of clients) c.destroy();
    server.close();
  });
}
module.exports = { installAIHost };

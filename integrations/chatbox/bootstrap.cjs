const { app, ipcMain } = require("electron"),
  path = require("node:path");
app.setPath(
  "userData",
  process.env.FOLIO_CHATBOX_PROFILE ||
    path.join(app.getPath("appData"), "Folio", "Chatbox-1.20.3"),
);
Object.defineProperty(app, "isPackaged", { get: () => true });
Object.defineProperty(process, "resourcesPath", {
  value: path.join(__dirname, "resources"),
});
app.setAsDefaultProtocolClient = () => false;
function settings(value = {}) {
  if (!value.providers?.["folio-qwen"])
    value = {
      ...value,
      provider: "folio-qwen",
      modelId: "qwen3.8-flash",
      defaultChatModel: { provider: "folio-qwen", model: "qwen3.8-flash" },
      customProviders: [
        ...(value.customProviders || []),
        {
          id: "folio-qwen",
          name: "Folio Qwen",
          type: "openai",
          isCustom: true,
        },
      ],
      providers: {
        ...value.providers,
        "folio-qwen": {
          apiHost:
            "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1",
          apiPath: "/chat/completions",
          apiKey: "",
          models: [
            { modelId: "qwen3.8-flash", capabilities: ["vision", "tool_use"] },
          ],
          useProxy: false,
        },
      },
    };
  return {
    ...value,
    autoUpdate: false,
    allowReportingAndTracking: false,
    mcp: {
      ...value.mcp,
      enabledBuiltinServers: value.mcp?.enabledBuiltinServers || [],
      servers: process.env.FOLIO_MCP_PIPE
        ? [
            ...(value.mcp?.servers || []).filter((s) => s.id !== "folio-pdf"),
            {
              id: "folio-pdf",
              name: "Folio PDF",
              enabled: true,
              transport: {
                type: "stdio",
                command: process.execPath,
                args: [path.join(__dirname, "stdio.cjs")],
                env: {
                  ELECTRON_RUN_AS_NODE: "1",
                  FOLIO_MCP_PIPE: process.env.FOLIO_MCP_PIPE,
                  FOLIO_MCP_TOKEN: process.env.FOLIO_MCP_TOKEN,
                },
              },
            },
          ]
        : (value.mcp?.servers || []).filter((s) => s.id !== "folio-pdf"),
    },
  };
}
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, fn) => {
  if (name === "install-update")
    return handle(name, () => {
      throw Error("请通过Folio升级固定版本Chatbox");
    });
  if (name === "getSettings")
    return handle(name, async (...args) => settings(await fn(...args)));
  if (name === "getStoreValue")
    return handle(name, async (e, key, ...args) => {
      const value = await fn(e, key, ...args);
      return key === "settings" ? settings(value) : value;
    });
  return handle(name, fn);
};
const net = require("node:net"),
  readline = require("node:readline");
let hostSocket, primary;
const controls = new Map();
let controlId = 0;
if (process.env.FOLIO_MCP_PIPE) {
  hostSocket = net.createConnection(process.env.FOLIO_MCP_PIPE);
  hostSocket.on("error", () => {});
  readline.createInterface({ input: hostSocket }).on("line", (line) => {
    try {
      const m = JSON.parse(line);
      if (m.action === "focus") {
        primary?.show();
        primary?.focus();
      }
      if (controls.has(m.id)) {
        const p = controls.get(m.id);
        controls.delete(m.id);
        clearTimeout(p.timer);
        m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
      }
      if (m.action === "approval")
        primary?.webContents.send("folio:approval", m.auto);
      if (m.action === "mode" && primary) {
        const side = m.mode === "sidebar";
        primary.setMovable(!side);
        primary.setSkipTaskbar(false);
        primary.webContents.send("folio:display", m.mode);
      }
    } catch {}
  });
}
ipcMain.handle("folio:display", (e, mode) => {
  if (e.sender !== primary?.webContents) throw Error("Invalid sender");
  hostSocket?.write(
    JSON.stringify({
      action: "display",
      token: process.env.FOLIO_MCP_TOKEN,
      mode,
    }) + "\n",
  );
});
ipcMain.handle("folio:approval", (e) => {
  if (e.sender !== primary?.webContents || !hostSocket)
    throw Error("Folio未连接");
  return new Promise((resolve, reject) => {
    const id = ++controlId,
      timer = setTimeout(() => {
        controls.delete(id);
        reject(Error("审批切换超时"));
      }, 120000);
    controls.set(id, { resolve, reject, timer });
    hostSocket.write(
      JSON.stringify({
        id,
        token: process.env.FOLIO_MCP_TOKEN,
        params: { name: "folio_ui", arguments: { action: "approval" } },
      }) + "\n",
    );
  });
});
app.on("browser-window-created", (_e, w) => {
  if (primary) return;
  primary = w;
  w.setMinimumSize(320, 240);
  w.once("ready-to-show", () => {
    const h = w.getNativeWindowHandle();
    hostSocket?.write(
      JSON.stringify({
        action: "ready",
        token: process.env.FOLIO_MCP_TOKEN,
        handle: (h.length === 8
          ? h.readBigUInt64LE()
          : BigInt(h.readUInt32LE())
        ).toString(),
      }) + "\n",
    );
  });
});
app.on("before-quit", () => hostSocket?.destroy());
// Preserve upstream provider transports and headers without Electron net interception.
require("./network.cjs")({ app, ipcMain });
require("./native/dist/main/main.js");

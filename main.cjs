const { cleanupTemps } = require("./temp-store.cjs");
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  session,
  Menu,
} = require("electron");
const path = require("node:path"),
  fs = require("node:fs/promises"),
  { pathToFileURL } = require("node:url");
const graphicsFile = path.join(app.getPath("userData"), "graphics.json");
let softwareGraphics = false;
try {
  softwareGraphics =
    JSON.parse(require("node:fs").readFileSync(graphicsFile, "utf8"))
      .software === true;
} catch {}
if (softwareGraphics) app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "folio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
let win,
  dirty = false,
  allowClose = false;
const { FileStore } = require("./file-store.cjs");
const { NativeBridge } = require("./native-bridge.cjs");
const { SourceStore } = require("./source-store.cjs");
const sourceStore = new SourceStore();
cleanupTemps().catch(() => {});
const native = new NativeBridge(
  app.isPackaged
    ? path.join(process.resourcesPath, "native")
    : path.join(__dirname, "native"),
  undefined,
  sourceStore,
);
const qpdfNative = new NativeBridge(native.root, native.python);
app.on("before-quit", () => qpdfNative.cancel());
const fontNative = new NativeBridge(native.root, native.python);
app.on("before-quit", () => fontNative.cancel());
const backgroundNative = new NativeBridge(
  native.root,
  native.python,
  sourceStore,
);
app.on("before-quit", () => {
  backgroundNative.cancel();
  backgroundNative.clearCache();
  sourceStore.close();
});
let fileStore;
const { LargeFiles } = require("./large-files.cjs");
const largeFiles = new LargeFiles(native.root, native.python, async (name) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: name,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  return r.canceled ? null : r.filePath;
});
app.on("before-quit", () => largeFiles.close());
const root = path.join(__dirname, "src");
function check(e) {
  if (
    e.sender !== win.webContents ||
    !e.senderFrame.url.startsWith("folio://app/")
  )
    throw Error("Invalid sender");
}
function ipc(name, fn) {
  ipcMain.handle(name, async (e, ...args) => {
    check(e);
    return fn(...args);
  });
}
app.setName("Folio PDF Studio");
app.setAppUserModelId("studio.folio.pdf");
app.whenReady().then(() => {
  protocol.handle("folio", (request) => {
    const url = new URL(request.url);
    if (url.host !== "app") return new Response("", { status: 403 });
    let file;
    try {
      file = path.resolve(root, "." + decodeURIComponent(url.pathname));
    } catch {
      return new Response("", { status: 400 });
    }
    if (!file.startsWith(root + path.sep))
      return new Response("", { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({
    width: 1500,
    height: 970,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f4f6fa",
    title: "Folio PDF Studio",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  Menu.setApplicationMenu(null);
  win.on("close", (e) => {
    if (dirty && !allowClose) {
      e.preventDefault();
      win.webContents.send("request-close");
    }
  });
  ipc("dirty", (value) => {
    dirty = !!value;
  });
  ipc("close", () => {
    allowClose = true;
    win.close();
  });
  fileStore = new FileStore(
    async (name, kind) => {
      const r = await dialog.showSaveDialog(win, {
        defaultPath: name,
        filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
      });
      return r.canceled ? null : r.filePath;
    },
    process.platform === "win32"
      ? (source, target) => native.replace(source, target)
      : undefined,
  );
  win.webContents.setVisualZoomLevelLimits(1, 1);
  ipc("fullscreen", () => {
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });
  ipc("open", async (kind = "pdf") => {
    const exts =
      kind === "pdf"
        ? ["pdf", "folio"]
        : kind === "json"
          ? ["json"]
          : ["txt", "tsv"];
    const r = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: kind.toUpperCase(), extensions: exts }],
    });
    if (r.canceled) return null;
    const file = r.filePaths[0],
      s = await fs.stat(file);
    if (/\.pdf$/i.test(file) && s.size > 768 * 1024 ** 2)
      return largeFiles.register(file);
    if (s.size > (/\.folio$/i.test(file) ? 1024 : 768) * 1024 * 1024)
      throw Error("当前版本单文件上限为 768 MB");
    const bytes = await fs.readFile(file);
    return { name: path.basename(file), bytes, handle: fileStore.grant(file) };
  });
  ipc("open-drop", async (file) => {
    if (typeof file !== "string" || !/\.(pdf|folio)$/i.test(file))
      throw Error("仅支持 PDF 与 Folio 文件");
    const stat = await fs.stat(file);
    if (stat.isFile() && /\.pdf$/i.test(file) && stat.size > 768 * 1024 ** 2)
      return largeFiles.register(file);
    if (
      !stat.isFile() ||
      stat.size > (/\.folio$/i.test(file) ? 1024 : 768) * 1024 ** 2
    )
      throw Error("文件无效或超过 768 MB");
    return {
      name: path.basename(file),
      bytes: await fs.readFile(file),
      handle: fileStore.grant(file),
    };
  });
  ipc("save", (data) => fileStore.save(data));
  ipc("save-prepare", (data) => fileStore.prepare(data));
  ipc("copy-text", (text) => {
    if (typeof text !== "string" || text.length > 16000000)
      throw Error("复制文字过长");
    require("electron").clipboard.writeText(text);
    return true;
  });
  const { OCRJobs } = require("./ocr-jobs.cjs");
  const ocrJobs = new OCRJobs(
    native.root,
    path.join(app.getPath("userData"), "ocr-jobs"),
  );
  ipc("ocr-job", (data) => ocrJobs.run(data));
  app.on("before-quit", () => ocrJobs.stop());
  ipc("qpdf", (data) => {
    if (!["qpdf-status", "qpdf-decrypt"].includes(data?.command))
      throw Error("无效的 qpdf 请求");
    return qpdfNative.run({
      command: data.command,
      bytes: data.bytes,
      password: data.password,
    });
  });
  ipc("qpdf-cancel", () => qpdfNative.cancel());
  ipc("save-stream-begin", (data) => fileStore.beginStream(data));
  ipc("save-stream-append", (data) => fileStore.appendStream(data));
  ipc("save-stream-finish", (id) => fileStore.finishStream(id));
  ipc("save-stream-abort", (id) => fileStore.abortStream(id));
  app.on("before-quit", () => fileStore.close());
  ipc("large-read", (data) => largeFiles.read(data));
  ipc("large-info", (data) => largeFiles.info(data));
  ipc("large-page", (data) => largeFiles.page(data));
  ipc("large-save", (data) => largeFiles.save(data));
  ipc("large-release", (handle) => largeFiles.release(handle));
  ipc("large-cancel", () => largeFiles.cancel());
  ipc("source-register", (bytes) => sourceStore.register(bytes));
  ipc("source-release", (handle) => sourceStore.release(handle));
  ipc("native", (data) => {
    const options = { ...data };
    if (
      ["font-catalog", "font-select", "font-data", "font-recommend", "font-fast"].includes(
        options.command,
      )
    )
      return fontNative.run(options);
    delete options.ocrFile;
    if (options.ocrReference) {
      options.ocrFile = ocrJobs.resolveReference(options.ocrReference);
      delete options.ocr;
    }
    delete options.ocrReference;
    return (
      options.command === "flow-background" ? backgroundNative : native
    ).run(options, (progress) => {
      if (!win.isDestroyed()) win.webContents.send("native-progress", progress);
    });
  });
  const { FlowLayout } = require("./flow-layout.cjs");
  const flowLayout = new FlowLayout(native.root, native.python);
  ipc("flow-layout", (data) => flowLayout.render(data));
  app.on("before-quit", () => flowLayout.close());
  win.on("closed", () => flowLayout.close());
  ipc("native-cancel", () => native.cancel());
  ipc("graphics", async (value) => {
    if (typeof value === "boolean") {
      await fs.mkdir(path.dirname(graphicsFile), { recursive: true });
      await fs.writeFile(graphicsFile, JSON.stringify({ software: value }));
    }
    return softwareGraphics;
  });
  win.loadURL("folio://app/index.html");
});
app.on("window-all-closed", async () => {
  native.cancel();
  await native.clearCache();
  app.quit();
});

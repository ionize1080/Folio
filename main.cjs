const {storageBudget}=require('./storage-budget.cjs');
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
if(process.env.FOLIO_TEST_PROFILE)app.setPath('userData',process.env.FOLIO_TEST_PROFILE);
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
let uiLanguage = "en";
let tabs;
const { AsyncLocalStorage } = require("node:async_hooks");
const editorCall = new AsyncLocalStorage();
const sender = () => editorCall.getStore();
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
// app.quit() (including installation) does not emit window-all-closed.
// Stop the primary worker as well, so its DLLs cannot lock the portable folder.
app.on("before-quit", () => native.cancel());
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
    !tabs?.entries.has(e.sender) || e.senderFrame !== e.sender.mainFrame ||
    !e.senderFrame.url.startsWith("folio://app/")
  )
    throw Error("Invalid sender");
}
function ipc(name, fn) {
  ipcMain.handle(name, async (e, ...args) => {
    check(e);
    return editorCall.run(e.sender, () => fn(...args));
  });
}
const {readCreativeAsset,readCreativeUIFonts}=require('./creative-studio.cjs');
const creativeRoot=app.isPackaged?path.join(process.resourcesPath,'creative'):path.join(__dirname,'.creative-web');
ipc('creative-studio',async a=>{
  const owner=sender();
  if(a.action==='ui-fonts')return readCreativeUIFonts(a.language);
  if(a.action!=='asset')throw Error('编辑命令应由 Folio 内的画布执行');
  if(a.pick){
    const r=await dialog.showOpenDialog(BrowserWindow.fromWebContents(owner),{properties:['openFile'],filters:[{name:a.kind==='photo'?'图像与图层工程':'矢量与图形工程',extensions:a.kind==='photo'?['pcraft','psd','psb','png','jpg','jpeg','webp','tif','tiff','exr','hdr','bmp']:['vectorcraft','svg','svgz','pdf','ai','eps','dxf','png','jpg','webp']}]});
    if(r.canceled)return {cancelled:true};a={...a,path:r.filePaths[0]};
  }
  return readCreativeAsset(a.path);
});
app.setName("Folio PDF Studio");
app.setAppUserModelId("studio.folio.pdf");
app.whenReady().then(async () => {
  await storageBudget.configure(path.join(app.getPath("userData"),"storage-budget.json"));
  protocol.handle("folio", (request) => {
    const url = new URL(request.url);
    if (url.host !== "app") return new Response("", { status: 403 });
    let file,base=root;
    try {
      const pathname=decodeURIComponent(url.pathname);
      if(pathname.startsWith('/creative/')){
        base=creativeRoot;file=path.resolve(base,'.'+pathname.slice('/creative'.length));
      }else file = path.resolve(root, "." + pathname);
    } catch {
      return new Response("", { status: 400 });
    }
    if (!file.startsWith(base + path.sep))
      return new Response("", { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const editorOptions = {
      backgroundThrottling: process.env.FOLIO_TEST_BACKGROUND !== "1",
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
  };
  win = new BrowserWindow({
    show: process.env.FOLIO_TEST_BACKGROUND !== "1",
    width: 1500,
    height: 970,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f4f6fa",
    title: "Folio PDF Studio",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets/icon.png"),
    webPreferences: editorOptions,
  });
  const sources = new Map();
  const workers = new Map();
  function editorWorker(kind) {
    if (sender() === win.webContents) return {native, background:backgroundNative, qpdf:qpdfNative}[kind];
    let group = workers.get(sender());
    if (!group) { group = {}; workers.set(sender(),group); }
    return group[kind] ||= new NativeBridge(native.root,native.python,sourceStore);
  }
  function configureEditor(wc) {
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", e => e.preventDefault());
    sources.set(wc, new Set());
    const clear = () => {
      const owned = sources.get(wc) || [];
      sources.set(wc,new Set());
      for (const handle of owned) void sourceStore.release(handle).catch(() => {});
      const group = workers.get(wc);
      if (group) for (const bridge of Object.values(group)) { bridge.cancel(); void bridge.clearCache(); }
      workers.delete(wc);
    };
    wc.on("did-navigate", clear);
    wc.on("render-process-gone", clear);
    wc.once("destroyed", () => { clear(); sources.delete(wc); });
  }
  const {DocumentTabs} = require("./document-tabs.cjs");
  tabs = new DocumentTabs(win, editorOptions, configureEditor, readDocument);
  const requireActive = () => sender() === tabs.active.wc;
  Menu.setApplicationMenu(null);
  const aiHost = require("./ai-host.cjs").installAIHost({app, win, ipc, tabs, sender, requireActive});
  let closing = false;
  win.on("close", e => {
    if (allowClose || ![...tabs.entries.values()].some(t => t.dirty || t.busy)) return;
    e.preventDefault();
    if (closing) return;
    closing = true;
    tabs.enqueue(async () => {
      try {
        if (await tabs.confirmWindow()) { allowClose = true; win.close(); }
      } finally { closing = false; }
    }).catch(() => {});
  });
  ipc("tabs-state", () => ({...tabs.snapshot(), self:tabs.entries.get(sender()).id}));
  let offeredRecovery = false;
  ipc("offer-recovery", () => {
    if (offeredRecovery || sender() !== win.webContents) return false;
    offeredRecovery = true;
    return true;
  });
  ipc("tabs-ready", () => tabs.ready(sender()));
  ipc("tabs-select", id => tabs.select(tabs.byId(id)));
  ipc("tabs-close", id => tabs.enqueue(() => tabs.closeOne(id)));
  ipc("tabs-reply", value => tabs.reply(sender(), value));
  ipc("tabs-open", async paths => {
    if (paths === undefined) {
      const pick = await dialog.showOpenDialog(win, {properties:["openFile","multiSelections"], filters:[{name:"PDF / Folio", extensions:["pdf","folio"]}]});
      if (pick.canceled) return;
      paths = pick.filePaths;
    }
    if (!Array.isArray(paths) || paths.some(p => typeof p !== "string")) throw Error("Invalid documents");
    return tabs.enqueue(() => tabs.open(paths));
  });
  ipc("tabs-meta", ({name,busy,handle}) => {
    const tab = tabs.entries.get(sender());
    if (typeof busy === "boolean") tab.busy = busy;
    const file = fileStore?.handles.get(handle);
    if (file) tab.key = process.platform === "win32" ? file.toLowerCase() : file;
    if (name && name !== tab.name) { tab.name = path.basename(name); tabs.publish(); }
  });
  ipc("system-languages", () => app.getPreferredSystemLanguages());
  ipc("ui-language", (value) => {
    uiLanguage = ["en", "zh-Hans", "zh-Hant"].includes(value) ? value : "en";
    updater.language = uiLanguage;
    return uiLanguage;
  });
  ipc("dirty", (value) => {
    const tab = tabs.entries.get(sender());
    if (tab.dirty !== !!value) { tab.dirty = !!value; tabs.publish(); }
  });
  ipc("close", () => {
    allowClose = true;
    win.close();
  });
  const { UpdateManager } = require("./update-manager.cjs");
  const updater = new UpdateManager({
    releaseChannel: require("./package.json").releaseChannel || "",
    app,
    session: session.fromPartition("folio-updates"),
    dirty: () => [...tabs.entries.values()].some(t => t.dirty || t.busy),
    notify: (r) => {
      if (!win.isDestroyed()) for (const t of tabs.entries.values()) t.wc.send("update-state", r);
    },
  });
  await updater.init();
  ipc("update-info", () => updater.readInstallResult());
  ipc("update-configure", (v) => updater.configure(v));
  ipc("update-check", () => updater.check());
  ipc("update-download", () => updater.download());
  ipc("update-cancel", () => updater.cancel());
  ipc("update-install", () => updater.install());
  ipc("update-started", async () => {
    const arg = process.argv.find((x) =>
      x.startsWith("--folio-update-health="),
    );
    if (!arg) return;
    const file = path.resolve(arg.slice("--folio-update-health=".length));
    if (
      path.dirname(file) !== updater.home ||
      !/^install-[\da-f-]+\.json\.health\.json$/.test(path.basename(file))
    )
      return;
    // The authenticated renderer signals after its modules have initialized.
    // Minimization/occlusion is not a startup failure and must not roll back an
    // otherwise healthy upgrade.
    if (!win.isDestroyed()) {
      await fs.writeFile(
        file + ".tmp",
        JSON.stringify({ version: updater.current, pid: process.pid }),
      );
      await fs.rename(file + ".tmp", file);
    }
  });
  app.on("before-quit", () => updater.cancel());
  if (updater.settings.autoCheck)
    setTimeout(() => updater.check().catch(() => {}), 5000);
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
        : kind === "office" ? ["doc","docx","xls","xlsx","ppt","pptx","odt","ods","odp","rtf","txt","csv","md","html"]
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
    return {
      name: path.basename(file),
      bytes,
      handle: fileStore.grant(file, bytes),
    };
  });
  async function readDocument(file) {
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
    const bytes = await fs.readFile(file);
    return {
      name: path.basename(file),
      bytes,
      handle: fileStore.grant(file, bytes),
    };
  }
  ipc("open-drop", readDocument);
  ipc("pick-image", async () => {
    const result=await dialog.showOpenDialog(win,{properties:["openFile"],filters:[{name:"Image",extensions:["png","jpg","jpeg","webp"]}]});
    if(result.canceled) return null;
    const file=result.filePaths[0];
    if((await fs.stat(file)).size>32*1024**2) throw Error("Image exceeds 32 MiB");
    return (await fs.readFile(file)).toString("base64");
  });
  ipc("web-pdf", data => require("./web-pdf.cjs").render(data, aiHost.reviewConversion));
  ipc("merge-files", async () => {
    const r=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],filters:[{name:'Documents and images',extensions:['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','txt','csv','md','html','png','jpg','jpeg','webp','bmp','tif','tiff','gif']}]});
    if(r.canceled)return [];
    if(r.filePaths.length>100)throw Error('每批最多 100 个文件');
    let total=0;const files=[];
    for(const file of r.filePaths){total+=(await fs.stat(file)).size;if(total>100*1024**2)throw Error('本批输入超过 100 MB');files.push({name:path.basename(file),bytes:await fs.readFile(file)});}
    return files;
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
  ipc("ocr-job", async (data) => {const result=await ocrJobs.run(data);if(["start","stop","history","remove","collect"].includes(data.action))await ocrJobs.prune(Math.max(0,storageBudget.limit-storageBudget.status().bytes));return result;});
  ipc("storage-budget",async value=>{if(value!==undefined)await storageBudget.setLimit(value);const ocr=await ocrJobs.prune(Math.max(0,storageBudget.limit-storageBudget.status().bytes));return {...storageBudget.status(),ocrBytes:ocr.bytes,pinnedOverBudget:ocr.pinnedOverBudget};});
  app.on("before-quit", () => ocrJobs.stop());
  ipc("qpdf", (data) => {
    if (!["qpdf-status", "qpdf-decrypt"].includes(data?.command))
      throw Error("无效的 qpdf 请求");
    return editorWorker("qpdf").run({
      command: data.command,
      bytes: data.bytes,
      password: data.password,
    });
  });
  ipc("qpdf-cancel", () => editorWorker("qpdf").cancel());
  ipc("save-stream-begin", (data) => fileStore.beginStream(data));
  ipc("save-stream-append", (data) => fileStore.appendStream(data));
  ipc("save-stream-finish", (id) => fileStore.finishStream(id));
  ipc("save-stream-abort", (id) => fileStore.abortStream(id));
  app.on("before-quit", () => fileStore.close());
  ipc("large-source",async handle=>(await largeFiles.entry(handle)).file);
  ipc("large-read", (data) => largeFiles.read(data));
  ipc("large-info", (data) => largeFiles.info(data));
  ipc("large-page", (data) => largeFiles.page(data));
  ipc("large-save", (data) => largeFiles.save(data));
  ipc("large-release", (handle) => largeFiles.release(handle));
  ipc("large-cancel", handle => largeFiles.cancel(handle));
  ipc("source-register", async bytes => {
    const owned = sources.get(sender());
    const registered = await sourceStore.register(bytes);
    const {handle} = registered;
    if (sources.get(sender()) !== owned) { await sourceStore.release(handle); throw Error("Document closed"); }
    owned.add(handle);
    return registered;
  });
  ipc("source-release", handle => sources.get(sender()).delete(handle) && sourceStore.release(handle));
  ipc("native", (data) => {
    const owner = sender();
    const options = { ...data };
    if (
      [
        "font-catalog",
        "font-select",
        "font-data",
        "font-recommend",
        "font-fast",
      ].includes(options.command)
    )
      return fontNative.run(options);
    delete options.ocrFile;
    if (options.ocrReference) {
      options.ocrFile = ocrJobs.resolveReference(options.ocrReference);
      delete options.ocr;
    }
    delete options.ocrReference;
    return (
      editorWorker(options.command === "flow-background" ? "background" : "native")
    ).run(options, (progress) => {
      if (!owner.isDestroyed()) owner.send("native-progress", progress);
    });
  });
  const { FlowLayout } = require("./flow-layout.cjs");
  const flowLayout = new FlowLayout(native.root, native.python);
  ipc("flow-layout", (data) => flowLayout.render(data));
  app.on("before-quit", () => flowLayout.close());
  win.on("closed", () => flowLayout.close());
  ipc("native-cancel", () => editorWorker("native").cancel());
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

const { contextBridge, ipcRenderer, webUtils } = require("electron");
const listen = (channel, callback) => {
  const fn = (_event, value) => callback(value);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};
contextBridge.exposeInMainWorld("desktop", {
  webPDF: options => ipcRenderer.invoke("web-pdf",options),
  systemLanguages: () => ipcRenderer.invoke("system-languages"),
  openDocuments: () => ipcRenderer.invoke("tabs-open"),
  dropDocuments: files => ipcRenderer.invoke("tabs-open", files.map(file => webUtils.getPathForFile(file))),
  tabsState: () => ipcRenderer.invoke("tabs-state"),
  offerRecovery: () => ipcRenderer.invoke("offer-recovery"),
  tabsReady: () => ipcRenderer.invoke("tabs-ready"),
  tabMeta: value => ipcRenderer.invoke("tabs-meta",value),
  tabSelect: id => ipcRenderer.invoke("tabs-select",id),
  tabClose: id => ipcRenderer.invoke("tabs-close",id),
  tabReply: value => ipcRenderer.invoke("tabs-reply",value),
  onTabs: cb => listen("tabs-state",cb),
  onTabRequest: cb => listen("tabs-request",cb),
  onTabError: cb => listen("tabs-error",cb),
  onNativeProgress: (callback) => {
    const fn = (_e, value) => callback(value);
    ipcRenderer.on("native-progress", fn);
    return () => ipcRenderer.removeListener("native-progress", fn);
  },
  storageBudget: (value) => ipcRenderer.invoke("storage-budget", value),
  aiPdf: (value) => ipcRenderer.invoke("ai-pdf", value),
  aiSnapshot: (bytes) => ipcRenderer.invoke("ai-snapshot", bytes),
  aiApproval: (auto) => ipcRenderer.invoke("ai-approval", auto),
  pickImage: () => ipcRenderer.invoke("pick-image"),
  generateImage: options => ipcRenderer.invoke("generate-image",options),
  imageConfig: () => ipcRenderer.invoke('image-config-get'),
  saveImageConfig: value => ipcRenderer.invoke('image-config-save',value),
  pickImageKeyFile: () => ipcRenderer.invoke('image-config-pick'),
  aiBounds: (bounds) => ipcRenderer.invoke("ai-bounds", bounds),
    aiProgress: (message) => ipcRenderer.invoke("ai-progress", message),
  aiOverlay: (hidden) => ipcRenderer.invoke("ai-overlay", hidden),
  aiDisplay: (mode) => ipcRenderer.invoke("ai-display", mode),
  onAIState: (callback) => {
    const fn = (_e, v) => callback(v);
    ipcRenderer.on("ai-state", fn);
    return () => ipcRenderer.removeListener("ai-state", fn);
  },
  aiOpen: () => ipcRenderer.invoke("ai-open"),
  aiReply: (value) => ipcRenderer.invoke("ai-reply", value),
  onAIRequest: (callback) => {
    const fn = (_e, value) => callback(value);
    ipcRenderer.on("ai-request", fn);
    return () => ipcRenderer.removeListener("ai-request", fn);
  },
  setLanguage: (value) => ipcRenderer.invoke("ui-language", value),
  updateInfo: () => ipcRenderer.invoke("update-info"),
  updateConfigure: (v) => ipcRenderer.invoke("update-configure", v),
  updateCheck: () => ipcRenderer.invoke("update-check"),
  updateDownload: () => ipcRenderer.invoke("update-download"),
  updateCancel: () => ipcRenderer.invoke("update-cancel"),
  updateInstall: () => ipcRenderer.invoke("update-install"),
  updateStarted: () => ipcRenderer.invoke("update-started"),
  onUpdate: (callback) => {
    const fn = (_e, v) => callback(v);
    ipcRenderer.on("update-state", fn);
    return () => ipcRenderer.removeListener("update-state", fn);
  },
  largeSource: (handle) => ipcRenderer.invoke("large-source", handle),
  largeRead: (data) => ipcRenderer.invoke("large-read", data),
  largePage: (data) => ipcRenderer.invoke("large-page", data),
  largeInfo: (data) => ipcRenderer.invoke("large-info", data),
  largeSave: (data) => ipcRenderer.invoke("large-save", data),
  largeRelease: (handle) => ipcRenderer.invoke("large-release", handle),
  largeCancel: handle => ipcRenderer.invoke("large-cancel", handle),
  ocrJob: (data) => ipcRenderer.invoke("ocr-job", data),
  flowLayout: (data) => ipcRenderer.invoke("flow-layout", data),
  qpdf: (data) => ipcRenderer.invoke("qpdf", data),
  cancelQpdf: () => ipcRenderer.invoke("qpdf-cancel"),
  registerSource: (bytes) => ipcRenderer.invoke("source-register", bytes),
  releaseSource: (handle) => ipcRenderer.invoke("source-release", handle),
  native: (data) => ipcRenderer.invoke("native", data),
  cancelNative: () => ipcRenderer.invoke("native-cancel"),
  graphics: (value) => ipcRenderer.invoke("graphics", value),
  fullscreen: () => ipcRenderer.invoke("fullscreen"),
  droppedFile: (file) =>
    ipcRenderer.invoke("open-drop", webUtils.getPathForFile(file)),
  open: (kind) => ipcRenderer.invoke("open", kind),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  prepareSave: (data) => ipcRenderer.invoke("save-prepare", data),
  beginSaveStream: (data) => ipcRenderer.invoke("save-stream-begin", data),
  appendSaveStream: (data) => ipcRenderer.invoke("save-stream-append", data),
  finishSaveStream: (id) => ipcRenderer.invoke("save-stream-finish", id),
  abortSaveStream: (id) => ipcRenderer.invoke("save-stream-abort", id),
  save: (data) => ipcRenderer.invoke("save", data),
  setDirty: (value) => ipcRenderer.invoke("dirty", value),
  close: () => ipcRenderer.invoke("close"),
  onClose: (callback) => ipcRenderer.on("request-close", () => callback()),
});

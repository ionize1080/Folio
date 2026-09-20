const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  onNativeProgress: (callback) => {
    const fn = (_e, value) => callback(value);
    ipcRenderer.on("native-progress", fn);
    return () => ipcRenderer.removeListener("native-progress", fn);
  },
  largeRead: (data) => ipcRenderer.invoke("large-read", data),
  largePage: (data) => ipcRenderer.invoke("large-page", data),
  largeInfo: (data) => ipcRenderer.invoke("large-info", data),
  largeSave: (data) => ipcRenderer.invoke("large-save", data),
  largeRelease: (handle) => ipcRenderer.invoke("large-release", handle),
  largeCancel: () => ipcRenderer.invoke("large-cancel"),
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

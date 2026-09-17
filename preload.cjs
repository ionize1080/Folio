const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  onNativeProgress: (callback) => {
    const fn = (_e, value) => callback(value);
    ipcRenderer.on("native-progress", fn);
    return () => ipcRenderer.removeListener("native-progress", fn);
  },
  ocrJob: (data) => ipcRenderer.invoke("ocr-job", data),
  flowLayout: (data) => ipcRenderer.invoke("flow-layout", data),
  qpdf: (data) => ipcRenderer.invoke("qpdf", data),
  cancelQpdf: () => ipcRenderer.invoke("qpdf-cancel"),
  native: (data) => ipcRenderer.invoke("native", data),
  cancelNative: () => ipcRenderer.invoke("native-cancel"),
  graphics: (value) => ipcRenderer.invoke("graphics", value),
  fullscreen: () => ipcRenderer.invoke("fullscreen"),
  droppedFile: (file) =>
    ipcRenderer.invoke("open-drop", webUtils.getPathForFile(file)),
  open: (kind) => ipcRenderer.invoke("open", kind),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  prepareSave: (data) => ipcRenderer.invoke("save-prepare", data),
  save: (data) => ipcRenderer.invoke("save", data),
  setDirty: (value) => ipcRenderer.invoke("dirty", value),
  close: () => ipcRenderer.invoke("close"),
  onClose: (callback) => ipcRenderer.on("request-close", () => callback()),
});

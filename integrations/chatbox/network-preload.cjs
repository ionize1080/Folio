require("electron").contextBridge.exposeInMainWorld("folioTransport", {
  start: (value) =>
    require("electron").ipcRenderer.invoke("folio:fetch", value),
  cancel: (id) =>
    require("electron").ipcRenderer.invoke("folio:fetch-cancel", id),
  subscribe: (fn) => {
    const listener = (_e, value) => fn(value);
    require("electron").ipcRenderer.on("folio:fetch-chunk", listener);
    return () =>
      require("electron").ipcRenderer.removeListener(
        "folio:fetch-chunk",
        listener,
      );
  },
});

require("electron").contextBridge.exposeInMainWorld("folioControls", {
  display: (mode) =>
    require("electron").ipcRenderer.invoke("folio:display", mode),
  approval: () => require("electron").ipcRenderer.invoke("folio:approval"),
  subscribe: (fn) => {
    require("electron").ipcRenderer.invoke("folio:state").then(fn).catch(()=>{});
    require("electron").ipcRenderer.on("folio:progress", (_e, progress) => fn({progress}));
    require("electron").ipcRenderer.on("folio:display", (_e, mode) =>
      fn({ mode }),
    );
    require("electron").ipcRenderer.on("folio:approval", (_e, auto) =>
      fn({ auto }),
    );
  },
});

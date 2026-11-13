const { WebContentsView } = require("electron");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

// Each editor retains its own PDF.js worker, history, selection and unapplied edits.
// Only the foreground view participates in layout. The first editor also hosts Home.
class DocumentTabs {
  constructor(win, options, configure, readFile) {
    Object.assign(this, {win, options, configure, readFile});
    this.entries = new Map();
    this.waiting = new Map();
    this.operations = Promise.resolve();
    this.home = this.register(win.webContents);
    this.active = this.home;
    win.on("resize", () => this.layout());
    win.on("closed", () => {
      for (const tab of this.entries.values()) tab.view?.webContents.close();
    });
  }
  register(wc, view) {
    const tab = {id: randomUUID(), wc, view, name:"", dirty:false};
    this.entries.set(wc, tab);
    this.configure(wc);
    this.resetReady(tab);
    wc.on("did-start-navigation", (_event, details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        tab.gone = false;
        this.resetReady(tab);
      }
    });
    // A crashed renderer never replies. Without this, request() waits forever
    // and the shared operations queue (open/close/window close) stalls behind it.
    wc.on("render-process-gone", () => {
      tab.gone = true;
      this.rejectWaiting(tab, "Document process exited");
      tab.resolveReady?.();
      tab.resolveReady = null;
    });
    wc.once("destroyed", () => {
      this.entries.delete(wc);
      this.rejectWaiting(tab, "Document closed");
    });
    return tab;
  }
  rejectWaiting(tab, message) {
    for (const [id, pending] of this.waiting) {
      if (pending.tab === tab) {
        this.waiting.delete(id);
        pending.reject(Error(message));
      }
    }
  }
  resetReady(tab) {
    if (!tab.resolveReady) tab.initialized = new Promise(resolve => { tab.resolveReady = resolve; });
  }
  ready(wc) {
    const tab = this.entries.get(wc);
    tab.resolveReady?.();
    tab.resolveReady = null;
    this.onReady?.(tab);
  }
  documents() {
    return [...this.entries.values()].filter(t => t.name);
  }
  snapshot() {
    return {activeDocumentId:this.active.id, documents:this.documents().map(t => ({
      documentId:t.id, name:t.name, dirty:t.dirty
    }))};
  }
  publish() {
    const state = this.snapshot();
    for (const t of this.entries.values())
      if (!t.wc.isDestroyed()) t.wc.send("tabs-state", {...state, self:t.id});
  }
  byId(id) {
    const tab = this.documents().find(t => t.id === id);
    if (!tab) throw Error("Document is closed or unknown");
    return tab;
  }
  layout() {
    if (this.active.view) {
      const [width,height] = this.win.getContentSize();
      this.active.view.setBounds({x:0,y:0,width,height});
    }
  }
  select(tab) {
    if (this.active.view) this.win.contentView.removeChildView(this.active.view);
    this.active = tab;
    if (tab.view) this.win.contentView.addChildView(tab.view, 0);
    this.layout();
    tab.wc.focus();
    this.publish();
    this.onSelect?.(tab);
  }
  enqueue(fn) {
    const work = this.operations.then(fn);
    this.operations = work.catch(() => {});
    return work;
  }
  async open(paths) {
    const errors = [];
    for (const file of paths) {
      if (!/\.(pdf|folio)$/i.test(file)) continue;
      try {
        const key = process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
        const existing = this.documents().find(t => t.key === key);
        if (existing) { this.select(existing); continue; }
        const payload = await this.readFile(file);
        let tab = this.home;
        if (tab.name) {
          const view = new WebContentsView({webPreferences:this.options});
          tab = this.register(view.webContents, view);
        }
        tab.name = path.basename(file);
        tab.key = key;
        this.select(tab);
        try {
          if (tab.view) await tab.wc.loadURL("folio://app/index.html");
          if (!await this.request(tab, "load", payload)) this.remove(tab);
        } catch (e) { this.remove(tab); throw e; }
      } catch (e) { errors.push(path.basename(file) + " — " + e.message); }
    }
    if (errors.length) this.active.wc.send("tabs-error", errors.join("\n"));
  }
  async request(tab, action, file) {
    await tab.initialized;
    if (tab.gone || tab.wc.isDestroyed()) throw Error("Document process exited");
    return new Promise((resolve,reject) => {
      const id = randomUUID();
      this.waiting.set(id, {tab,resolve,reject});
      tab.wc.send("tabs-request", {id,action,file});
    });
  }
  reply(wc, {id,result,error}) {
    const pending = this.waiting.get(id);
    if (pending?.tab.wc !== wc) return;
    this.waiting.delete(id);
    if (error) pending.reject(Error(error));
    else pending.resolve(result);
  }
  remove(tab) {
    const order = this.documents(), index = order.indexOf(tab);
    this.onRemove?.(tab);
    Object.assign(tab, {name:"",key:null,dirty:false,busy:false});
    if (this.active === tab) this.select(order[index+1] || order[index-1] || this.home);
    if (tab.view) {
      this.entries.delete(tab.wc);
      tab.wc.close();
    } else {
      tab.id = randomUUID();
      this.resetReady(tab);
      tab.wc.reload();
    }
    this.publish();
  }
  async closeOne(id) {
    const tab = this.byId(id);
    // Unsaved state died with the renderer; there is nothing left to confirm.
    if (tab.gone) return this.remove(tab);
    if (tab.dirty || tab.busy) this.select(tab);
    if (await this.request(tab, "confirm-close")) this.remove(tab);
  }
  async confirmWindow() {
    for (const tab of this.documents()) {
      if (tab.gone || (!tab.dirty && !tab.busy)) continue;
      this.select(tab);
      if (!await this.request(tab, "confirm-close")) return false;
    }
    return true;
  }
}
module.exports = { DocumentTabs };

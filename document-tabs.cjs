const { BaseWindow, WebContentsView } = require("electron");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

// Each editor retains its own PDF.js worker, history, selection and unapplied edits.
// Inactive editors stay alive. New editors paint in a hidden native host before
// joining the visible window; the first editor also hosts Home.
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
      this.preparationWindow?.destroy();
    });
  }
  register(wc, view) {
    const tab = {id: randomUUID(), wc, view, name:"", dirty:false};
    this.entries.set(wc, tab);
    this.configure(wc);
    this.resetReady(tab);
    wc.on("did-start-navigation", (details) => {
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
      tab.gone = true;
      tab.resolveReady?.();
      tab.resolveReady = null;
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
    if (!tab) return;
    tab.resolveReady?.();
    tab.resolveReady = null;
    this.onReady?.(tab);
  }
  documents() {
    return [...this.entries.values()].filter(t => t.name);
  }
  snapshot() {
    return {activeDocumentId:this.active.id, documents:this.documents().map(t => ({
      documentId:t.id, name:t.name, dirty:t.dirty, loading:!!t.loading
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
    const [width,height] = this.win.getContentSize();
    this.preparationWindow?.setContentSize(width, height);
    for (const tab of this.entries.values())
      if (tab.view && (tab === this.active || tab.loading))
        tab.view.setBounds({x:0,y:0,width,height});
  }
  select(tab, attention = false) {
    if (attention) tab.attention = true;
    if (tab.loading && !tab.attention) { tab.requested = true; return; }
    if (this.active === tab) { this.publish(); return; }
    const previous = this.active;
    this.active = tab;
    // Attach a prepared frame before detaching the old view. There is never an
    // intermediate frame exposing the home editor or an unstyled blank page.
    this.layout();
    if (tab.view) {
      this.preparationWindow?.contentView.removeChildView(tab.view);
      this.win.contentView.addChildView(tab.view, 0);
      tab.view.setVisible(true);
    }
    if (previous.view) this.win.contentView.removeChildView(previous.view);
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
        const foreground = this.active;
        let tab = this.home;
        if (tab.name) {
          const view = new WebContentsView({webPreferences:{...this.options, backgroundThrottling:false}});
          tab = this.register(view.webContents, view);
          // A detached/offscreen View has no paintable viewport on Windows.
          // A hidden native host gives PDF.js a real layout and animation clock
          // without covering or resizing the document the user is reading.
          this.preparationWindow ||= new BaseWindow({show:false, frame:false, skipTaskbar:true});
          this.preparationWindow.contentView.addChildView(view);
        }
        tab.name = path.basename(file);
        tab.key = key;
        tab.loading = true;
        this.layout();
        this.publish();
        try {
          // Read the file and initialize its isolated editor concurrently while
          // the current document stays visible and usable.
          const [payload] = await Promise.all([
            this.readFile(file),
            tab.view ? tab.wc.loadURL("folio://app/index.html") : Promise.resolve(),
          ]);
          if (!await this.request(tab, "load", payload)) { this.remove(tab); continue; }
          if (tab.view) {
            // load() acknowledges the first PDF page, not just DOM readiness.
            // capturePage also submits the prepared compositor frame while hidden.
            await tab.wc.capturePage(undefined, {stayHidden:true, stayAwake:true});
            tab.wc.setBackgroundThrottling(this.options.backgroundThrottling !== false);
          }
          tab.loading = false;
          tab.attention = false;
          if (this.active === foreground || this.active === tab || tab.requested) this.select(tab);
          else this.publish();
        } catch (e) { this.remove(tab); throw e; }
      } catch (e) { errors.push(path.basename(file) + " — " + e.message); }
    }
    if (errors.length && !this.active.wc.isDestroyed()) this.active.wc.send("tabs-error", errors.join("\n"));
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
    Object.assign(tab, {name:"",key:null,dirty:false,busy:false,loading:false,requested:false,attention:false});
    if (this.active === tab) this.select(order[index+1] || order[index-1] || this.home);
    if (tab.view) {
      this.preparationWindow?.contentView.removeChildView(tab.view);
      if (this.win.contentView.children.includes(tab.view)) this.win.contentView.removeChildView(tab.view);
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

import { icon } from "./icons.mjs";
import { showContextMenu } from "./context-menu.mjs";
import { getLanguage, onLanguageChange } from "./i18n.mjs";

export function installDocumentTabs({open, confirmClose, toast}) {
  const api = window.desktop;
  if (!api?.tabsState) return;
  const strip = document.createElement("div");
  strip.className = "document-tabs";
  strip.setAttribute("role", "tablist");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "tab-add";
  addBtn.innerHTML = icon("plus");
  addBtn.title = "打开文档 Ctrl+O";
  addBtn.setAttribute("aria-label", "打开文档");
  addBtn.onclick = () => api.openDocuments?.().catch((e) => toast(e.message));
  strip.append(addBtn);
  document.querySelector(".doc-tab").after(strip);
  let state;
  const nodes = new Map();
  const select = id => api.tabSelect(id).catch(e => toast(e.message));
  const close = id => api.tabClose(id).catch(e => toast(e.message));
  function draw(value = state) {
    if (!value) return;
    const previousActive = state?.activeDocumentId;
    state = value;
    strip.hidden = !state.documents.length;
    document.body.classList.toggle("has-tabs", !strip.hidden);
    const labels = {en:["Open documents","Close","Unsaved changes"],"zh-Hans":["打开的文档","关闭","有未保存更改"],"zh-Hant":["開啟的文件","關閉","有未儲存變更"]}[getLanguage()];
    strip.setAttribute("aria-label",labels[0]);
    const ids = new Set(state.documents.map(d => d.documentId));
    for (const [id, item] of nodes) if (!ids.has(id)) { item.group.remove(); nodes.delete(id); }
    for (const {documentId,name,dirty,loading} of state.documents) {
      let item = nodes.get(documentId);
      if (!item) {
        const group = document.createElement("div");
        group.className = "document-tab";
        const tab = document.createElement("button");
        tab.dataset.tabId = documentId;
        tab.setAttribute("role", "tab");
        tab.innerHTML = icon("file");
        const title = document.createElement("span");
        title.translate = false;
        tab.append(title);
        const selectTab = () => {
          if (state?.activeDocumentId !== documentId) select(documentId);
        };
        tab.onpointerdown = e => {
          if (e.button === 0 && e.pointerType !== "touch") selectTab();
        };
        tab.onclick = selectTab;
        const x = document.createElement("button");
        x.className = "tab-close";
        x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
        x.onclick = () => close(documentId);
        group.addEventListener('contextmenu', e => {
          const docs = state.documents, at = docs.findIndex(d => d.documentId === documentId);
          const closeMany = async list => { for (const d of list) { try { await api.tabClose(d.documentId); } catch (err) { toast(err.message); break; } } };
          const name = docs[at]?.name || '';
          showContextMenu(e, [
            ['切换到此标签页', () => select(documentId), state.activeDocumentId === documentId],
            null,
            ['关闭标签页', () => close(documentId)],
            ['关闭其他标签页', () => closeMany(docs.filter(d => d.documentId !== documentId)), docs.length < 2],
            ['关闭右侧标签页', () => closeMany(docs.slice(at + 1)), at < 0 || at >= docs.length - 1],
            null,
            ['复制文件名', () => (api.copyText ? api.copyText(name) : navigator.clipboard.writeText(name)).then(() => toast('已复制文件名'))],
          ]);
        });
        group.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); close(documentId); } });
        group.append(tab, x);
        strip.insertBefore(group, addBtn);
        item = {group, tab, title, x};
        nodes.set(documentId, item);
      }
      const {group, tab, title, x} = item;
      const active = documentId === state.activeDocumentId;
      group.classList.toggle("active",active);
      group.classList.toggle("loading", !!loading);
      tab.setAttribute("aria-selected",String(active));
      tab.setAttribute("aria-busy", String(!!loading));
      tab.tabIndex = active ? 0 : -1;
      tab.title = dirty ? name + " · " + labels[2] : name;
      tab.setAttribute("aria-label",tab.title);
      if (title.textContent !== name) title.textContent = name;
      tab.classList.toggle("modified", !!dirty);
      x.title = labels[1] + " " + name;
      x.setAttribute("aria-label",x.title);
    }
    // Dirty/busy updates must not destroy focused buttons or restart animations.
    if (previousActive !== state.activeDocumentId)
      nodes.get(state.activeDocumentId)?.tab.scrollIntoView({inline:"nearest",block:"nearest"});
  }
  api.onTabs(draw);
  api.onTabError(toast);
  api.onTabRequest(async ({id,action,file}) => {
    try {
      const result = action === "load" ? await open(file) : await confirmClose();
      await api.tabReply({id,result});
    } catch (e) { await api.tabReply({id,error:e.message}); }
  });
  onLanguageChange(() => draw());
  document.addEventListener("keydown", e => {
    if (!state?.documents.length) return;
    const onStrip = strip.contains(e.target) && e.target.closest?.('[role="tab"]');
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "w") {
      e.preventDefault(); close(state.activeDocumentId);
    } else if ((e.ctrlKey && key === "tab") || (onStrip && ["arrowleft","arrowright","home","end"].includes(key))) {
      e.preventDefault();
      const docs = state.documents;
      let i = docs.findIndex(d => d.documentId === state.activeDocumentId);
      i += (e.shiftKey || key === "arrowleft") ? -1 : 1;
      if (key === "home") i = 0;
      if (key === "end") i = docs.length-1;
      select(docs[(i + docs.length) % docs.length].documentId);
    }
  },true);
  api.tabsState().then(draw).then(() => api.tabsReady());
}

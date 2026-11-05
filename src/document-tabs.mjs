import { icon } from "./icons.mjs";
import { getLanguage, onLanguageChange } from "./i18n.mjs";

export function installDocumentTabs({open, confirmClose, toast}) {
  const api = window.desktop;
  if (!api?.tabsState) return;
  const strip = document.createElement("div");
  strip.className = "document-tabs";
  strip.setAttribute("role", "tablist");
  document.querySelector(".doc-tab").after(strip);
  let state;
  const select = id => api.tabSelect(id).catch(e => toast(e.message));
  const close = id => api.tabClose(id).catch(e => toast(e.message));
  function draw(value = state) {
    if (!value) return;
    state = value;
    strip.hidden = !state.documents.length;
    document.body.classList.toggle("has-tabs", !strip.hidden);
    const labels = {en:["Open documents","Close","Unsaved changes"],"zh-Hans":["打开的文档","关闭","有未保存更改"],"zh-Hant":["開啟的文件","關閉","有未儲存變更"]}[getLanguage()];
    strip.setAttribute("aria-label",labels[0]);
    const focused = document.activeElement?.dataset.tabId;
    const buttons = state.documents.map(({documentId,name,dirty}) => {
      const group = document.createElement("div");
      group.className = "document-tab";
      const active = documentId === state.activeDocumentId;
      group.classList.toggle("active",active);
      const tab = document.createElement("button");
      tab.dataset.tabId = documentId;
      tab.setAttribute("role","tab");
      tab.setAttribute("aria-selected",String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.title = dirty ? name + " · " + labels[2] : name;
      tab.setAttribute("aria-label",tab.title);
      tab.innerHTML = icon("file");
      const title = document.createElement("span");
      title.translate = false;
      title.textContent = name;
      tab.append(title);
      if (dirty) tab.classList.add("modified");
      tab.onclick = () => select(documentId);
      const x = document.createElement("button");
      x.className = "tab-close";
      x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
      x.title = labels[1] + " " + name;
      x.setAttribute("aria-label",x.title);
      x.onclick = () => close(documentId);
      group.append(tab,x);
      return group;
    });
    strip.replaceChildren(...buttons);
    const current = strip.querySelector('[aria-selected="true"]');
    current?.scrollIntoView({inline:"nearest",block:"nearest"});
    if (focused) current?.focus({preventScroll:true});
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
    const onStrip = e.target.closest?.('[role="tab"]');
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

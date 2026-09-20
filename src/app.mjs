import { openLargeWorkspace } from "./large-workspace.mjs";
import DOMPurify from "./vendor/purify.es.mjs";
import { nativeRequest, releaseSource } from "./native-source.mjs";
import { DocumentSession, readSettings, safeJSON } from "./session-state.mjs";
import { editIdentity, immutableEdits } from "./edit-assets.mjs";
import { preparePDFOpen, decryptForOpen } from "./encrypted-open.mjs";
import { decryptDialog } from "./decrypt-ui.mjs";
import { RuleMemory, captureFields, restoreFields } from "./rule-memory.mjs";
import { tableDialog } from "./table-ui.mjs";
import { pageDiff } from "./page-diff.mjs";
import { splitDialog } from "./bookmark-split-ui.mjs";
import { installDropOpen } from "./drop-open.mjs";
import { bindUnit, preferredUnit, fromPoints, toPoints } from "./units.mjs";
import { encodeProject, decodeProject } from "./project.mjs";
import { copyRegionDialog } from "./copy-region-ui.mjs";
import { installPagePicker, compactPages } from "./page-picker.mjs";
import { extractLines } from "./text-lines.mjs";
import { patchStyles, duplicatePlan } from "./bookmark-tools.mjs";
import { installBookmarkUI } from "./bookmark-ui.mjs";
import { installNativeUI } from "./native-ui.mjs";
import { describeChanges } from "./changes.mjs";
import { PageSurface } from "./viewer.mjs";
import {
  pageRange,
  defaultRules,
  industryRules,
  insertGenerated,
} from "./generation.mjs";
import { recoveryStore, recoveryRead, recoveryList } from "./recovery.mjs";
import { installShortcuts, shortcutDialog } from "./shortcuts.mjs";
import * as pdfjs from "./vendor/pdf.mjs";
import {
  MODES,
  uid,
  clone,
  makeNode,
  validate,
  descendants,
  depths,
  childrenMap,
  move,
  sortTree,
  deduplicate,
  importJSON,
  parseTOC,
  History,
  shareOCR,
} from "./model.mjs";
import { icons, icon } from "./icons.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "./vendor/pdf.worker.mjs",
  import.meta.url,
).href;
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)],
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const settings = readSettings(
  {
    whitespaceUnit: "mm",
    saveSummary: false,
    protect: true,
    restoreView: true,
    ignoreZoom: false,
    layout: "continuous",
    leftMode: "full",
    rightMode: "narrow",
    inspectorWidth: 280,
    wrap: false,
    gaps: true,
    cover: true,
    shortcuts: {},
    theme: "light",
    sidebar: 250,
    row: 34,
    quality: 2,
    undo: 40,
    showBookmarks: true,
  },
  localStorage.getItem("folio-settings"),
);
const documentSession = new DocumentSession();
const S = {
  sessionId: documentSession.id,
  pdf: null,
  bytes: null,
  name: "",
  nodes: [],
  selected: new Set(),
  collapsed: new Set(),
  page: 1,
  zoom: "width",
  handle: null,
  working: false,
  baseline: null,
  scale: 1,
  rotation: {},
  annotations: [],
  nativeEdits: [],
  structures: [],
  ocr: [],
  metadata: null,
  info: null,
  dirty: false,
  busy: false,
  visible: [],
  index: new Map(),
  depth: new Map(),
  children: new Map(),
  view: null,
  history: new History(settings.undo),
  filter: "",
  hits: [],
  hitIndex: -1,
};
let worker = null,
  sequence = 0,
  pending = new Map(),
  renderToken = 0,
  renderTask,
  textTask,
  filterTimer,
  toastTimer,
  findToken = 0,
  modalCleanup = null;
function launchWorker() {
  worker?.terminate();
  pending.forEach((p) => p.reject(Error("文档已切换")));
  pending.clear();
  worker = new Worker(new URL("./pdf-worker.mjs", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    e.data.error ? p.reject(Error(e.data.error)) : p.resolve(e.data.result);
  };
  worker.onerror = (e) => {
    for (const p of pending.values())
      p.reject(Error(e.message || "PDF 引擎异常"));
    pending.clear();
  };
}
function rpc(method, args, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, args }, transfer);
  });
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4200);
}
function status(text) {
  $("#status").textContent = text;
}
function setDirty(value = true) {
  S.dirty = value;
  $("#dirty-dot").classList.toggle("changed", value);
  window.desktop?.setDirty(value);
  scheduleRecovery();
}
function setBusy(value, label = "处理中…") {
  S.busy = value;
  $("#busy").hidden = !value;
  $("#busy-text").textContent = label;
  $$("[data-doc]").forEach(
    (b) => (b.disabled = (value && !b.hasAttribute("data-cancel")) || !S.pdf),
  );
}
const ocrIdentities = new WeakMap();
function stateKey(v = snapshot()) {
  const blocks = v.ocr || [];
  if (!ocrIdentities.has(blocks))
    ocrIdentities.set(blocks, crypto.randomUUID());
  return JSON.stringify({
    ...v,
    nativeEdits: editIdentity(v.nativeEdits || []),
    ocr: ocrIdentities.get(blocks),
  });
}
function snapshot() {
  return {
    nodes: S.nodes,
    rotation: S.rotation,
    annotations: S.annotations,
    nativeEdits: S.nativeEdits,
    structures: S.structures || [],
    ocr: S.ocr,
    ocrReference: S.ocrReference || null,
    metadata: S.metadata,
  };
}
function commit(nodes, extra = {}) {
  if (S.busy) throw Error("正在处理文档，请稍候");
  validate(nodes, S.info.pageCount);
  S.history.push(snapshot());
  S.nodes = nodes;
  if (extra.ocr) extra.ocr = shareOCR(extra.ocr);
  if (extra.nativeEdits) extra.nativeEdits = immutableEdits(extra.nativeEdits);
  documentSession.change();
  Object.assign(S, extra);
  setDirty(stateKey() !== S.baseline);
  rebuild();
}
async function restore(v) {
  if (!v) return;
  if (
    v.nativeEdits !== S.nativeEdits ||
    (v.ocr || []).length !== S.ocr.length ||
    v.ocr !== S.ocr
  )
    await refreshNative(v.nativeEdits || [], v.ocr || [], v.ocrReference);
  Object.assign(S, v);
  documentSession.change();
  setDirty(stateKey() !== S.baseline);
  rebuild();
  renderPage();
}
async function restoreHistory(direction) {
  if (S.busy) return;
  const past = [...S.history.past],
    future = [...S.history.future],
    assets = new Map(S.history.assets.values);
  try {
    await restore(S.history[direction](snapshot()));
  } catch (e) {
    S.history.past = past;
    S.history.future = future;
    S.history.assets.values = assets;
    throw e;
  }
}
function error(err) {
  console.error(err);
  const message = err.message || String(err);
  const banner = $("#modal-error");
  if ($("#modal").open && banner) {
    banner.hidden = false;
    banner.textContent = message;
    banner.scrollIntoView({ block: "nearest" });
  } else toast(message);
  status("操作未完成");
}
async function guarded(fn) {
  try {
    await fn();
  } catch (err) {
    error(err);
  }
}
function applySettings(redraw = true) {
  document.body.classList.toggle("dark", settings.theme === "dark");
  document.documentElement.style.setProperty(
    "--sidebar",
    settings.sidebar + "px",
  );
  document.documentElement.style.setProperty("--row", settings.row + "px");
  S.history.limit = settings.undo;
  document.body.dataset.left = settings.leftMode;
  document.body.dataset.right = settings.rightMode;
  document.documentElement.style.setProperty(
    "--inspector-width",
    settings.inspectorWidth + "px",
  );
  document.body.classList.toggle("wrap-titles", settings.wrap);
  localStorage.setItem("folio-settings", JSON.stringify(settings));
  if (S.pdf) {
    rebuild();
    if (redraw) renderPage();
  }
}
function modal(title, body, buttons = []) {
  closeModal();
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML =
    `<div id="modal-error" class="callout error" role="alert" hidden></div>` +
    DOMPurify.sanitize(body, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: [
        "style",
        "link",
        "meta",
        "base",
        "iframe",
        "object",
        "embed",
      ],
      FORBID_ATTR: ["srcdoc", "formaction"],
    });
  $("#modal-footer").replaceChildren();
  for (const b of buttons) {
    const el = document.createElement("button");
    el.textContent = b.text;
    el.className = b.primary ? "primary" : "";
    if (b.id) el.id = b.id;
    el.onclick = () => guarded(b.run);
    $("#modal-footer").append(el);
  }
  icons($("#modal"));
  $("#modal").showModal();
}
function closeModal() {
  modalCleanup?.();
  modalCleanup = null;
  $("#modal").close();
}
async function confirmDialog(title, text, yes = "继续") {
  return new Promise((resolve) => {
    const finish = (value) => {
      modalCleanup = null;
      closeModal();
      resolve(value);
    };
    modal(title, `<p>${esc(text)}</p>`, [
      { text: "取消", run: () => finish(false) },
      { text: yes, primary: true, run: () => finish(true) },
    ]);
    modalCleanup = () => resolve(false);
  });
}
async function confirmDiscard() {
  try {
    await S.flowEdit?.finish(true);
  } catch (e) {
    error(e);
    return false;
  }
  if (!S.dirty) return true;
  return new Promise((resolve) => {
    const done = (v) => {
      modalCleanup = null;
      closeModal();
      resolve(v);
    };
    modal("当前文档有未保存更改", "<p>是否保存当前文档后继续？</p>", [
      { text: "取消", run: () => done(false) },
      { text: "放弃并继续", run: () => done(true) },
      {
        text: "保存并继续",
        primary: true,
        run: async () => {
          const result = await savePDF(false, true);
          done(result?.status === "saved" && !S.dirty);
        },
      },
    ]);
    modalCleanup = () => resolve(false);
  });
}
async function choose(kind) {
  if (window.desktop) return window.desktop.open(kind);
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept =
      kind === "pdf" ? ".pdf" : kind === "json" ? ".json" : ".txt,.tsv";
    input.onchange = async () =>
      resolve(
        input.files[0]
          ? {
              name: input.files[0].name,
              bytes: new Uint8Array(await input.files[0].arrayBuffer()),
            }
          : null,
      );
    input.oncancel = () => resolve(null);
    input.click();
  });
}
async function writeFile(name, bytes, kind) {
  if (bytes instanceof Blob && window.desktop?.beginSaveStream) {
    const ticket = await window.desktop.prepareSave({ name, kind });
    if (!ticket) return null;
    const id = await window.desktop.beginSaveStream({
      ticket,
      kind,
      total: bytes.size,
    });
    try {
      for (let offset = 0; offset < bytes.size; offset += 2 * 1024 ** 2)
        await window.desktop.appendSaveStream({
          id,
          offset,
          bytes: new Uint8Array(
            await bytes.slice(offset, offset + 2 * 1024 ** 2).arrayBuffer(),
          ),
        });
      return await window.desktop.finishSaveStream(id);
    } catch (e) {
      await window.desktop.abortSaveStream(id);
      throw e;
    }
  }
  if (bytes instanceof Blob && window.desktop)
    bytes = new Uint8Array(await bytes.arrayBuffer());
  if (window.desktop) return window.desktop.save({ name, bytes, kind });
  const u = URL.createObjectURL(
    new Blob([bytes], {
      type: kind === "pdf" ? "application/pdf" : "application/octet-stream",
    }),
  );
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 30000);
  return true;
}
async function openFile() {
  if (S.busy) return;
  const f = await choose("pdf");
  if (f) await openIncoming(f);
}
let largeWorkspace = null;
let loadEpoch = 0;
async function loadPDF(
  bytes,
  name,
  handle = null,
  restoredState = null,
  composedBytes = null,
  requestEpoch = ++loadEpoch,
) {
  if (/\.folio$/i.test(name)) {
    setBusy(true, "正在校验工作工程…");
    let project;
    try {
      project = await decodeProject(bytes);
      let composed = null;
      if (project.state.nativeEdits.length || project.state.ocr.length) {
        if (!window.desktop?.native)
          throw Error("此工程含内容编辑，需要完整桌面运行包");
        composed = new Uint8Array(
          (
            await nativeRequest({
              command: "apply",
              bytes: project.bytes,
              edits: project.state.nativeEdits,
              ocr: project.state.ocr,
            })
          ).bytes,
        );
      }
      const opened = await loadPDF(
        project.bytes,
        project.name,
        null,
        project.state,
        composed,
        requestEpoch,
      );
      if (opened) toast("工程已恢复；保存 PDF 时请选择输出位置");
      return opened;
    } finally {
      if (project && S.bytes !== project.bytes)
        void releaseSource(project.bytes);
      if (requestEpoch === loadEpoch) setBusy(false);
    }
  }
  saveView();
  setBusy(true, "正在解析 PDF 与书签…");
  try {
    if (bytes.length > 768 * 1024 * 1024)
      throw Error("当前版本单文件上限为 768 MB");
    const prepared = await preparePDFOpen(bytes, {
      parse: (data) => {
        const temp = new Worker(new URL("./pdf-worker.mjs", import.meta.url), {
          type: "module",
        });
        return new Promise((resolve, reject) => {
          temp.onmessage = (e) => {
            if (e.data.error) {
              temp.terminate();
              reject(Object.assign(Error(e.data.error), { code: e.data.code }));
            } else resolve({ temp, info: e.data.result });
          };
          temp.onerror = (e) => {
            temp.terminate();
            reject(Error(e.message));
          };
          const copy = new Uint8Array(data);
          temp.postMessage({ id: 0, method: "open", args: copy }, [
            copy.buffer,
          ]);
        });
      },
      unlock: (data) =>
        decryptForOpen({
          bytes: data,
          name,
          modal,
          closeModal,
          setBusy,
          setCleanup: (fn) => (modalCleanup = fn),
        }),
    });
    if (!prepared) return false;
    const { temp, info, openedEncrypted } = prepared;
    bytes = prepared.bytes;
    setBusy(true, "正在加载页面与书签…");
    let pdf;
    try {
      pdf = await pdfjs.getDocument({
        data: new Uint8Array(composedBytes || bytes),
        cMapUrl: new URL("./vendor/cmaps/", import.meta.url).href,
        cMapPacked: true,
        standardFontDataUrl: new URL(
          "./vendor/standard_fonts/",
          import.meta.url,
        ).href,
        wasmUrl: new URL("./vendor/wasm/", import.meta.url).href,
        isEvalSupported: false,
        enableXfa: false,
      }).promise;
    } catch (e) {
      temp.terminate();
      throw e;
    }
    if (restoredState) {
      try {
        validate(restoredState.nodes, info.pageCount);
      } catch (e) {
        temp.terminate();
        await pdf.destroy();
        throw e;
      }
    }
    if (requestEpoch !== loadEpoch) {
      temp.terminate();
      await pdf.destroy();
      return false;
    }
    void releaseSource(S.bytes);
    documentSession.replace();
    S.sessionId = documentSession.id;
    S.flowEdit?.destroy();
    findToken++;
    renderToken++;
    renderTask?.cancel();
    textTask?.cancel();
    surface.cancel();
    await S.pdf?.destroy();
    worker?.terminate();
    worker = temp;
    pending.forEach((p) => p.reject(Error("文档已切换")));
    pending.clear();
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      e.data.error ? p.reject(Error(e.data.error)) : p.resolve(e.data.result);
    };
    worker.onerror = (e) => {
      pending.forEach((p) => p.reject(Error(e.message)));
      pending.clear();
    };
    Object.assign(S, {
      pdf,
      bytes,
      name,
      handle,
      working: false,
      openedEncrypted,
      nodes: info.nodes,
      selected: new Set(),
      collapsed: new Set(info.nodes.filter((n) => !n.open).map((n) => n.id)),
      page: 1,
      zoom: "width",
      rotation: {},
      annotations: [],
      nativeEdits: [],
      structures: [],
      ocr: [],
      ocrReference: null,
      selectedPages: new Set(),
      rangeStart: null,
      rangeEnd: null,
      metadata: info.metadata,
      info,
      hits: [],
      hitIndex: -1,
      filter: "",
    });
    S.history.clear();
    clipboardNodes = null;
    clipboardCut = null;
    $("#filter").value = "";
    $("#zoom").value = "width";
    $("#doc-name").textContent = name;
    $("#doc-name").title = name;
    $("#page-total").textContent = "/ " + info.pageCount;
    $("#page-number").max = info.pageCount;
    $("#welcome").hidden = true;
    S.labels = await pdf.getPageLabels().catch(() => null);
    S.fingerprint = pdf.fingerprints[0];
    S.baseline = stateKey();
    if (restoredState)
      Object.assign(S, restoredState, {
        nativeEdits: immutableEdits(restoredState.nativeEdits),
        ocr: shareOCR(restoredState.ocr),
      });
    document.body.classList.add("has-document");
    surface.reset();
    surface.layout = settings.layout;
    surface.cover = settings.cover;
    surface.gaps = settings.gaps;
    setDirty(!!restoredState);
    rebuild();
    const remembered = settings.restoreView
      ? safeJSON(localStorage.getItem("folio-view-" + S.fingerprint))
      : null;
    if (remembered) {
      S.page = Math.min(info.pageCount, remembered.page);
      S.zoom = remembered.zoom;
      surface.layout = remembered.layout;
      surface.viewRotation = remembered.viewRotation || 0;
      await surface.refresh(remembered);
    } else {
      const initial = await pdf.getPageLayout().catch(() => null);
      if (!settings.restoreView && initial)
        surface.layout =
          {
            SinglePage: "single",
            OneColumn: "continuous",
            TwoColumnLeft: "two-continuous",
            TwoColumnRight: "two-continuous",
            TwoPageLeft: "two",
            TwoPageRight: "two",
          }[initial] || surface.layout;
      await renderPage();
      const open = await pdf.getOpenAction().catch(() => null);
      if (!settings.restoreView && open?.dest) {
        const d = open.dest,
          ref = d[0],
          page =
            typeof ref === "number"
              ? ref + 1
              : await pdf.getPageIndex(ref).then((i) => i + 1);
        await jump({ target: { page, mode: d[1]?.name, args: d.slice(2) } });
      }
    }
    syncZoom();
    syncLayout();
    status(
      `${info.pageCount} 页 · ${info.nodes.length.toLocaleString()} 个书签`,
    );
    if (openedEncrypted)
      toast(
        "已解密打开，首次保存将另存为无密码副本" +
          (prepared.signed ? "；重写后的文档需重新签署" : ""),
      );
    else if (info.warnings.length) toast(info.warnings.join("；"));
    return true;
  } finally {
    if (requestEpoch === loadEpoch) setBusy(false);
  }
}
async function savePDF(forceAs = false, skipSummary = false) {
  await S.flowEdit?.flush();
  if (!S.pdf || S.busy) return { status: "cancelled" };
  const saveSession = documentSession.capture();
  if (!forceAs && S.working && !S.dirty) {
    toast("文档已保存，没有新的修改");
    return { status: "saved" };
  }
  if (settings.saveSummary && !skipSummary) {
    const old = JSON.parse(S.baseline || "{}"),
      ids = new Map((old.nodes || []).map((n) => [n.id, n])),
      current = new Set(S.nodes.map((n) => n.id)),
      added = S.nodes.filter((n) => !ids.has(n.id)).length,
      changed = S.nodes.filter(
        (n) =>
          ids.has(n.id) && JSON.stringify(n) !== JSON.stringify(ids.get(n.id)),
      ).length,
      removed = (old.nodes || []).filter((n) => !current.has(n.id)).length;
    if (
      !(await confirmDialog(
        "保存修改摘要",
        `书签新增 ${added} 项、修改 ${changed} 项、删除 ${removed} 项；当前含 ${S.annotations.length} 个新增批注、${Object.keys(S.rotation).length} 页旋转设置、${S.nativeEdits.length} 个内容编辑、${S.ocr.length} 条 OCR 文字。`,
        "保存",
      ))
    )
      return;
  }
  const protect = settings.protect || !!S.openedEncrypted;
  const name =
    !S.working && (protect || forceAs)
      ? S.name.replace(/\.pdf$/i, "").replace(/-edited$/i, "") + "-edited.pdf"
      : S.name;
  setBusy(true, "选择保存位置…");
  const started = performance.now(),
    timings = {};
  let timer;
  try {
    const ticket = window.desktop?.prepareSave
      ? await window.desktop.prepareSave({
          name,
          kind: "pdf",
          handle: S.handle,
          working: S.working,
          protect,
          forceAs,
        })
      : null;
    if (window.desktop?.prepareSave && !ticket) return { status: "cancelled" };
    documentSession.assert(saveSession);
    const state = stateKey();
    let stage = "整理书签与文档属性";
    const contentBytes =
      S.nativeEdits.length || S.ocr.length ? await S.pdf.getData() : null;
    if (contentBytes) stage = "复用已应用内容，整理书签与文档属性";
    timer = setInterval(() => {
      $("#busy-text").textContent =
        `${stage} · ${((performance.now() - started) / 1000).toFixed(1)} 秒`;
    }, 200);
    const serialStart = performance.now();
    const bytes = await rpc("save", {
      contentBytes,
      nodes: S.nodes,
      rotations: S.rotation,
      annotations: S.annotations,
      metadata: S.metadata,
      showBookmarks: settings.showBookmarks,
    });
    timings.serializeMs = performance.now() - serialStart;
    stage = "正在完成写入";
    const writeStart = performance.now();
    let result;
    if (window.desktop)
      result = await window.desktop.save({
        name,
        ticket,
        bytes,
        kind: "pdf",
        handle: S.handle,
        working: S.working,
        protect,
        forceAs,
      });
    else {
      await writeFile(name, bytes, "pdf");
      result = { name, working: true };
    }
    if (result) {
      documentSession.assert(saveSession);
      S.name = result.name;
      S.handle = result.handle || null;
      S.working = true;
      S.baseline = state;
      setDirty(stateKey() !== state);
      timings.writeMs = performance.now() - writeStart;
      timings.totalMs = performance.now() - started;
      S.lastSaveMetrics = {
        ...timings,
        contentReused: !!contentBytes,
        bytes: bytes.length,
      };
      console.info("Folio save", S.lastSaveMetrics);
      $("#doc-name").textContent = S.name;
      $("#doc-name").title = S.name;
      toast("已保存：" + S.name);
      status("已保存 · " + S.name);
      await recoveryStore(null, S.sessionId).catch((e) =>
        toast("文件已保存；草稿清理失败：" + e.message),
      );
      return { status: "saved" };
    }
    return { status: "cancelled" };
  } catch (e) {
    error(e);
    return { status: "failed", error: e.message };
  } finally {
    clearInterval(timer);
    setBusy(false);
  }
}
let filterCache = null,
  filterJob = null,
  filterEpoch = 0;
const filterActive = () => !!(S.filter || S.filterPage);
const filterKey = () =>
  JSON.stringify([
    S.filter,
    !!S.filterRegex,
    !!S.filterCase,
    S.filterPage || "",
  ]);
const filterReady = () =>
  filterActive() &&
  filterCache?.nodes === S.nodes &&
  filterCache?.key === filterKey() &&
  !filterCache.error &&
  !filterJob;
function requestFilter() {
  const key = filterKey(),
    nodes = S.nodes;
  if (filterCache?.key === key && filterCache.nodes === nodes) return;
  if (filterJob?.key === key && filterJob.nodes === nodes) return;
  filterJob?.worker.terminate();
  if (filterJob) clearTimeout(filterJob.timer);
  const epoch = ++filterEpoch,
    w = new Worker(new URL("./filter-worker.mjs", import.meta.url), {
      type: "module",
    });
  const finish = (data) => {
    w.terminate();
    clearTimeout(job.timer);
    if (epoch !== filterEpoch || key !== filterKey() || nodes !== S.nodes)
      return;
    filterJob = null;
    filterCache = { ...data, key, nodes };
    $("#filter-status").textContent =
      data.error || `${data.matches.length} 项匹配 · 祖先仅作路径显示`;
    $("#filter-status").classList.toggle("error", !!data.error);
    $("#filter").setAttribute("aria-invalid", !!data.error);
    rebuild();
  };
  const job = (filterJob = {
    key,
    nodes,
    worker: w,
    timer: setTimeout(
      () => finish({ error: "筛选超过 2 秒，请简化正则表达式" }),
      2000,
    ),
  });
  $("#filter-status").textContent = "正在筛选…";
  $("#filter-select").disabled = true;
  $("#filter-batch").disabled = true;
  w.onmessage = (e) => finish(e.data);
  w.onerror = (e) => finish({ error: e.message });
  w.postMessage({
    nodes: nodes.map((n) => ({
      id: n.id,
      parent: n.parent,
      title: n.title,
      target: { page: n.target.page },
    })),
    query: S.filter,
    options: {
      regex: !!S.filterRegex,
      caseSensitive: !!S.filterCase,
      page: S.filterPage || "",
    },
  });
}
function rebuild() {
  S.index = new Map(S.nodes.map((n) => [n.id, n]));
  S.depth = depths(S.nodes);
  S.children = childrenMap(S.nodes);
  S.selected = new Set([...S.selected].filter((id) => S.index.has(id)));
  const visible = [],
    hidden = new Set(),
    q = filterActive();
  let allowed;
  if (q) {
    requestFilter();
    allowed = new Set(
      filterReady()
        ? filterCache.visible
        : (S.visible || []).filter((n) => S.index.has(n.id)).map((n) => n.id),
    );
  } else {
    filterJob?.worker.terminate();
    if (filterJob) clearTimeout(filterJob.timer);
    filterEpoch++;
    filterJob = null;
    filterCache = null;
    $("#filter-status").textContent = "";
    $("#filter").setAttribute("aria-invalid", "false");
  }
  $("#filter-select").disabled = !filterReady();
  $("#filter-batch").disabled = !filterReady();
  for (const n of S.nodes) {
    if (!q && (hidden.has(n.parent) || S.collapsed.has(n.parent))) {
      hidden.add(n.id);
      continue;
    }
    if (q && !allowed.has(n.id)) continue;
    visible.push(n);
  }
  S.visible = visible;
  $("#tree-spacer").style.height = visible.length * rowHeight() + "px";
  $("#tree-empty").hidden = !!visible.length;
  $("#node-count").textContent = S.nodes.length.toLocaleString();
  $("#selection-count").textContent = S.selected.size
    ? `已选 ${S.selected.size.toLocaleString()} 项`
    : "未选择书签";
  renderTree();
  fillProperties();
  if (S.info)
    status(
      `${S.info.pageCount} 页 · ${S.nodes.length.toLocaleString()} 个书签`,
    );
}
let treeFrame = 0;
function rowHeight() {
  return settings.wrap ? Math.max(58, settings.row) : settings.row;
}
function renderTree() {
  if (document.activeElement?.classList.contains("inline-name")) return;
  const tree = $("#tree"),
    start = Math.max(0, Math.floor(tree.scrollTop / rowHeight()) - 5),
    end = Math.min(
      S.visible.length,
      start + Math.ceil(tree.clientHeight / rowHeight()) + 12,
    );
  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    const n = S.visible[i],
      d = S.depth.get(n.id) || 0,
      row = document.createElement("div");
    row.className =
      "tree-row" +
      (S.selected.has(n.id) ? " selected" : "") +
      (filterReady() && filterCache.matches.includes(n.id)
        ? " filter-match"
        : "");
    row.dataset.id = n.id;
    row.style.top = i * rowHeight() + "px";
    row.style.height = rowHeight() + "px";
    row.style.paddingLeft = Math.min(d, 24) * 16 + 4 + "px";
    row.draggable = true;
    row.role = "treeitem";
    row.setAttribute("aria-level", d + 1);
    row.setAttribute("aria-selected", S.selected.has(n.id));
    if (S.children.has(n.id))
      row.setAttribute("aria-expanded", !S.collapsed.has(n.id));
    row.title = n.title;
    row.innerHTML = `<button class="toggle" tabindex="-1">${S.children.has(n.id) ? (S.collapsed.has(n.id) ? "›" : "⌄") : ""}</button><span class="bm">${icon("bookmark")}</span><span class="title"></span><span class="page">${n.target.page || "↗"}</span>`;
    const title = row.querySelector(".title");
    title.textContent = n.title;
    title.style.color = n.color;
    title.style.fontWeight = n.bold ? "700" : "400";
    title.style.fontStyle = n.italic ? "italic" : "normal";
    fragment.append(row);
  }
  $("#tree-rows").replaceChildren(fragment);
}
function selectNode(id, event = {}) {
  if (event.shiftKey && S.anchor) {
    const a = S.visible.findIndex((n) => n.id === S.anchor),
      b = S.visible.findIndex((n) => n.id === id);
    if (a >= 0 && b >= 0) {
      if (!event.ctrlKey) S.selected.clear();
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++)
        S.selected.add(S.visible[i].id);
    }
  } else if (event.ctrlKey || event.metaKey) {
    S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
    S.anchor = id;
  } else {
    S.selected = new Set([id]);
    S.anchor = id;
  }
  renderTree();
  fillProperties();
  $("#selection-count").textContent = `已选 ${S.selected.size} 项`;
}
function selectedNode() {
  return S.index.get([...S.selected][0]);
}
const coordNames = {
  XYZ: ["Left / X", "Top / Y", "Zoom（1 = 100%）"],
  FitH: ["Top / Y"],
  FitV: ["Left / X"],
  FitR: ["Left", "Bottom", "Right", "Top"],
  FitBH: ["Top / Y"],
  FitBV: ["Left / X"],
  Fit: [],
  FitB: [],
};
function coordinates(mode, args = []) {
  $("#coord-fields").innerHTML =
    `<div class="coord-grid">${(coordNames[mode] || []).map((s, i) => `<label>${s}<input class="coord" type="number" step="any" placeholder="null" value="${args[i] === null || args[i] === undefined ? "" : Number(args[i].toFixed(5))}"></label>`).join("")}</div>`;
}
let styleDirty = new Set();
for (const key of ["bold", "italic", "color"])
  $("#prop-" + key).addEventListener("input", () => styleDirty.add(key));
function fillProperties() {
  styleDirty.clear();
  const n = selectedNode();
  $("#properties").hidden = !n;
  $("#inspector-empty").hidden = !!n;
  if (!n) return;
  $("#prop-title").value = n.title;
  $("#prop-bold").checked = n.bold;
  $("#prop-italic").checked = n.italic;
  $("#prop-color").value = n.color;
  const multi = S.selected.size > 1,
    selected = S.nodes.filter((n) => S.selected.has(n.id));
  for (const key of ["bold", "italic"])
    $("#prop-" + key).indeterminate =
      multi && selected.some((v) => v[key] !== n[key]);
  $("#prop-color").title =
    multi && selected.some((v) => v.color !== n.color)
      ? "混合颜色；选择颜色统一设置"
      : n.color;
  $("#prop-title").disabled =
    $("#prop-open").disabled =
    $("#prop-mode").disabled =
      multi;
  $("#multi-style-info").textContent = multi
    ? `已选 ${selected.length} 项 · ${[
        ["bold", "粗体"],
        ["italic", "斜体"],
        ["color", "颜色"],
      ]
        .filter(([k]) => selected.some((v) => v[k] !== n[k]))
        .map(([, label]) => label + "混合")
        .join(" / ")} · 仅应用改动的样式`
    : "";
  $("#prop-open").checked = n.open;
  $("#prop-page").value = n.target.page || "";
  $("#prop-mode").value =
    n.target.kind === "preserve" ? "preserve" : n.target.mode;
  $("#target-badge").textContent =
    n.target.kind === "preserve" ? "原始对象" : "自定义目标";
  $("#target-note").textContent =
    S.selected.size > 1
      ? "统一修改所选书签的样式；标题和目标请使用批量规则。"
      : n.target.label || "修改目标后会替换原目标及动作链。";
  coordinates($("#prop-mode").value, n.target.args);
  $("#prop-page").disabled = multi || n.target.kind === "preserve";
  $$(".coord").forEach((el) => (el.disabled = multi));
}
function applyProperty(event) {
  event?.preventDefault();
  const n = selectedNode();
  if (!n) return;
  if (S.selected.size > 1) {
    const patch = {};
    for (const key of styleDirty)
      patch[key] =
        key === "color" ? $("#prop-color").value : $("#prop-" + key).checked;
    if (!Object.keys(patch).length) return;
    const ids = $("#prop-descendants").checked
      ? descendants(S.nodes, S.selected)
      : S.selected;
    commit(patchStyles(S.nodes, ids, patch));
    toast(`已更新 ${ids.size} 项样式，可整批撤销`);
    return;
  }
  const nodes = clone(S.nodes),
    edited = nodes.find((v) => v.id === n.id);
  Object.assign(edited, {
    title: $("#prop-title").value,
    bold: $("#prop-bold").checked,
    italic: $("#prop-italic").checked,
    color: $("#prop-color").value,
    open: $("#prop-open").checked,
  });
  const mode = $("#prop-mode").value;
  if (mode !== "preserve")
    edited.target = {
      kind: "dest",
      page: Number($("#prop-page").value),
      mode,
      args: $$(".coord").map((e) => (e.value === "" ? null : Number(e.value))),
    };
  commit(nodes);
  toast("书签属性已更新");
}
function addNode(child = false) {
  if (!S.pdf) return;
  const ref = selectedNode(),
    n = makeNode(
      "新书签",
      S.page,
      child && ref ? ref.id : (ref?.parent ?? null),
    );
  let out = clone(S.nodes),
    at = ref ? out.findIndex((x) => x.id === ref.id) + 1 : out.length;
  if (ref) {
    const sub = descendants(out, new Set([ref.id]));
    while (at < out.length && sub.has(out[at].id)) at++;
  }
  out.splice(at, 0, n);
  S.selected = new Set([n.id]);
  if (n.parent) S.collapsed.delete(n.parent);
  commit(out);
  reveal(n.id);
  $("#prop-title").focus();
  $("#prop-title").select();
}
function reveal(id) {
  let n = S.index.get(id);
  while (n?.parent) {
    S.collapsed.delete(n.parent);
    n = S.index.get(n.parent);
  }
  rebuild();
  const at = S.visible.findIndex((n) => n.id === id);
  if (at >= 0) $("#tree").scrollTop = at * rowHeight();
}
async function deleteNodes() {
  if (!S.selected.size) return;
  const ids = descendants(S.nodes, S.selected);
  if (
    ids.size > 1 &&
    !(await confirmDialog(
      "删除书签",
      `将删除 ${ids.size} 个书签（含子项），可通过撤销恢复。`,
      "删除",
    ))
  )
    return;
  commit(S.nodes.filter((n) => !ids.has(n.id)));
}
function changeLevel(indent) {
  const chosen = descendants(S.nodes, S.selected),
    roots = S.nodes.filter(
      (n) => S.selected.has(n.id) && !chosen.has(n.parent),
    );
  let out = clone(S.nodes);
  for (const original of indent ? roots : [...roots].reverse()) {
    const n = out.find((v) => v.id === original.id),
      siblings = childrenMap(out).get(n.parent),
      i = siblings.findIndex((v) => v.id === n.id);
    if (indent) {
      let j = i - 1;
      while (j >= 0 && chosen.has(siblings[j].id)) j--;
      if (j >= 0) {
        out = move(out, new Set([n.id]), siblings[j].id, "inside");
        S.collapsed.delete(siblings[j].id);
      }
    } else if (n.parent) out = move(out, new Set([n.id]), n.parent, "after");
  }
  if (JSON.stringify(out) !== JSON.stringify(S.nodes)) commit(out);
}
function duplicate() {
  if (!S.selected.size) return;
  const subset = descendants(S.nodes, S.selected),
    mapping = new Map(),
    copied = S.nodes
      .filter((n) => subset.has(n.id))
      .map((n) => {
        const c = clone(n);
        mapping.set(n.id, uid());
        return c;
      });
  for (const n of copied) {
    n.id = mapping.get(n.id);
    n.parent = mapping.get(n.parent) || null;
  }
  commit([...S.nodes, ...copied]);
  toast(`已复制 ${copied.length} 个书签到根层级末尾`);
}
async function renderPage(target = null) {
  if (target) return surface.go(S.page, target, false);
  return surface.refresh();
}
async function goPage(page) {
  return surface.go(page);
}
function visiblePdfPoint() {
  return surface.point();
}
async function jump(n) {
  if (!n?.target.page) {
    toast("此书签包含外部或特殊动作，本软件仅保留、不执行该动作");
    return;
  }
  const t = clone(n.target),
    previous = visiblePdfPoint();
  surface.remember();
  S.page = t.page;
  const inheritedZoom = S.zoom;
  if (["Fit", "FitB"].includes(t.mode)) S.zoom = "fit";
  else if (["FitH", "FitBH"].includes(t.mode)) {
    S.zoom = "width";
    t.args[0] ??= previous[1];
  } else if (t.mode === "XYZ") {
    S.zoom = String(t.args[2] || S.scale);
    t.args[0] ??= previous[0];
    t.args[1] ??= previous[1];
  } else {
    const page = await S.pdf.getPage(t.page),
      view = page.getViewport({
        scale: 1,
        rotation: S.rotation[t.page] ?? page.rotate,
      });
    if (t.mode === "FitR") {
      const r = view.convertToViewportRectangle(t.args),
        w = Math.abs(r[2] - r[0]),
        h = Math.abs(r[3] - r[1]);
      if (w && h)
        S.zoom = String(
          Math.min(
            ($("#canvas-host").clientWidth - 56) / w,
            ($("#canvas-host").clientHeight - 56) / h,
          ),
        );
    } else if (["FitV", "FitBV"].includes(t.mode)) {
      S.zoom = String(($("#canvas-host").clientHeight - 56) / view.height);
      t.args[0] ??= previous[0];
    }
  }
  if (settings.ignoreZoom) S.zoom = inheritedZoom;
  syncZoom();
  await renderPage(t);
}
function syncZoom() {
  const select = $("#zoom");
  if (![...select.options].some((o) => o.value === String(S.zoom))) {
    const o = document.createElement("option");
    o.value = String(S.zoom);
    o.textContent = Math.round(Number(S.zoom) * 100) + "%";
    select.append(o);
  }
  select.value = S.zoom;
}
function capture() {
  if (!S.view || !selectedNode()) return;
  const point = visiblePdfPoint();
  $("#prop-mode").value = "XYZ";
  $("#prop-page").disabled = false;
  $("#prop-page").value = S.page;
  coordinates("XYZ", [
    Number(point[0].toFixed(2)),
    Number(point[1].toFixed(2)),
    Number(S.scale.toFixed(4)),
  ]);
  toast("已填入当前视图，点击「应用更改」保存到书签");
}
function batchCompute(nodes, ids, rule) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./batch-worker.mjs", import.meta.url), {
        type: "module",
      }),
      t = setTimeout(() => {
        w.terminate();
        reject(Error("规则处理超过 3 秒，已取消；请缩小范围或简化正则"));
      }, 3000);
    w.onmessage = (e) => {
      clearTimeout(t);
      w.terminate();
      e.data.error ? reject(Error(e.data.error)) : resolve(e.data.nodes);
    };
    w.onerror = (e) => {
      clearTimeout(t);
      w.terminate();
      reject(Error(e.message));
    };
    w.postMessage({ nodes, ids: [...ids], rule, pageCount: S.info.pageCount });
  });
}
function batchDialog() {
  const memory = new RuleMemory(localStorage, S.fingerprint || S.name);
  const sourceNodes = S.nodes,
    sourceBytes = S.bytes;
  let activeOperation = memory.lastOperation(),
    previewContext = null,
    composing = false;
  const context = () =>
    JSON.stringify([
      S.selected ? [...S.selected] : [],
      S.filter,
      S.filterRegex,
      S.filterCase,
      S.filterPage,
    ]);
  const remember = () => {
    if ($("#batch-fields"))
      memory.remember(activeOperation, captureFields($("#batch-fields")));
  };

  let preview = null,
    report = null,
    revision = 0,
    timer;
  modal(
    "批量规则",
    `<p>先查看差异，再一次应用。越界页码会阻止整个操作，所有更改支持撤销。</p><div class="form-grid"><label>处理范围<select id="batch-scope"><option value="selected">所选书签</option><option value="descendants">所选书签及子项</option><option value="all">全部书签</option><option value="filtered">当前筛选匹配项</option></select></label><label>操作<select id="batch-op"><option value="replace">正则查找替换</option><option value="prefix">添加前缀 / 后缀</option><option value="number">模板编号</option><option value="trim">清理空格</option><option value="offset">统一页码偏移</option><option value="coordinates">统一跳转模式 / 坐标</option><option value="parameters">逐参数：保持 / 绝对 / 相对 / null</option><option value="style">统一颜色和字形</option><option value="open">默认展开 / 折叠</option></select></label></div><div class="rule-memory-toolbar"><select id="batch-history" aria-label="最近规则与收藏"></select><input id="batch-name" placeholder="收藏名称（可选）" maxlength="80"><button id="batch-favorite">收藏当前规则</button><button id="batch-clear-history">清空历史</button></div><div id="batch-fields"></div><div id="batch-summary" class="callout">修改参数后自动刷新预览</div><div id="batch-preview" class="preview-list"></div>`,
    [
      { text: "取消", run: closeModal },
      {
        text: "导出完整修改报告",
        run: () => {
          if (!preview || !report) throw Error("请先生成有效预览");
          return writeFile(
            "Folio-batch-report.json",
            new TextEncoder().encode(JSON.stringify(report, null, 2)),
            "json",
          );
        },
      },
      {
        text: "应用更改",
        primary: true,
        id: "batch-apply",
        run: () => {
          if (
            !preview ||
            S.nodes !== sourceNodes ||
            S.bytes !== sourceBytes ||
            previewContext !== context()
          )
            throw Error("文档或处理范围已变化，请重新预览");
          memory.record(activeOperation, captureFields($("#batch-fields")));
          commit(preview);
          closeModal();
          toast("批量规则已应用，可撤销");
        },
      },
    ],
  );
  $("#batch-scope").value =
    filterActive() && filterReady()
      ? "filtered"
      : S.selected.size
        ? "selected"
        : "all";
  if (![...$("#batch-op").options].some((o) => o.value === activeOperation))
    activeOperation = "replace";
  $("#batch-op").value = activeOperation;
  const drawHistory = () => {
    $("#batch-history").innerHTML =
      '<option value="">最近规则与收藏…</option>' +
      memory.data.history
        .map(
          (h, i) =>
            `<option value="${i}">${esc(h.name || h.values["b-find"] || h.operation)}</option>`,
        )
        .join("");
  };
  drawHistory();
  const fields = () => {
    const op = $("#batch-op").value;
    $("#batch-fields").innerHTML = {
      replace: `<div class="form-grid"><label>正则表达式<input id="b-find" value="^" placeholder="例如：^第(\\d+)章"></label><label>替换为<input id="b-replacement" placeholder="$1 表示捕获组"></label></div><label class="check"><input id="b-case" type="checkbox">区分大小写</label>`,
      prefix: `<div class="form-grid"><label>前缀<input id="b-prefix"></label><label>后缀<input id="b-suffix"></label></div>`,
      number: `<div class="form-grid"><label>编号模板<input id="b-template" value="{n}. {title}"></label><label>起始编号<input id="b-start" type="number" value="1"></label></div><p class="hint">可用变量：{n}、{title}、{page}、{level}</p>`,
      trim: "<p>移除首尾空白，将连续空白压缩成一个空格。</p>",
      offset:
        '<label>偏移量（可为负数）<input id="b-amount" type="number" value="0"></label><p class="hint">仅修改已转换为自定义目标的书签。原始动作不会被隐式替换。</p>',
      coordinates: `<label>模式<select id="b-mode">${Object.keys(MODES)
        .map((m) => `<option>${m}</option>`)
        .join(
          "",
        )}</select></label><label>参数（JSON 数组）<input id="b-args" value="[null, null, null]"></label><p class="hint">只作用于自定义目标；XYZ 顺序为 [x, y, zoom]，FitR 为 [left, bottom, right, top]。</p>`,
      parameters: `<p class="hint">页码与参数按各书签原模式分别处理。参数编号从 1 开始；XYZ = X、Y、缩放；FitH = Y；FitR = 左、底、右、顶。相对修改 null 会阻止应用。</p><label class="check"><input id="b-convert" type="checkbox">允许将原始本地动作 / 命名目标转换为直接目标</label>${["page", 0, 1, 2, 3].map((k) => `<div class="form-grid three"><label>${k === "page" ? "物理页码" : "参数 " + (k + 1)}</label><select data-parameter="${k}"><option value="keep">保持不变</option><option value="absolute">绝对值</option><option value="relative">相对偏移</option>${k === "page" ? "" : '<option value="null">设为 null</option>'}</select><input data-param-value="${k}" type="number" step="any" value="0"></div>`).join("")}`,
      style:
        '<div class="property-row"><label><input id="b-bold" type="checkbox">粗体</label><label><input id="b-italic" type="checkbox">斜体</label><input id="b-color" type="color" value="#5267db"></div>',
      open: '<label class="check"><input id="b-open" type="checkbox" checked>在 PDF 阅读器中展开</label>',
    }[op];
    restoreFields($("#batch-fields"), memory.get(op));
    $("#b-mode")?.addEventListener("change", () => {
      $("#b-args").value = JSON.stringify(
        $("#b-mode").value === "FitR"
          ? [0, 0, 300, 500]
          : Array(MODES[$("#b-mode").value]).fill(null),
      );
    });
  };
  const update = async () => {
    if (composing) return;
    const rev = ++revision;
    const scopeContext = context();
    preview = null;
    $("#batch-apply").disabled = true;
    const op = $("#batch-op").value,
      scope = $("#batch-scope").value,
      ids =
        scope === "filtered"
          ? new Set(filterReady() ? filterCache.matches : [])
          : scope === "all"
            ? new Set(S.nodes.map((n) => n.id))
            : scope === "descendants"
              ? descendants(S.nodes, S.selected)
              : S.selected;
    const val = (id) => $("#" + id)?.value,
      checked = (id) => !!$("#" + id)?.checked;
    try {
      if (S.nodes !== sourceNodes || S.bytes !== sourceBytes)
        throw Error("文档已变化，请关闭后重新打开规则");
      if (scope === "filtered" && !filterReady())
        throw Error("请先完成有效筛选");
      const rule = {
        op,
        convert: checked("b-convert"),
        edits: Object.fromEntries(
          $$("[data-parameter]").map((e) => [
            e.dataset.parameter,
            {
              op: e.value,
              value: document.querySelector(
                '[data-param-value="' + e.dataset.parameter + '"]',
              ).value,
            },
          ]),
        ),
        find: val("b-find"),
        replacement: val("b-replacement"),
        caseSensitive: checked("b-case"),
        prefix: val("b-prefix"),
        suffix: val("b-suffix"),
        template: val("b-template"),
        start: val("b-start"),
        amount: val("b-amount"),
        mode: val("b-mode"),
        args: op === "coordinates" ? JSON.parse(val("b-args")) : null,
        bold: checked("b-bold"),
        italic: checked("b-italic"),
        color: val("b-color"),
        open: checked("b-open"),
      };
      const out = await batchCompute(S.nodes, ids, rule);
      if (
        rev !== revision ||
        !$("#batch-preview") ||
        S.nodes !== sourceNodes ||
        S.bytes !== sourceBytes ||
        context() !== scopeContext
      )
        return;
      const changed = out.filter(
        (n, i) => JSON.stringify(n) !== JSON.stringify(S.nodes[i]),
      );
      report = { rule, changes: describeChanges(S.nodes, out, rule) };
      preview = out;
      previewContext = scopeContext;
      $("#batch-apply").disabled = !changed.length;
      $("#batch-summary").textContent =
        `范围 ${ids.size} 项 · 将修改 ${changed.length} 项 · 预览前 80 项`;
      $("#batch-summary").classList.remove("error");
      $("#batch-preview").innerHTML =
        `<details><summary>完整规则参数</summary><pre>${esc(JSON.stringify(rule, null, 2))}</pre></details>` +
        nativeUI.diffTable(report.changes.slice(0, 80));
    } catch (e) {
      if (rev === revision && $("#batch-summary")) {
        $("#batch-summary").textContent = e.message;
        $("#batch-summary").classList.add("error");
      }
    }
  };
  const schedule = () => {
    remember();
    preview = null;
    $("#batch-apply").disabled = true;
    revision++;
    clearTimeout(timer);
    if (!composing) timer = setTimeout(update, 220);
  };
  $("#batch-op").onchange = () => {
    remember();
    activeOperation = $("#batch-op").value;
    fields();
    schedule();
  };
  $("#batch-fields").addEventListener("input", schedule);
  $("#batch-fields").addEventListener("change", schedule);
  $("#batch-fields").addEventListener("compositionstart", () => {
    composing = true;
    clearTimeout(timer);
  });
  $("#batch-fields").addEventListener("compositionend", () => {
    composing = false;
    schedule();
  });
  $("#batch-scope").onchange = schedule;
  $("#batch-history").onchange = () => {
    const item = memory.data.history[+$("#batch-history").value];
    if (!item || $("#batch-history").value === "") return;
    remember();
    activeOperation = item.operation;
    $("#batch-op").value = activeOperation;
    fields();
    restoreFields($("#batch-fields"), item.values);
    schedule();
  };
  $("#batch-favorite").onclick = () => {
    memory.record(
      activeOperation,
      captureFields($("#batch-fields")),
      $("#batch-name").value.trim(),
    );
    drawHistory();
  };
  $("#batch-clear-history").onclick = () => {
    memory.clearHistory();
    drawHistory();
  };

  modalCleanup = () => {
    remember();
    revision++;
    clearTimeout(timer);
  };
  fields();
  update();
}
async function collectLines(from, to, onProgress, cancelled) {
  const out = [];
  for (let page = from; page <= to; page++) {
    if (cancelled?.()) throw Error("已取消生成");
    onProgress?.(page);
    const lines = await extractLines(S.pdf, page, surface.rotation(page), {
      ocr: S.ocr,
    });
    out.push(
      ...lines.map((l) => ({
        ...l,
        size: Math.max(1, ...(l.segments || []).map((s) => s.bottom - s.top)),
      })),
    );
    if (out.length > 500000) throw Error("文本行过多，请缩小扫描范围");
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}
function generateDialog() {
  let generated = null,
    cancelled = false,
    genWorker = null;
  modal(
    "自动生成书签",
    `<p>从正文标题、目录文本或固定页间隔建立目录。扫描件可先使用工具栏 OCR，再生成书签。</p><label>生成方式<select id="gen-mode"><option value="font">按标题字号识别</option><option value="regex">按正文正则匹配</option><option value="toc">粘贴目录文本</option><option value="interval">每隔 N 页生成</option></select></label><label>处理页面<input id="gen-range" value="1-${Math.min(S.info.pageCount, 50)}"></label><div class="form-grid three"><label hidden>起始页<input id="gen-from" type="number" min="1" value="1"></label><label hidden>结束页<input id="gen-to" type="number" min="1" value="${Math.min(S.info.pageCount, 50)}"></label><label>最大层级<input id="gen-levels" type="number" min="1" max="8" value="4"></label></div><div id="gen-fields"></div><label>合并方式<select id="gen-merge"><option value="append">追加到现有书签末尾</option><option value="replace">替换全部现有书签（可撤销）</option></select></label><div id="gen-summary" class="callout">设置参数后点击「生成预览」。默认扫描前 50 页，可修改范围。</div><div id="gen-preview" class="preview-list"></div>`,
    [
      { text: "取消", run: closeModal },
      {
        text: "生成预览",
        id: "gen-run",
        run: async () => {
          generated = null;
          $("#gen-apply").disabled = true;
          $("#gen-run").disabled = true;
          $$(
            "#modal-body input,#modal-body select,#modal-body textarea",
          ).forEach((e) => (e.disabled = true));
          try {
            const mode = $("#gen-mode").value,
              selectedPages = pageRange(
                $("#gen-range").value,
                S.info.pageCount,
              ),
              from = selectedPages[0],
              to = selectedPages.at(-1),
              levels = Number($("#gen-levels").value);
            if (
              !Number.isInteger(from) ||
              !Number.isInteger(to) ||
              from < 1 ||
              to > S.info.pageCount ||
              from > to
            )
              throw Error("扫描页码范围无效");
            if (!Number.isInteger(levels) || levels < 1 || levels > 8)
              throw Error("最大层级应为 1–8");
            let nodes,
              bad = 0;
            if (mode === "toc") {
              const r = parseTOC(
                $("#gen-toc").value,
                S.info.pageCount,
                Number($("#gen-offset").value),
              );
              nodes = r.nodes;
              bad = r.bad;
            } else if (mode === "interval") {
              const interval = Number($("#gen-interval").value);
              if (!Number.isInteger(interval) || interval < 1)
                throw Error("页间隔必须为正整数");
              nodes = [];
              for (const p of selectedPages.filter(
                (_, i) => i % interval === 0,
              ))
                nodes.push(
                  makeNode(
                    $("#gen-template")
                      .value.replaceAll("{page}", String(p))
                      .replaceAll("{n}", String(nodes.length + 1)),
                    p,
                  ),
                );
            } else {
              const minSize = Number($("#gen-size")?.value || 0),
                pattern = $("#gen-pattern")?.value || "";
              const lines = (
                await collectLines(
                  from,
                  to,
                  (p) => {
                    if ($("#gen-summary"))
                      $("#gen-summary").textContent =
                        `正在扫描第 ${p} / ${to} 页…`;
                  },
                  () => cancelled,
                )
              ).filter((l) => selectedPages.includes(l.page));
              if (cancelled) return;
              nodes = await new Promise((resolve, reject) => {
                genWorker = new Worker(
                  new URL("./generate-worker.mjs", import.meta.url),
                  { type: "module" },
                );
                const timeout = setTimeout(() => {
                  genWorker.terminate();
                  reject(Error("匹配超时，请简化正则或减少扫描页数"));
                }, 5000);
                genWorker.onmessage = (e) => {
                  clearTimeout(timeout);
                  genWorker.terminate();
                  e.data.error
                    ? reject(Error(e.data.error))
                    : resolve(e.data.nodes);
                };
                genWorker.onerror = (e) => {
                  clearTimeout(timeout);
                  reject(Error(e.message));
                };
                genWorker.postMessage({
                  lines,
                  mode,
                  minSize,
                  pattern,
                  maxLevels: levels,
                  pageCount: S.info.pageCount,
                });
              });
            }
            if (cancelled) return;
            generated = nodes;
            const d = depths(nodes);
            $("#gen-summary").textContent =
              `生成 ${nodes.length} 项${bad ? ` · ${bad} 行不符合目录格式，已跳过` : ""} · 显示前 150 项`;
            $("#gen-preview").innerHTML = nodes
              .slice(0, 150)
              .map(
                (n) =>
                  `<div class="preview-item" style="padding-left:${12 + (d.get(n.id) || 0) * 18}px"><span>${esc(n.title)}</span><small>第 ${n.target.page} 页</small></div>`,
              )
              .join("");
            $("#gen-apply").disabled = !nodes.length;
          } catch (e) {
            if (!cancelled) {
              $("#gen-summary").textContent = e.message;
            }
          } finally {
            if (!cancelled) {
              $("#gen-run").disabled = false;
              $$(
                "#modal-body input,#modal-body select,#modal-body textarea",
              ).forEach((e) => (e.disabled = false));
            }
          }
        },
      },
      {
        text: "应用书签",
        primary: true,
        id: "gen-apply",
        run: () => {
          if (!generated?.length) throw Error("请先生成有效预览");
          commit(
            $("#gen-merge").value === "replace"
              ? generated
              : [...S.nodes, ...generated],
          );
          closeModal();
          toast("自动生成的书签已应用");
        },
      },
    ],
  );
  const disposeGenPicker = installPagePicker($("#gen-range"), {
    S,
    surface,
    onChange: () => {
      try {
        const p = pageRange($("#gen-range").value, S.info.pageCount);
        $("#gen-from").value = p[0];
        $("#gen-to").value = p.at(-1);
      } catch {}
    },
  });
  $("#gen-apply").disabled = true;
  const fields = () => {
    $("#gen-fields").innerHTML = {
      font: '<label>最小标题字号（pt）<input id="gen-size" type="number" min="1" step="0.5" value="15"></label><p class="hint">字号从大到小对应由浅到深的层级。建议先扫描少量页面调整阈值。</p>',
      regex:
        '<label>标题正则表达式<input id="gen-pattern" value="^(第[一二三四五六七八九十百0-9]+[章节篇部]|[0-9]+(\\.[0-9]+)*[ 、.])"></label><p class="hint">数字标题 1、1.1、1.1.1 会对应不同层级。</p>',
      toc: '<label>目录文本<textarea id="gen-toc" rows="8" placeholder="第一章 绪论\t1&#10;  1.1 研究背景\t3&#10;第二章 主要内容 …… 8"></textarea></label><div class="form-grid"><label>页码偏移（印刷页码 + 偏移 = 物理页码）<input id="gen-offset" type="number" value="0"></label><button id="gen-extract" type="button">提取扫描范围正文到文本框</button></div><p class="hint">标题与页码用 Tab、至少两个空格或点线分隔；每两个前导空格表示一级缩进。</p>',
      interval:
        '<div class="form-grid"><label>页间隔<input id="gen-interval" type="number" min="1" value="10"></label><label>标题模板<input id="gen-template" value="第 {page} 页"></label></div>',
    }[$("#gen-mode").value];
    $("#gen-extract")?.addEventListener("click", () =>
      guarded(async () => {
        const f = Number($("#gen-from").value),
          t = Number($("#gen-to").value);
        if (
          !Number.isInteger(f) ||
          !Number.isInteger(t) ||
          f < 1 ||
          t > S.info.pageCount ||
          t < f
        )
          throw Error("页码范围无效");
        const lines = await collectLines(f, t, null, () => cancelled);
        if (!cancelled)
          $("#gen-toc").value = lines.map((l) => l.text).join("\n");
      }),
    );
    generated = null;
    $("#gen-apply").disabled = true;
  };
  $("#gen-mode").onchange = fields;
  fields();
  const invalidate = () => {
    generated = null;
    $("#gen-apply").disabled = true;
  };
  $("#modal-body").addEventListener("input", invalidate);
  modalCleanup = () => {
    disposeGenPicker();
    cancelled = true;
    genWorker?.terminate();
    $("#modal-body").removeEventListener("input", invalidate);
  };
}
function exchangeDialog() {
  modal(
    "导入 / 导出与工作工程",
    `<p>JSON 包含层级、颜色、字形和跳转参数。TXT 适合在 Excel 或文本编辑器中整理。</p><div class="callout">跨文件导入时，原始动作字典不会复制。可解析的本地目标会转为显式目标；不可解析的动作会提示并定位第 1 页。PDF-XChange 专用书签交换格式暂未实现。</div><div class="menu-grid"><button id="export-json">导出 Folio JSON</button><button id="export-txt">导出目录 TXT</button><button id="import-json">导入 Folio JSON</button><button id="import-txt">导入目录 TXT</button><button id="export-project">保存工作工程 .folio</button></div><p class="hint">工作工程包含原 PDF、已应用修改、OCR 校对与流式段落结构，可通过“打开”继续编辑。PDF 用于交付，工程用于续编；工程保留原始内容与修改记录。</p>`,
    [{ text: "完成", run: closeModal }],
  );
  $("#export-project").onclick = () =>
    guarded(async () => {
      if (!S.pdf) return;
      await S.flowEdit?.flush();
      await writeFile(
        S.name.replace(/\.pdf$/i, "") + ".folio",
        await encodeProject(S.bytes, S.name, snapshot(), { blob: true }),
        "folio",
      );
    });
  $("#export-json").onclick = () =>
    guarded(async () => {
      await writeFile(
        "bookmarks.json",
        new TextEncoder().encode(
          JSON.stringify(
            {
              format: "folio-outline/1",
              source: S.name,
              nodes: S.nodes.map(({ raw, sourceRef, ...n }) => n),
            },
            null,
            2,
          ),
        ),
        "json",
      );
    });
  $("#export-txt").onclick = () =>
    guarded(async () => {
      const d = depths(S.nodes);
      await writeFile(
        "bookmarks.txt",
        new TextEncoder().encode(
          "\uFEFF" +
            S.nodes
              .map(
                (n) =>
                  "  ".repeat(d.get(n.id)) +
                  n.title.replace(/[\r\n\t]/g, " ") +
                  "\t" +
                  (n.target.page || ""),
              )
              .join("\r\n"),
        ),
        "txt",
      );
    });
  $("#import-json").onclick = () =>
    guarded(async () => {
      const f = await choose("json");
      if (!f) return;
      const { nodes, skipped } = importJSON(
        new TextDecoder().decode(f.bytes),
        S.info.pageCount,
      );
      if (
        skipped &&
        !(await confirmDialog(
          "部分动作不能导入",
          `${skipped} 个书签没有可解析的本地页码，导入后将定位第 1 页。`,
          "继续导入",
        ))
      )
        return;
      commit([...S.nodes, ...nodes]);
      closeModal();
      toast(`已追加 ${nodes.length} 个书签`);
    });
  $("#import-txt").onclick = () =>
    guarded(async () => {
      const f = await choose("txt");
      if (!f) return;
      const { nodes, bad } = parseTOC(
        new TextDecoder().decode(f.bytes).replace(/^\uFEFF/, ""),
        S.info.pageCount,
      );
      commit([...S.nodes, ...nodes]);
      closeModal();
      toast(`已追加 ${nodes.length} 项，跳过 ${bad} 行`);
    });
}
function treeMenu() {
  modal(
    "整理书签",
    `<div class="menu-grid"><button data-action="split-bookmark">正则拆分书签…</button><button id="sort-page">按页码排序（保留层级）</button><button id="sort-title">按标题自然排序</button><button id="dedupe">查找重复书签…</button><button id="calibrate">按标题校准目标…</button><button id="convert-dest">原始本地目标 → 可编辑目标</button><button id="select-all">全选书签</button><button id="validate-tree">校验跳转目标</button></div><p class="hint">转换目标会替换所选书签的原始动作链或命名目标，保留其解析出的页码和视图参数。外部动作保持原样；未选择时作用于全部。</p>`,
    [{ text: "完成", run: closeModal }],
  );
  $("#sort-page").onclick = () => {
    commit(sortTree(S.nodes, "page"));
    closeModal();
  };
  $("#sort-title").onclick = () => {
    commit(sortTree(S.nodes, "title"));
    closeModal();
  };
  $("#dedupe").onclick = () => bookmarkUI.dedupeDialog();
  $("#calibrate").onclick = () => bookmarkUI.calibrateDialog();
  $("#convert-dest").onclick = () =>
    guarded(async () => {
      if (
        !(await confirmDialog(
          "转换为可编辑目标",
          "此操作将用解析出的本地跳转替换原始动作链或命名目标。之后可批量修改页码、坐标和模式。",
          "转换",
        ))
      )
        return;
      const out = clone(S.nodes);
      let count = 0;
      for (const n of out)
        if (
          (!S.selected.size || S.selected.has(n.id)) &&
          n.target.kind === "preserve" &&
          n.target.page
        ) {
          n.target = {
            kind: "dest",
            page: n.target.page,
            mode: n.target.mode,
            args: n.target.args,
          };
          count++;
        }
      commit(out);
      closeModal();
      toast(`已转换 ${count} 个本地目标`);
    });
  $("#select-all").onclick = () => {
    S.selected = new Set(S.nodes.map((n) => n.id));
    rebuild();
    closeModal();
  };
  $("#validate-tree").onclick = () =>
    guarded(() => {
      validate(S.nodes, S.info.pageCount);
      const unknown = S.nodes.filter((n) => !n.target.page);
      toast(
        `结构与自定义目标有效；${unknown.length} 个特殊动作仅保留，未执行验证`,
      );
    });
}
function parseRange(text) {
  return pageRange(text, S.info.pageCount).map((p) => p - 1);
}
function pagesDialog() {
  modal(
    "页面操作",
    `<label>页码范围<input id="pages-range" value="${S.page}" placeholder="1-5,8,10-12"></label><p class="hint">页码使用物理页码。提取页以当前原始文档为基础，不包含尚未另存的修改，也不复制整本书签结构。合并先保存当前编辑，再追加另一个 PDF 的页面；追加文件的书签不自动合并。</p><div class="menu-grid"><button id="pages-rotate">所选页旋转 90°</button><button id="pages-extract">提取为新 PDF</button><button id="pages-merge">在末尾追加 PDF</button><button id="page-png">导出当前页 PNG</button></div>`,
    [{ text: "完成", run: closeModal }],
  );
  modalCleanup = installPagePicker($("#pages-range"), { S, surface });
  $("#pages-rotate").onclick = () =>
    guarded(() => {
      const indices = parseRange($("#pages-range").value),
        r = { ...S.rotation };
      for (const i of indices)
        r[i + 1] = ((r[i + 1] ?? S.info.pages[i].rotation) + 90) % 360;
      commit(S.nodes, { rotation: r });
      closeModal();
      renderPage();
    });
  $("#pages-extract").onclick = () =>
    guarded(async () => {
      const indices = parseRange($("#pages-range").value);
      setBusy(true, "正在提取页面…");
      try {
        const bytes = await rpc("extractPages", indices);
        await writeFile("extracted.pdf", bytes, "pdf");
      } finally {
        setBusy(false);
      }
    });
  $("#pages-merge").onclick = () =>
    guarded(async () => {
      const f = await choose("pdf");
      if (!f) return;
      closeModal();
      setBusy(true, "正在合并 PDF…");
      try {
        const current = await rpc("save", {
          nodes: S.nodes,
          rotations: S.rotation,
          annotations: S.annotations,
          metadata: S.metadata,
          showBookmarks: settings.showBookmarks,
        });
        const temp = new Worker(new URL("./pdf-worker.mjs", import.meta.url), {
          type: "module",
        });
        const call = (method, args) =>
          new Promise((resolve, reject) => {
            temp.onmessage = (e) =>
              e.data.error
                ? reject(Error(e.data.error))
                : resolve(e.data.result);
            temp.onerror = (e) => reject(Error(e.message));
            temp.postMessage({ id: 1, method, args });
          });
        try {
          await call("open", current);
          const merged = await call("merge", new Uint8Array(f.bytes));
          await loadPDF(merged, S.name.replace(/\.pdf$/i, "") + "-merged.pdf");
          setDirty();
          toast("页面已追加，请另存 PDF；合并操作不能撤销");
        } finally {
          temp.terminate();
        }
      } finally {
        setBusy(false);
      }
    });
  $("#page-png").onclick = () =>
    guarded(async () => {
      if (S.annotations.some((a) => a.page === S.page))
        toast("PNG 仅导出页面画布，未保存批注请先另存并重新打开");
      const page = await S.pdf.getPage(S.page),
        base = page.getViewport({
          scale: 1,
          rotation: surface.rotation(S.page),
        }),
        scale = Math.min(2, Math.sqrt(24000000 / (base.width * base.height))),
        viewport = page.getViewport({
          scale,
          rotation: surface.rotation(S.page),
        }),
        c = document.createElement("canvas");
      c.width = Math.ceil(viewport.width);
      c.height = Math.ceil(viewport.height);
      await page.render({
        canvasContext: c.getContext("2d"),
        viewport,
        background: "white",
      }).promise;
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      c.width = 0;
      c.height = 0;
      await writeFile(
        `page-${S.page}.png`,
        new Uint8Array(await blob.arrayBuffer()),
        "png",
      );
    });
}
function metadataDialog() {
  modal(
    "文档属性",
    `<div class="form-grid"><label>标题<input id="meta-title" value="${esc(S.metadata.title)}"></label><label>作者<input id="meta-author" value="${esc(S.metadata.author)}"></label></div><label>主题<input id="meta-subject" value="${esc(S.metadata.subject)}"></label><label>关键词（逗号分隔）<input id="meta-keywords" value="${esc(S.metadata.keywords)}"></label><p>${S.info.pageCount} 页 · ${(S.bytes.length / 1048576).toFixed(2)} MB · ${S.nodes.length.toLocaleString()} 个书签</p><div class="callout">保存采用完整重写。现有数字签名不保证有效；加密 PDF 暂不支持编辑。此版本支持基础文字/路径对象编辑与 OCR；不提供段落自动重排、表单编辑或安全涂黑。</div>`,
    [
      { text: "取消", run: closeModal },
      {
        text: "应用属性",
        primary: true,
        run: () => {
          commit(S.nodes, {
            metadata: {
              title: $("#meta-title").value,
              author: $("#meta-author").value,
              subject: $("#meta-subject").value,
              keywords: $("#meta-keywords").value,
            },
          });
          closeModal();
        },
      },
    ],
  );
}
function renderMarks() {
  const layer = $("#mark-layer");
  if (!layer) return;
  layer.replaceChildren();
  if (!S.view) return;
  for (const a of S.annotations.filter((a) => a.page === S.page)) {
    const rect = S.view.convertToViewportRectangle(a.rect),
      el = document.createElement("div");
    el.className = "annotation-mark " + a.type;
    Object.assign(el.style, {
      left: Math.min(rect[0], rect[2]) + "px",
      top: Math.min(rect[1], rect[3]) + "px",
      width: Math.abs(rect[2] - rect[0]) + "px",
      height: Math.abs(rect[3] - rect[1]) + "px",
    });
    el.title = a.text || "双击删除此批注";
    el.ondblclick = () => {
      commit(S.nodes, {
        annotations: S.annotations.filter((x) => x.id !== a.id),
      });
      renderMarks();
    };
    layer.append(el);
  }
  const query = $("#find-text").value.toLocaleLowerCase();
  if (query && S.hits.some((h) => h.page === S.page))
    for (const item of [
      ...new Map(
        S.hits
          .filter((h) => h.page === S.page)
          .flatMap((h) => h.items || [])
          .map((i) => [JSON.stringify(i.transform) + i.str, i]),
      ).values(),
    ]) {
      const a = S.view.convertToViewportPoint(
          item.transform[4],
          item.transform[5],
        ),
        b = S.view.convertToViewportPoint(
          item.transform[4] + item.width,
          item.transform[5] + item.height,
        ),
        el = document.createElement("div");
      el.className = "search-mark";
      Object.assign(el.style, {
        left: Math.min(a[0], b[0]) + "px",
        top: Math.min(a[1], b[1]) + "px",
        width: Math.abs(b[0] - a[0]) + "px",
        height: Math.max(8, Math.abs(b[1] - a[1])) + "px",
      });
      layer.append(el);
    }
}
function annotateDialog() {
  modal(
    "添加批注",
    `<p>选定类型后，在页面上拖出矩形区域。双击本次新增批注可删除。批注不是安全涂黑，不能用于隐去敏感内容。</p><label>类型<select id="anno-type"><option value="highlight">区域高亮</option><option value="rectangle">矩形边框</option><option value="note">便笺</option></select></label><label>批注内容<textarea id="anno-text" rows="3"></textarea></label><p class="hint">按 Esc 退出绘制模式。当前编辑会写入标准 PDF 批注字典。</p>`,
    [
      { text: "取消", run: closeModal },
      {
        text: "开始绘制",
        primary: true,
        run: () => {
          const type = $("#anno-type").value,
            text = $("#anno-text").value;
          closeModal();
          startDraw(type, text);
        },
      },
    ],
  );
}
function startDraw(type, text) {
  const layer = $("#draw-layer");
  if (!layer) return;
  layer.classList.add("active");
  status("在页面上拖动添加批注 · Esc 退出");
  let start, box;
  layer.onpointerdown = (e) => {
    const r = layer.getBoundingClientRect();
    start = [e.clientX - r.left, e.clientY - r.top];
    box = document.createElement("div");
    box.className = "selection-box";
    layer.replaceChildren(box);
    layer.setPointerCapture(e.pointerId);
  };
  layer.onpointermove = (e) => {
    if (!start) return;
    const r = layer.getBoundingClientRect(),
      x = Math.max(0, Math.min(r.width, e.clientX - r.left)),
      y = Math.max(0, Math.min(r.height, e.clientY - r.top));
    Object.assign(box.style, {
      left: Math.min(x, start[0]) + "px",
      top: Math.min(y, start[1]) + "px",
      width: Math.abs(x - start[0]) + "px",
      height: Math.abs(y - start[1]) + "px",
    });
  };
  layer.onpointerup = (e) => {
    if (!start) return;
    const r = layer.getBoundingClientRect(),
      end = [
        Math.max(0, Math.min(r.width, e.clientX - r.left)),
        Math.max(0, Math.min(r.height, e.clientY - r.top)),
      ];
    if (Math.abs(end[0] - start[0]) < 3 || Math.abs(end[1] - start[1]) < 3) {
      end[0] = Math.min(r.width, start[0] + 24);
      end[1] = Math.min(r.height, start[1] + 24);
    }
    const a = S.view.convertToPdfPoint(...start),
      b = S.view.convertToPdfPoint(...end),
      rect = [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]),
      ];
    commit(S.nodes, {
      annotations: [
        ...S.annotations,
        {
          id: uid(),
          page: S.page,
          type,
          text,
          rect,
          color: type === "rectangle" ? "#5267db" : "#f3c640",
        },
      ],
    });
    stopDraw();
    renderMarks();
    toast("批注已添加；双击可删除");
  };
}
function stopDraw() {
  const layer = $("#draw-layer");
  if (!layer) return;
  layer.classList.remove("active");
  layer.replaceChildren();
  layer.onpointerdown = layer.onpointermove = layer.onpointerup = null;
  status("就绪");
}
async function searchText() {
  const query = $("#find-text").value.trim().toLocaleLowerCase();
  if (!query || !S.pdf) return;
  const token = ++findToken;
  S.hits = [];
  S.hitIndex = -1;
  for (let page = 1; page <= S.info.pageCount; page++) {
    if (token !== findToken) return;
    $("#find-count").textContent = `扫描 ${page}/${S.info.pageCount}`;
    const p = await S.pdf.getPage(page),
      t = await p.getTextContent();
    if (token !== findToken) return;
    let text = "",
      items = [];
    for (const item of t.items) {
      items.push({ start: text.length, item });
      text += item.str || "";
    }
    const lower = text.toLocaleLowerCase();
    let at = -1;
    while ((at = lower.indexOf(query, at + 1)) >= 0) {
      const range = items.filter(
        (x) =>
          x.start + (x.item.str?.length || 0) > at &&
          x.start < at + query.length,
      );
      if (!range.length) continue;
      const item = range[0].item;
      S.hits.push({
        page,
        x: item.transform[4],
        y: item.transform[5] + (item.height || 10) + 12,
        items: range.map((x) => x.item),
      });
      if (S.hits.length >= 20000) break;
    }
    if (S.hits.length >= 20000) break;
    if (page % 8 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  $("#find-count").textContent = `${S.hits.length} 处匹配`;
  if (S.hits.length) {
    S.hitIndex = -1;
    await nextHit(1);
  } else renderMarks();
}
async function nextHit(dir) {
  if (!S.hits.length) return;
  S.hitIndex = (S.hitIndex + dir + S.hits.length) % S.hits.length;
  const h = S.hits[S.hitIndex];
  await surface.go(h.page, { mode: "XYZ", args: [h.x, h.y, null] });
  $("#find-count").textContent = `${S.hitIndex + 1}/${S.hits.length} 处匹配`;
}
async function cacheDialog() {
  if (!window.desktop?.ocrJob) throw Error("任务缓存管理需要桌面运行包");
  const tasks = await window.desktop.ocrJob({ action: "history" });
  const bytes = tasks.reduce((n, t) => n + (t.bytes || 0), 0);
  modal(
    "OCR 任务记录与缓存",
    `<p class="callout">任务缓存合计 ${(bytes / 1048576).toFixed(1)} MB。当前任务受到保护；已应用结果和工作工程不依赖这里的任务缓存。</p><div class="preview-list">${tasks.map((t) => `<div class="preview-item"><span>${esc(t.name || t.id.slice(0, 12))} · ${t.completed} 页 · ${((t.bytes || 0) / 1048576).toFixed(1)} MB · ${new Date(t.created).toLocaleDateString()}</span><button data-cache-remove="${t.id}" ${t.active ? "disabled" : ""}>${t.active ? "当前任务" : "清理"}</button></div>`).join("") || "暂无任务缓存"}</div>`,
    [{ text: "关闭", run: closeModal }],
  );
  $("#modal-body").onclick = (e) => {
    const b = e.target.closest("[data-cache-remove]");
    if (b)
      guarded(async () => {
        b.disabled = true;
        try {
          await window.desktop.ocrJob({
            action: "remove",
            id: b.dataset.cacheRemove,
          });
          await cacheDialog();
        } catch (err) {
          b.disabled = false;
          throw err;
        }
      });
  };
  modalCleanup = () => {
    $("#modal-body").onclick = null;
  };
}
async function settingsDialog() {
  const software = (await window.desktop?.graphics?.()) || false;
  modal(
    "偏好设置",
    `<div class="form-grid"><label>默认留白单位<select id="set-whitespace-unit"><option value="mm">毫米 mm</option><option value="pt">点 pt</option></select></label><label>主题<select id="set-theme"><option value="light">浅色</option><option value="dark">深色</option></select></label><label>书签侧栏宽度（px）<input id="set-sidebar" type="number" min="240" max="480" value="${settings.sidebar}"></label><label>书签行高<select id="set-row"><option value="28">紧凑 · 28 px</option><option value="34">标准 · 34 px</option><option value="40">宽松 · 40 px</option></select></label><label>渲染像素倍率上限<select id="set-quality"><option value="1">1× · 节省内存</option><option value="2">2× · 推荐</option><option value="3">3× · 高清</option></select></label><label>撤销步数上限<input id="set-undo" type="number" min="5" max="100" value="${settings.undo}"></label></div><label class="check"><input id="set-outline" type="checkbox" ${settings.showBookmarks ? "checked" : ""}>保存后建议阅读器显示书签面板</label><label class="check"><input id="set-protect" type="checkbox" ${settings.protect ? "checked" : ""}>原文件保护：首次保存为副本，之后更新副本</label><label class="check"><input id="set-restore" type="checkbox" ${settings.restoreView ? "checked" : ""}>记住每本文档的阅读位置、缩放和布局（关闭后尊重文档初始视图）</label><label class="check"><input id="set-ignore-zoom" type="checkbox" ${settings.ignoreZoom ? "checked" : ""}>忽略书签的缩放要求（不修改 PDF 目标）</label><label class="check"><input id="set-wrap" type="checkbox" ${settings.wrap ? "checked" : ""}>长书签标题显示两行</label><label class="check"><input id="set-summary" type="checkbox" ${settings.saveSummary ? "checked" : ""}>保存前显示修改摘要</label><label class="check"><input id="set-gpu" type="checkbox" ${software ? "checked" : ""} ${window.desktop?.graphics ? "" : "disabled"}>显卡兼容：关闭硬件加速（重新启动后生效）</label><button data-action="shortcuts">自定义快捷键…</button><button id="ocr-cache-open">OCR 任务记录与缓存…</button><p class="hint">撤销快照受 32 MB 预算限制；画布按可见范围加载，高清画布与分块按约 128 MB 预算回收，当前可见区域优先，缩放期间保留已完成画面。恢复快照在编辑停止 0.7 秒后保存在本机。</p>`,
    [
      { text: "取消", run: closeModal },
      {
        text: "应用设置",
        primary: true,
        run: async () => {
          const sidebar = Number($("#set-sidebar").value),
            undo = Number($("#set-undo").value);
          if (sidebar < 240 || sidebar > 480 || undo < 5 || undo > 100)
            throw Error("设置数值超出范围");
          if (window.desktop?.graphics)
            await window.desktop.graphics($("#set-gpu").checked);
          Object.assign(settings, {
            whitespaceUnit: $("#set-whitespace-unit").value,
            saveSummary: $("#set-summary").checked,
            protect: $("#set-protect").checked,
            restoreView: $("#set-restore").checked,
            ignoreZoom: $("#set-ignore-zoom").checked,
            wrap: $("#set-wrap").checked,
            theme: $("#set-theme").value,
            sidebar,
            row: Number($("#set-row").value),
            quality: Number($("#set-quality").value),
            undo,
            showBookmarks: $("#set-outline").checked,
          });
          applySettings();
          closeModal();
        },
      },
    ],
  );
  $("#ocr-cache-open").onclick = () => guarded(cacheDialog);
  $("#set-whitespace-unit").value = preferredUnit();
  $("#set-theme").value = settings.theme;
  $("#set-row").value = settings.row;
  $("#set-quality").value = settings.quality;
}
function helpDialog() {
  modal(
    document.title,
    `<p>面向 Windows 11 x64 的离线书签工作台。建议先用副本验证实际工作文档。</p><h3>快捷操作</h3><p>Ctrl+O 打开 · Ctrl+S 保存 · Ctrl+Shift+S 另存 · Ctrl+B 书签面板 · Ctrl+Shift+B 新建<br>Ctrl+Z 撤销 · Ctrl+Y 重做 · Ctrl+F 搜索正文 · Ctrl+滚轮缩放 · Alt+左右返回视图<br>Ctrl / Shift 多选 · Delete 删除 · F2 改名<br>书签树中 Ctrl+A 全选 · Alt+左右箭头 升降级 · Tab 移动焦点<br>拖动行：上部插在前面，中部成为子项，下部插在后面；左侧退级区域移至根层。悬停展开，Esc 取消</p><h3>精确目标</h3><p>PDF 坐标以 pt 为单位，使用原生页面坐标系。XYZ = [左, 顶, 缩放]；留空为 null。FitR = [左, 底, 右, 顶]。XYZ 的 zoom=0 由阅读器解释为保持缩放。原始动作默认保持；使用「整理 → 原始本地目标 → 可编辑目标」后可统一偏移。</p><h3>当前边界</h3><p>已实现书签、批注、旋转、页面提取与追加、文档属性编辑。已加入文字/路径对象编辑、离线 OCR、段落流式编辑和同页分栏续排；工作工程可续编。加密文件可通过更多工具导出无密码副本后编辑。尚未实现跨页文章重排、公式结构编辑、表单编辑、安全涂黑、数字签名，以及 PDF-XChange 专有书签导入导出。不是 PDF-XChange 全功能替代品。</p><h3>技术与许可</h3><p>Electron 44.3.0 · PDF.js 5.6.205（Apache-2.0）· pdf-lib 1.17.1（MIT）。源码及依赖许可随包附带。没有遥测和在线更新功能。</p>`,
    [{ text: "开始使用", primary: true, run: closeModal }],
  );
}
let recoveryPending = new Map(),
  recoveryTimer,
  viewTimer,
  recoveryReady = false,
  recoveryChain = Promise.resolve(),
  clipboardNodes = null,
  clipboardCut = null;
function scheduleRecovery() {
  if (!recoveryReady) return;
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => {
    const value =
      S.dirty || S.flowDraftDirty
        ? {
            sessionId: S.sessionId,
            name: S.name,
            bytes: S.bytes,
            state: {
              ...clone({ ...snapshot(), ocr: [], nativeEdits: [] }),
              ocr: S.ocr,
              nativeEdits: immutableEdits(S.nativeEdits),
            },
            baseline: S.baseline,
            view: surface.capture(),
            flowDraft: S.flowEdit?.draft?.() || null,
            savedAt: Date.now(),
          }
        : null;
    recoveryPending.set(S.sessionId, value);
    recoveryChain = recoveryChain
      .then(async () => {
        for (const [id, latest] of recoveryPending) {
          recoveryPending.delete(id);
          await recoveryStore(latest, id);
        }
      })
      .catch((e) => toast("恢复快照未写入：" + e.message));
  }, 700);
}
function saveView() {
  if (S.pdf && S.fingerprint && settings.restoreView) {
    const v = surface.capture();
    if (v)
      localStorage.setItem("folio-view-" + S.fingerprint, JSON.stringify(v));
  }
}
function syncLayout() {
  if ($("#layout")) $("#layout").value = surface.layout;
  $("#cover").checked = surface.cover;
  $("#gaps").checked = surface.gaps;
}
const surface = new PageSurface(
  pdfjs,
  $("#canvas-host"),
  S,
  settings,
  (entry) => {
    $("#page-number").value = S.page;
    $("#page-label").textContent =
      `第 ${S.page} 页${S.labels?.[S.page - 1] ? " · 页标签 " + S.labels[S.page - 1] : ""} · ${Math.round(entry.page.view[2] - entry.page.view[0])} × ${Math.round(entry.page.view[3] - entry.page.view[1])} pt`;
    $("#render-info").textContent = `${Math.round(S.scale * 100)}%`;
    const pixels = [...surface.entries.values()].reduce(
      (v, e) => v + e.canvas.width * e.canvas.height,
      0,
    );
    $("#performance").textContent = "本地处理";
    $("#performance").title =
      `诊断：画布 ${((pixels * 4) / 1048576).toFixed(1)} MB · ${surface.entries.size} 页缓存`;
    syncZoom();
    syncLayout();
    renderMarks();
    showTargetMarker();
    nativeUI?.overlay();
    clearTimeout(viewTimer);
    viewTimer = setTimeout(saveView, 350);
  },
  error,
);
function showTargetMarker() {
  const m = surface.marker,
    e = surface.entries.get(S.page);
  if (!e) return;
  e.shell.querySelector(".target-marker")?.remove();
  if (!m || m.page !== S.page || !selectedNode()) return;
  if (m.native) m.point = e.viewport.convertToViewportPoint(...m.native);
  const line = document.createElement("div");
  line.className = "target-marker";
  line.style.top = m.point[1] + "px";
  line.title = "跳转目标 · 拖动微调所选书签";
  line.textContent = "目标";
  e.shell.append(line);
  line.onpointerdown = (ev) => {
    const n = selectedNode();
    if (!n || n.target.page !== S.page) return;
    ev.preventDefault();
    ev.stopPropagation();
    line.setPointerCapture(ev.pointerId);
  };
  line.onpointermove = (ev) => {
    if (!line.hasPointerCapture(ev.pointerId)) return;
    line.style.top =
      Math.max(
        0,
        Math.min(
          e.viewport.height,
          ev.clientY - e.shell.getBoundingClientRect().top,
        ),
      ) + "px";
  };
  line.onpointerup = (ev) => {
    if (!line.hasPointerCapture(ev.pointerId)) return;
    line.releasePointerCapture(ev.pointerId);
    const n = selectedNode();
    if (!n) return;
    const y = parseFloat(line.style.top),
      point = e.viewport.convertToPdfPoint(m.point[0], y),
      out = clone(S.nodes),
      edited = out.find((x) => x.id === n.id);
    edited.target = {
      kind: "dest",
      page: S.page,
      mode: "XYZ",
      args: [point[0], point[1], null],
    };
    guarded(() => commit(out));
    surface.marker.point = [m.point[0], y];
    surface.marker.native = point;
    toast("目标已微调，可撤销");
  };
}
function createBookmark(where = "after", selection = null) {
  if (!S.pdf) return;
  const ref = selectedNode(),
    n = makeNode(selection?.text || "新书签", selection?.page || S.page),
    point = selection?.point || visiblePdfPoint();
  n.target.args = [...point, null];
  const out = insertGenerated(S.nodes, [n], where, ref?.id);
  S.selected = new Set([n.id]);
  if (ref) S.collapsed.delete(ref.id);
  commit(out);
  reveal(n.id);
  renameInline();
}
function renameInline() {
  const n = selectedNode();
  if (!n) return;
  reveal(n.id);
  const row = $('.tree-row[data-id="' + n.id + '"]');
  if (!row) return;
  const title = row.querySelector(".title"),
    input = document.createElement("input");
  input.className = "inline-name";
  input.value = n.title;
  title.replaceChildren(input);
  row.draggable = false;
  input.focus();
  input.select();
  let done = false;
  const finish = (apply) => {
    if (done) return;
    done = true;
    input.remove();
    if (apply && input.value !== n.title)
      guarded(() => {
        const out = clone(S.nodes);
        out.find((x) => x.id === n.id).title = input.value;
        commit(out);
      });
    else renderTree();
    $("#tree").focus({ preventScroll: true });
  };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  };
  input.onblur = () => finish(true);
}
function removeSpecial(mode) {
  const selected = new Set(S.selected),
    all = descendants(S.nodes, selected),
    removed =
      mode === "children"
        ? new Set([...all].filter((id) => !selected.has(id)))
        : selected,
    out = [];
  for (const original of S.nodes) {
    if (removed.has(original.id)) continue;
    const n = clone(original);
    while (removed.has(n.parent)) n.parent = S.index.get(n.parent).parent;
    out.push(n);
  }
  commit(out);
}
function copyTree(cut = false) {
  const ids = descendants(S.nodes, S.selected);
  clipboardNodes = clone(S.nodes.filter((n) => ids.has(n.id)));
  clipboardCut = cut ? new Set(S.selected) : null;
  toast(`${cut ? "剪切" : "复制"} ${clipboardNodes.length} 个书签`);
}
function pasteTree() {
  if (!clipboardNodes?.length) return;
  const ref = selectedNode();
  if (clipboardCut) {
    commit(move(S.nodes, clipboardCut, ref?.id || null, "inside"));
    clipboardCut = null;
    return;
  }
  const map = new Map(clipboardNodes.map((n) => [n.id, uid()])),
    chunk = clone(clipboardNodes);
  for (const n of chunk) {
    n.id = map.get(n.id);
    n.parent = map.get(n.parent) || null;
  }
  commit(insertGenerated(S.nodes, chunk, "child", ref?.id));
}
function moveSibling(dir) {
  const n = selectedNode();
  if (!n) return;
  const siblings = S.children.get(n.parent),
    i = siblings.findIndex((x) => x.id === n.id),
    target = siblings[i + dir];
  if (target)
    commit(move(S.nodes, S.selected, target.id, dir < 0 ? "before" : "after"));
}
function treeNavigate(e) {
  const n = selectedNode();
  if (["Enter", " "].includes(e.key)) {
    if (n) guarded(() => jump(n));
    return;
  }
  if (e.key === "ArrowRight") {
    if (!n) return;
    if (S.collapsed.has(n.id)) {
      S.collapsed.delete(n.id);
      rebuild();
    } else {
      const child = S.children.get(n.id)?.[0];
      if (child) selectNode(child.id);
    }
    return;
  }
  if (e.key === "ArrowLeft") {
    if (!n) return;
    if (S.children.has(n.id) && !S.collapsed.has(n.id)) {
      S.collapsed.add(n.id);
      rebuild();
    } else if (n.parent) selectNode(n.parent);
    return;
  }
  const i = S.visible.findIndex((v) => v.id === n?.id),
    next =
      S.visible[
        Math.max(
          0,
          Math.min(S.visible.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)),
        )
      ];
  if (next) {
    selectNode(next.id, e);
    const pos = S.visible.indexOf(next) * rowHeight(),
      tree = $("#tree");
    if (pos < tree.scrollTop) tree.scrollTop = pos;
    else if (pos + rowHeight() > tree.scrollTop + tree.clientHeight)
      tree.scrollTop = pos + rowHeight() - tree.clientHeight;
  }
}
function contextMenu(e, items) {
  e.preventDefault();
  $("#context-menu")?.remove();
  const box = document.createElement("div");
  box.id = "context-menu";
  box.role = "menu";
  for (const [label, fn] of items) {
    const b = document.createElement("button");
    b.textContent = label;
    b.role = "menuitem";
    b.onclick = () => {
      box.remove();
      guarded(fn);
    };
    box.append(b);
  }
  document.body.append(box);
  box.style.left = Math.min(e.clientX, innerWidth - box.offsetWidth - 8) + "px";
  box.style.top =
    Math.min(e.clientY, innerHeight - box.offsetHeight - 8) + "px";
  setTimeout(
    () =>
      document.addEventListener(
        "pointerdown",
        (ev) => {
          if (!box.contains(ev.target)) box.remove();
        },
        { once: true },
      ),
    0,
  );
}
function setCurrentTarget(selection = null) {
  const n = selectedNode();
  if (!n) return;
  const out = clone(S.nodes),
    point = selection?.point || visiblePdfPoint();
  out.find((v) => v.id === n.id).target = {
    kind: "dest",
    page: selection?.page || S.page,
    mode: "XYZ",
    args: [...point, selection ? null : S.scale],
  };
  commit(out);
  toast("已设置跳转目标");
}
function gotoDialog() {
  modal(
    "转到页面",
    `<label>物理页码或页标签<input id="goto-value" value="${S.page}"></label><p class="hint">输入数字按物理页定位；输入 i、ii 等标签按 PDF 页标签定位。</p>`,
    [
      {
        text: "转到",
        primary: true,
        run: () => {
          const v = $("#goto-value").value.trim();
          let p = /^\d+$/.test(v) ? Number(v) : (S.labels || []).indexOf(v) + 1;
          if (p < 1 || p > S.info.pageCount) throw Error("页码 / 标签不存在");
          closeModal();
          return goPage(p);
        },
      },
    ],
  );
  $("#goto-value").select();
  $("#goto-value").onkeydown = (e) => {
    if (e.key === "Enter") $("#modal-footer button").click();
  };
}
function panelMode(side) {
  const key = side === "left" ? "leftMode" : "rightMode";
  settings[key] =
    settings[key] === "full"
      ? "narrow"
      : settings[key] === "narrow"
        ? "hidden"
        : "full";
  applySettings();
}
async function fullscreen() {
  if (window.desktop) S.fullscreen = await window.desktop.fullscreen();
  else if (document.fullscreenElement) {
    await document.exitFullscreen();
    S.fullscreen = false;
  } else {
    await document.documentElement.requestFullscreen();
    S.fullscreen = true;
  }
}
async function thumbnailDialog() {
  modal(
    "选择页面",
    `<label>页面范围<input id="thumb-range" value="${S.page}"></label><p class="hint">选好页面后可直接识别或生成书签；双击导航请使用「转到首个所选页」。</p>`,
    [
      { text: "关闭", run: closeModal },
      {
        text: "转到首个所选页",
        run: () => {
          const pages = pageRange($("#thumb-range").value, S.info.pageCount);
          if (!pages.length) return;
          closeModal();
          return goPage(pages[0]);
        },
      },
      {
        text: "OCR 所选页",
        run: async () => {
          const range = $("#thumb-range").value;
          pageRange(range, S.info.pageCount);
          S.selectedPages = new Set(pageRange(range, S.info.pageCount));
          closeModal();
          await nativeUI.ocrDialog();
          $("#ocr-range").value = range;
          $("#ocr-range").dispatchEvent(new Event("input", { bubbles: true }));
        },
      },
      {
        text: "生成书签",
        primary: true,
        run: () => {
          const range = $("#thumb-range").value;
          pageRange(range, S.info.pageCount);
          S.selectedPages = new Set(pageRange(range, S.info.pageCount));
          closeModal();
          multiGenerateDialog();
          $("#multi-range").value = range;
          $("#multi-range").dispatchEvent(
            new Event("input", { bubbles: true }),
          );
        },
      },
    ],
  );
  modalCleanup = installPagePicker($("#thumb-range"), { S, surface });
  $("#modal .range-visual").open = true;
}
function multiGenerateDialog() {
  const draftKey = "folio-rule-draft-" + (S.fingerprint || S.name);
  let storedDraft = null;
  try {
    storedDraft = JSON.parse(localStorage.getItem(draftKey) || "null");
  } catch {}
  const ruleHistory = [],
    ruleFuture = [];
  let restoringDraft = true,
    generatedScope = null,
    unitControl = null;
  const sourceDocument = S.bytes;
  let rules = clone(defaultRules).map((r) => ({
      ...r,
      offset: fromPoints(r.offset, preferredUnit()),
    })),
    generated = null,
    result = null,
    cancelled = false,
    running = false,
    w = null,
    revision = 0,
    activeRule = 0,
    composingRule = false,
    pendingPreview = false,
    taskCancelled = false,
    cancelWorker = null;
  const presetList = () =>
    JSON.parse(localStorage.getItem("folio-rule-presets") || "{}");
  modal(
    "多级规则 · 自动生成书签",
    `<div class="form-grid three"><label>扫描物理页范围<input id="multi-range" value="${S.page}"></label><label>子集<select id="multi-parity"><option value="all">全部</option><option value="odd">奇数页</option><option value="even">偶数页</option></select></label><label>标题顶部留白单位<select id="multi-unit"><option value="pt">pt</option><option value="mm">mm</option></select></label></div><div class="form-grid three"><label>排除页眉高度（pt）<input id="multi-header" type="number" min="0" value="0"></label><label>排除页脚高度（pt）<input id="multi-footer" type="number" min="0" value="0"></label><label>文字区域右边界（pt，可留空）<input id="multi-right" type="number" placeholder="全宽"></label></div><p class="hint">规则按层级生成，父项取前面最近的有效上一级；停用的层级不参与生成，其余启用层级连续编号。多规则命中按列表优先级处理，可切换为跳过。缺少父项可跳过或提升层级。跨页范围从子级开始时，请把前面的父级页纳入扫描。</p><div class="rule-toolbar"><button id="rule-add">＋ 规则</button><button id="rule-default">通用层级示例</button><button id="rule-save">保存预设</button><select id="rule-presets"><option value="">加载预设…</option>${Object.keys(
      presetList(),
    )
      .map((n) => `<option>${esc(n)}</option>`)
      .join(
        "",
      )}</select><button id="rule-import">导入</button><button id="rule-export">导出</button><button id="gen-other">字号 / 目录 / 页间隔…</button></div><div class="form-grid"><label>多规则冲突<select id="multi-conflict"><option value="first">优先使用第一条命中规则</option><option value="skip">跳过并诊断</option></select></label><label>缺少父级<select id="multi-orphan"><option value="skip">跳过并诊断</option><option value="promote">提升至最近有效层级</option></select></label><label>文字来源<select id="multi-source"><option value="auto">自动（已校对 OCR 优先）</option><option value="pdf">PDF 文字层</option><option value="ocr">已应用的 OCR 结果</option></select></label><label class="check"><input id="multi-join" type="checkbox">合并相邻跨行标题（最多 3 行，需核对预览）</label></div><div id="rule-list"></div><div class="form-grid"><label>插入方式<select id="multi-merge"><option value="append">根层末尾追加</option><option value="replace">替换所有书签</option><option value="before">所选书签之前</option><option value="after">所选书签之后</option><option value="child">所选书签的首个子项</option></select></label><label class="check"><input id="multi-dedupe" type="checkbox" checked>跳过同父项、同标题、同页的重复匹配（含现有书签）</label></div><div id="multi-summary" class="callout">先测试当前页或扫描范围，再应用。预览中的书签可点击检查页面位置。</div><canvas id="multi-target-preview" hidden></canvas><div id="multi-preview" class="preview-list"></div><details><summary>命中与忽略诊断（最多 3,000 行）</summary><div id="multi-diagnostics" class="preview-list"></div></details>`,
    [
      { text: "关闭", run: closeModal },
      {
        text: "取消任务",
        id: "multi-cancel-task",
        run: () => {
          taskCancelled = true;
          revision++;
          generated = null;
          $("#multi-apply").disabled = true;
          cancelWorker?.();
          $("#multi-summary").textContent = "任务已取消，可继续修改规则";
        },
      },
      { text: "测试当前页", id: "multi-current", run: () => run(true) },
      { text: "生成范围预览", id: "multi-run", run: () => run(false) },
      {
        text: "应用书签",
        id: "multi-apply",
        primary: true,
        run: () => {
          const wanted = pageRange(
            $("#multi-range").value,
            S.info.pageCount,
            $("#multi-parity").value,
          ).join(",");
          if (sourceDocument !== S.bytes || generatedScope !== wanted)
            throw Error("请先预览当前所选范围");
          if (!generated?.length) throw Error("请生成有效预览");
          let merged = insertGenerated(
            S.nodes,
            generated,
            $("#multi-merge").value,
            selectedNode()?.id,
          );
          if ($("#multi-dedupe").checked)
            merged = duplicatePlan(merged, {
              mode: "page",
              scope: "siblings",
              protectedIds:
                $("#multi-merge").value === "replace"
                  ? null
                  : new Set(S.nodes.map((n) => n.id)),
            }).nodes;
          commit(merged);
          closeModal();
          toast(`已应用 ${generated.length} 个书签`);
        },
      },
    ],
  );
  const advanced = document.createElement("details");
  advanced.className = "generation-advanced";
  advanced.innerHTML = "<summary>高级：文字区域、来源与冲突处理</summary>";
  const headerGrid = $("#multi-header").closest(".form-grid"),
    hint = headerGrid.nextElementSibling,
    optionsGrid = $("#multi-conflict").closest(".form-grid");
  headerGrid.before(advanced);
  advanced.append(headerGrid, hint, optionsGrid);
  advanced.insertAdjacentHTML(
    "beforeend",
    `<div class="form-grid three"><label class="check"><input id="multi-columns" type="checkbox">按阅读栏分开（默认拼接同行）</label><label>大间隔阈值（字高倍数）<input id="multi-gap" type="number" min="0.5" max="20" step="0.5" value="2"></label><label>左侧边界（pt，可留空）<input id="multi-left" type="number"></label></div>`,
  );
  advanced.insertAdjacentHTML(
    "beforeend",
    `<div class="form-grid"><label>同行判断<select id="multi-line-mode"><option value="auto">自动 · 参考局部字高和行距</option><option value="strict">严格</option><option value="relaxed">宽松</option><option value="manual">手动容差</option></select></label><label>手动基线容差（字高倍数）<input id="multi-line-tolerance" type="number" min="0.05" max="1" step="0.05" value="0.4"></label></div><p class="hint">容差只用于候选同行；仍检查邻行与重叠，避免跨行串接。规则不依赖文档行业或词语。</p>`,
  );
  $("#multi-parity").closest("label").hidden = true;
  const disposePicker = installPagePicker($("#multi-range"), { S, surface });
  $("#modal").classList.add("rules-workspace-dialog");
  const workspace = document.createElement("div");
  workspace.className = "rules-workspace";
  const nav = document.createElement("nav");
  nav.className = "rules-nav";
  nav.setAttribute("aria-label", "书签规则列表");
  const editor = document.createElement("section");
  editor.className = "rules-editor";
  const results = document.createElement("section");
  results.className = "rules-results";
  results.setAttribute("aria-label", "匹配预览");
  const settingsPanel = document.createElement("details");
  settingsPanel.className = "rules-settings";
  settingsPanel.innerHTML = "<summary>高级匹配与插入方式</summary>";
  const body = $("#modal-body"),
    rangeGrid = $("#multi-range").closest(".form-grid"),
    toolbar = $("#rule-add").parentElement,
    mergeGrid = $("#multi-merge").closest(".form-grid"),
    diagnostics = $("#multi-diagnostics").parentElement;
  settingsPanel.append(advanced, mergeGrid);
  rangeGrid.classList.add("generation-scope-bar");
  const rangeMore = document.createElement("details");
  rangeMore.className = "range-more";
  rangeMore.innerHTML = "<summary>更多范围选择</summary>";
  const picker = rangeGrid.querySelector(".page-picker");
  rangeMore.append(
    picker.querySelector(".page-ends"),
    picker.querySelector(".range-visual"),
  );
  picker.append(rangeMore);
  editor.append(settingsPanel, toolbar, $("#rule-list"));
  results.append(
    $("#multi-summary"),
    $("#multi-target-preview"),
    $("#multi-preview"),
    diagnostics,
  );
  workspace.append(nav, editor, results);
  body.append(rangeGrid, workspace);
  const tabs = document.createElement("div");
  tabs.className = "rules-view-tabs";
  tabs.innerHTML =
    '<button data-view="edit" aria-pressed="true">规则设置</button><button data-view="results" aria-pressed="false">匹配结果</button>';
  body.insertBefore(tabs, workspace);
  workspace.dataset.view = "edit";
  tabs.onclick = (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    workspace.dataset.view = b.dataset.view;
    tabs
      .querySelectorAll("button")
      .forEach((q) => q.setAttribute("aria-pressed", q === b));
  };
  $("#multi-cancel-task").hidden = true;
  const drawNav = () => {
    nav.replaceChildren();
    rules.forEach((r, i) => {
      const b = document.createElement("button");
      b.className = "rule-nav-item";
      b.dataset.ruleIndex = i;
      b.setAttribute("aria-current", String(i === activeRule));
      b.textContent = `${i + 1}  ${r.name || "未命名规则"}${r.enabled ? "" : " · 已停用"}`;
      const count = generated?.filter((n) => n.origin?.rule === r.name).length;
      if (count != null) {
        const small = document.createElement("small");
        small.textContent = `第 ${r.level} 层 · ${count} 项`;
        b.append(small);
      }
      b.title = b.textContent;
      nav.append(b);
    });
    $("#rule-list")
      .querySelectorAll("[data-rule]")
      .forEach((c) => (c.hidden = +c.dataset.rule !== activeRule));
  };
  nav.onclick = (e) => {
    const b = e.target.closest("[data-rule-index]");
    if (b) {
      activeRule = +b.dataset.ruleIndex;
      drawNav();
    }
  };

  const invalidate = () => {
    revision++;
    generatedScope = null;
    try {
      if (!restoringDraft)
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            config: config(),
            range: $("#multi-range").value,
            merge: $("#multi-merge").value,
            dedupe: $("#multi-dedupe").checked,
            activeRule,
          }),
        );
    } catch {}
    generated = null;
    $("#multi-apply").disabled = true;
    $("#multi-summary").textContent = "预览待更新 · 正在编辑规则";
    $("#multi-preview").classList.add("stale-preview");
  };
  const render = () => {
    rules.forEach((r, i) => (r.level = i + 1));
    invalidate();
    $("#rule-list").innerHTML = rules
      .map(
        (r, i) =>
          `<div class="rule-card" data-rule="${i}" ><div class="rule-toolbar"><label class="check"><input data-field="enabled" type="checkbox" ${r.enabled ? "checked" : ""}>启用</label><input data-field="name" value="${esc(r.name)}" aria-label="规则名称"><label>层级 <input data-field="level" type="number" min="1" value="${r.level}" readonly></label><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div><label>正则表达式<input data-field="pattern" value="${esc(r.pattern)}" spellcheck="false" autocomplete="off"></label><small class="rule-pattern-error" role="status"></small><div class="form-grid"><label>标题来源<select data-field="titleMode"><option value="template" ${!r.titleMode || r.titleMode === "template" ? "selected" : ""}>捕获组模板</option><option value="line" ${r.titleMode === "line" ? "selected" : ""}>完整行</option><option value="match" ${r.titleMode === "match" ? "selected" : ""}>匹配部分</option></select></label><label>标题模板（$0 / $1 / $2 / {page}）<input data-field="template" value="${esc(r.template)}"></label><label>定位捕获组（0 为匹配开头）<input data-field="targetGroup" type="number" min="0" value="${r.targetGroup || 0}"></label><label>顶部留白<input data-field="offset" type="number" step="any" value="${r.offset}"></label></div><label class="check"><input data-field="requireGroups" type="checkbox" ${r.requireGroups !== false ? "checked" : ""}>模板中的捕获组不能为空</label><div class="property-row"><label><input data-field="bold" type="checkbox" ${r.bold ? "checked" : ""}>粗体</label><label><input data-field="italic" type="checkbox" ${r.italic ? "checked" : ""}>斜体</label><input data-field="color" type="color" value="${r.color}"></div></div>`,
      )
      .join("");
    activeRule = Math.max(0, Math.min(activeRule, rules.length - 1));
    drawNav();
  };
  $("#rule-list").oninput = (e) => {
    const card = e.target.closest("[data-rule]"),
      f = e.target.dataset.field;
    if (!card || !f) return;
    rules[+card.dataset.rule][f] =
      e.target.type === "checkbox"
        ? e.target.checked
        : e.target.type === "number"
          ? Number(e.target.value)
          : e.target.value;
    if (!composingRule) {
      const note = card.querySelector(".rule-pattern-error");
      try {
        new RegExp(rules[+card.dataset.rule].pattern);
        note.textContent = "";
      } catch (err) {
        note.textContent = "正则尚未完整：" + err.message;
      }
      if (["name", "enabled"].includes(f)) drawNav();
    }
    invalidate();
  };
  const rememberRules = () => {
    ruleHistory.push(clone(rules));
    if (ruleHistory.length > 50) ruleHistory.shift();
    ruleFuture.length = 0;
  };
  $("#rule-add").insertAdjacentHTML(
    "afterend",
    '<button id="rule-undo" title="撤销规则列表修改">撤销规则</button><button id="rule-redo" title="重做规则列表修改">重做</button>',
  );
  for (const [id, from, to] of [
    ["rule-undo", ruleHistory, ruleFuture],
    ["rule-redo", ruleFuture, ruleHistory],
  ])
    $("#" + id).onclick = () => {
      if (!from.length) return;
      to.push(clone(rules));
      rules = from.pop();
      render();
    };
  $("#rule-list").onclick = (e) => {
    const card = e.target.closest("[data-rule]");
    if (!card) return;
    const i = +card.dataset.rule;
    if (e.target.hasAttribute("data-delete")) {
      rememberRules();
      rules.splice(i, 1);
      render();
    } else if (e.target.dataset.move) {
      const j = i + Number(e.target.dataset.move);
      if (j >= 0 && j < rules.length) {
        rememberRules();
        [rules[i], rules[j]] = [rules[j], rules[i]];
        render();
      }
    }
  };
  $("#rule-add").onclick = () => {
    rememberRules();
    rules.push({
      ...clone(defaultRules[0]),
      offset: fromPoints(defaultRules[0].offset, $("#multi-unit").value),
      name: `第 ${rules.length + 1} 层`,
      level: rules.length + 1,
      pattern: "^标题",
      template: "$0",
    });
    activeRule = rules.length - 1;
    render();
  };
  $("#rule-default").onclick = () => {
    rememberRules();
    rules = [
      {
        ...clone(defaultRules[0]),
        name: "章",
        level: 1,
        pattern: "^第[一二三四五六七八九十百0-9]+章.+",
        template: "$0",
        offset: fromPoints(16, $("#multi-unit").value),
        enabled: true,
      },
      {
        ...clone(defaultRules[0]),
        name: "节",
        level: 2,
        pattern: "^第[一二三四五六七八九十百0-9]+节.+",
        template: "$0",
        offset: fromPoints(16, $("#multi-unit").value),
        enabled: true,
      },
    ];
    render();
  };
  const config = () => ({
    format: "folio-rules/2",
    conflict: $("#multi-conflict").value,
    orphan: $("#multi-orphan").value,
    source: $("#multi-source").value,
    joinLines: $("#multi-join").checked,
    visualRows: !$("#multi-columns").checked,
    gapFactor: +$("#multi-gap").value,
    lineMode: $("#multi-line-mode").value,
    lineTolerance: +$("#multi-line-tolerance").value,
    left: $("#multi-left").value,
    rules,
    header: +$("#multi-header").value,
    footer: +$("#multi-footer").value,
    right: $("#multi-right").value,
    unit: $("#multi-unit").value,
  });
  const load = (v) => {
    if (
      v.format !== "folio-rules/2" ||
      !Array.isArray(v.rules) ||
      v.rules.length > 10000
    )
      throw Error("预设格式无效");
    rememberRules();
    rules = v.rules;
    $("#multi-conflict").value = v.conflict || "first";
    $("#multi-orphan").value = v.orphan || "skip";
    $("#multi-source").value = v.source || "auto";
    $("#multi-join").checked = !!v.joinLines;
    $("#multi-columns").checked = v.visualRows === false;
    $("#multi-gap").value = v.gapFactor || 2;
    $("#multi-line-mode").value = v.lineMode || "auto";
    $("#multi-line-tolerance").value = v.lineTolerance || 0.4;
    $("#multi-left").value = v.left ?? "";
    $("#multi-header").value = v.header ?? 35;
    $("#multi-footer").value = v.footer ?? 35;
    $("#multi-right").value = v.right ?? "";
    const sourceUnit = v.unit || "pt",
      targetUnit = $("#multi-unit").value || preferredUnit();
    rules = rules.map((r) => ({
      ...r,
      offset: fromPoints(toPoints(r.offset, sourceUnit), targetUnit),
    }));
    unitControl?.sync(targetUnit);
    render();
  };
  $("#rule-save").onclick = () => {
    const name = rules.map((r) => r.name).join(" / "),
      p = presetList();
    p[name] = config();
    localStorage.setItem("folio-rule-presets", JSON.stringify(p));
    const o = document.createElement("option");
    o.textContent = name;
    $("#rule-presets").append(o);
    toast("预设已保存：" + name);
  };
  $("#rule-presets").onchange = () =>
    guarded(() => load(presetList()[$("#rule-presets").value]));
  $("#rule-export").onclick = () =>
    guarded(() =>
      writeFile(
        "Folio-rules.json",
        new TextEncoder().encode(JSON.stringify(config(), null, 2)),
        "json",
      ),
    );
  $("#rule-import").onclick = () =>
    guarded(async () => {
      const f = await choose("json");
      if (f) load(JSON.parse(new TextDecoder().decode(f.bytes)));
    });
  $("#gen-other").onclick = () => generateDialog();
  let autoTimer;
  const inputListener = (e) => {
    if (
      !e.target.closest("#multi-preview,#multi-results-nav") &&
      e.target.id !== "multi-merge"
    ) {
      invalidate();
      clearTimeout(autoTimer);
      pendingPreview = true;
      if (!composingRule)
        autoTimer = setTimeout(() => {
          if (!cancelled && !running) {
            pendingPreview = false;
            guarded(() => run(true));
          }
        }, 300);
    }
  };
  const compositionStart = () => {
    composingRule = true;
    clearTimeout(autoTimer);
  };
  const compositionEnd = (e) => {
    composingRule = false;
    inputListener(e);
  };
  $("#modal-body").addEventListener("compositionstart", compositionStart);
  $("#modal-body").addEventListener("compositionend", compositionEnd);
  $("#modal-body").addEventListener("input", inputListener);
  const run = async (current) => {
    if (running || composingRule) return;
    clearTimeout(autoTimer);
    pendingPreview = false;
    taskCancelled = false;
    const pages = current
      ? [S.page]
      : pageRange(
          $("#multi-range").value,
          S.info.pageCount,
          $("#multi-parity").value,
        );
    const c = config(),
      dedupe = $("#multi-dedupe").checked;
    c.rules = c.rules
      .filter((r) => r.enabled)
      .map((r, i) => ({ ...r, level: i + 1 }));
    if (
      !Number.isFinite(c.header) ||
      !Number.isFinite(c.footer) ||
      c.header < 0 ||
      c.footer < 0
    )
      throw Error("页眉页脚排除高度无效");
    invalidate();
    const rev = revision;
    running = true;
    $("#multi-cancel-task").hidden = false;
    $("#multi-run").disabled = $("#multi-current").disabled = true;
    try {
      const lines = [];
      for (const page of pages) {
        if (cancelled || taskCancelled || rev !== revision) return;
        $("#multi-summary").textContent =
          `提取文字 ${page} 页 · ${lines.length} 行`;
        lines.push(
          ...(await extractLines(S.pdf, page, surface.rotation(page), {
            ocr: S.ocr,
            source: c.source,
            right: c.right,
            left: c.left,
            visualRows: c.visualRows,
            gapFactor: c.gapFactor,
            lineMode: c.lineMode,
            lineTolerance: c.lineTolerance,
            joinLines: c.joinLines,
          })),
        );
        if (lines.length > 500000) throw Error("文字行过多，请缩小范围");
        await new Promise((r) => setTimeout(r, 0));
      }
      if (cancelled || taskCancelled || rev !== revision) return;
      result = await new Promise((resolve, reject) => {
        w = new Worker(new URL("./generate-worker.mjs", import.meta.url), {
          type: "module",
        });
        const timeout = setTimeout(() => {
          w.terminate();
          reject(Error("规则运行超过 5 秒，已终止；请简化正则"));
        }, 5000);
        cancelWorker = () => {
          clearTimeout(timeout);
          w?.terminate();
          reject(Error("任务已取消"));
        };
        w.onmessage = (e) => {
          clearTimeout(timeout);
          w.terminate();
          e.data.error ? reject(Error(e.data.error)) : resolve(e.data);
        };
        w.onerror = (e) => {
          clearTimeout(timeout);
          w.terminate();
          reject(Error(e.message));
        };
        w.postMessage({
          mode: "multi",
          lines,
          ...c,
          dedupe,
          pageCount: S.info.pageCount,
        });
      });
      if (cancelled || rev !== revision) return;
      $("#multi-preview").classList.remove("stale-preview");
      generated = result.nodes;
      generatedScope = pages.join(",");
      drawNav();
      const previewNodes = generated;
      const d = depths(previewNodes);
      $("#multi-summary").textContent =
        `${current ? "仅测试当前页" : "已预览所选范围"} ${compactPages(pages)}（${pages.length} 页） · ${generated.length} 项 · ${result.conflicts} 个冲突 · ${result.orphans} 个缺失父级 · ${result.ignored} 行忽略（每组 100 项，可筛选）`;
      $("#multi-results-nav")?.remove();
      let previewPage = 0;
      $("#multi-preview").insertAdjacentHTML(
        "beforebegin",
        `<div id="multi-results-nav" class="flow-toolbar"><input id="multi-search-results" placeholder="筛选生成的标题…"><button id="multi-prev-results">上一组</button><span id="multi-results-page"></span><button id="multi-next-results">下一组</button></div>`,
      );
      const drawResults = () => {
        const query = $("#multi-search-results").value.toLowerCase();
        const matches = previewNodes
          .map((n, i) => ({ n, i }))
          .filter(({ n }) => n.title.toLowerCase().includes(query));
        const total = Math.max(1, Math.ceil(matches.length / 100));
        previewPage = Math.min(previewPage, total - 1);
        $("#multi-results-page").textContent =
          `${previewPage + 1} / ${total} · ${matches.length} 项`;
        $("#multi-prev-results").disabled = !previewPage;
        $("#multi-next-results").disabled = previewPage >= total - 1;
        $("#multi-preview").innerHTML = matches
          .slice(previewPage * 100, (previewPage + 1) * 100)
          .map(
            ({ n, i }) =>
              `<button title="${esc(n.origin?.text || n.title)}" class="preview-item" data-preview="${i}" style="padding-left:${12 + d.get(n.id) * 16}px"><span class="preview-origin">${esc(n.origin?.text || n.title)}</span><strong>${esc(n.title)}</strong><small>第 ${d.get(n.id) + 1} 层 · 第 ${n.target.page} 页</small></button>`,
          )
          .join("");
      };
      $("#multi-search-results").oninput = () => {
        previewPage = 0;
        drawResults();
      };
      $("#multi-prev-results").onclick = () => {
        previewPage--;
        drawResults();
      };
      $("#multi-next-results").onclick = () => {
        previewPage++;
        drawResults();
      };
      drawResults();
      $("#multi-preview").onclick = (e) => {
        const el = e.target.closest("[data-preview]");
        if (el)
          guarded(async () => {
            const n = previewNodes[+el.dataset.preview],
              p = await S.pdf.getPage(n.target.page),
              vp = p.getViewport({
                scale: 1.2,
                rotation: surface.rotation(n.target.page),
              }),
              point = vp.convertToViewportPoint(
                n.target.args[0],
                n.target.args[1],
              ),
              canvas = $("#multi-target-preview");
            canvas.hidden = false;
            canvas.width = Math.min(850, vp.width);
            canvas.height = 180;
            const x = Math.max(0, point[0] - 30),
              y = Math.max(0, point[1] - 24);
            await p.render({
              canvasContext: canvas.getContext("2d"),
              viewport: vp,
              transform: [1, 0, 0, 1, -x, -y],
            }).promise;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "rgba(86,100,217,.16)";
            for (const s of n.origin?.titleSegments || [])
              ctx.fillRect(
                s.left * vp.scale - x,
                s.top * vp.scale - y,
                (s.right - s.left) * vp.scale,
                (s.bottom - s.top) * vp.scale,
              );
            $("#multi-origin-detail")?.remove();
            canvas.insertAdjacentHTML(
              "afterend",
              `<div id="multi-origin-detail" class="callout"><strong>${esc(n.title)}</strong><p>输入：${esc(n.origin?.text || "")}</p><small>捕获组：${esc(JSON.stringify(n.origin?.groups || []))}</small></div>`,
            );
            ctx.strokeStyle = "#db8c36";
            ctx.beginPath();
            ctx.moveTo(0, point[1] - y);
            ctx.lineTo(canvas.width, point[1] - y);
            ctx.stroke();
            canvas.scrollIntoView({ block: "nearest" });
          });
      };
      $("#multi-diagnostics").innerHTML = result.diagnostics
        .slice(0, 3000)
        .map(
          (d) =>
            `<div class="preview-item"><span>p.${d.page} · ${esc(d.text)}</span><small>${esc(d.reason)}${d.groups ? " · " + esc(JSON.stringify(d.groups)) : ""}</small></div>`,
        )
        .join("");
      const wanted = pageRange(
        $("#multi-range").value,
        S.info.pageCount,
        $("#multi-parity").value,
      ).join(",");
      $("#multi-apply").disabled =
        !generated.length ||
        generatedScope !== wanted ||
        sourceDocument !== S.bytes;
      $("#multi-apply").textContent = `应用 ${generated.length} 项书签`;
    } catch (e) {
      if (!cancelled && rev === revision)
        $("#multi-summary").textContent = e.message;
    } finally {
      running = false;
      if (!cancelled) {
        cancelWorker = null;
        $("#multi-cancel-task").hidden = true;
        $("#multi-run").disabled = $("#multi-current").disabled = false;
        if (pendingPreview && !composingRule) {
          clearTimeout(autoTimer);
          autoTimer = setTimeout(() => {
            pendingPreview = false;
            if (!cancelled) guarded(() => run(true));
          }, 300);
        }
      }
    }
  };
  modalCleanup = () => {
    disposePicker();
    cancelled = true;
    clearTimeout(autoTimer);
    cancelWorker?.();
    w?.terminate();
    $("#modal").classList.remove("rules-workspace-dialog");
    $("#modal-body").removeEventListener("compositionstart", compositionStart);
    $("#modal-body").removeEventListener("compositionend", compositionEnd);
    $("#modal-body").removeEventListener("input", inputListener);
  };
  $("#multi-unit").value = preferredUnit();
  render();
  if (storedDraft?.config) {
    try {
      load(storedDraft.config);
      activeRule = storedDraft.activeRule || 0;
      try {
        pageRange(storedDraft.range, S.info.pageCount);
        $("#multi-range").value = storedDraft.range;
      } catch {}
      $("#multi-range").dispatchEvent(new Event("input"));
      $("#multi-merge").value = storedDraft.merge || "append";
      $("#multi-dedupe").checked = storedDraft.dedupe !== false;
      drawNav();
      $("#multi-summary").textContent = "已恢复规则草稿，请重新测试预览";
    } catch {}
  }
  restoringDraft = false;
  unitControl = bindUnit(
    $("#multi-unit"),
    () => [...document.querySelectorAll('[data-field="offset"]')],
    $("#multi-unit").value,
    $("#multi-unit").value,
  );
  $("#multi-unit").addEventListener("change", () => {
    document
      .querySelectorAll('[data-field="offset"]')
      .forEach((e, i) => (rules[i].offset = Number(e.value)));
    invalidate();
  });
  $("#multi-run").textContent = "预览所选范围";
  $("#multi-current").textContent = "仅测试当前页";
  clearTimeout(autoTimer);
}

const actions = {
  "split-bookmark": () =>
    splitDialog({
      S,
      modal,
      closeModal,
      esc,
      commit,
      toast,
      writeFile,
      setCleanup: (fn) => (modalCleanup = fn),
    }),
  open: openFile,
  save: () => savePDF(false),
  "save-as": () => savePDF(true),
  recover: () => recoveryDialog(),
  undo: () => restoreHistory("undo"),
  redo: () => restoreHistory("redo"),
  add: () => addNode(false),
  "add-child": () => addNode(true),
  delete: deleteNodes,
  indent: () => changeLevel(true),
  outdent: () => changeLevel(false),
  duplicate,
  capture,
  batch: batchDialog,
  generate: multiGenerateDialog,
  "generate-classic": generateDialog,
  exchange: exchangeDialog,
  "tree-menu": treeMenu,
  expand: () => {
    S.collapsed.clear();
    rebuild();
  },
  collapse: () => {
    S.collapsed = new Set(S.nodes.map((n) => n.id));
    rebuild();
  },
  prev: () => goPage(S.page - 1),
  next: () => goPage(S.page + 1),
  "zoom-in": () =>
    surface.zoom(String(Math.min(12, S.scale * 1.2))).then(syncZoom),
  "zoom-out": () =>
    surface.zoom(String(Math.max(0.1, S.scale / 1.2))).then(syncZoom),
  rotate: () => {
    surface.viewRotation = (surface.viewRotation + 90) % 360;
    return surface.refresh();
  },
  pages: pagesDialog,
  metadata: metadataDialog,
  annotate: annotateDialog,
  find: () => {
    $("#findbar").hidden = false;
    $("#find-text").focus();
  },
  "find-run": searchText,
  "find-next": () => nextHit(1),
  "find-prev": () => nextHit(-1),
  "find-close": () => {
    findToken++;
    $("#findbar").hidden = true;
    $("#find-text").value = "";
    S.hits = [];
    renderMarks();
  },
  raw: () => {
    const n = selectedNode();
    if (n)
      modal(
        "底层 PDF 字典",
        `<p>原始字典只读，属于打开时的文档快照；保存会重建对象编号。当前编辑内容与源快照分别显示。</p><h3>当前编辑内容（解码文本）</h3><pre>${esc(JSON.stringify({ title: n.title, bold: n.bold, italic: n.italic, color: n.color, target: n.target }, null, 2))}</pre><h3>打开时的源对象 ${esc(n.sourceRef || "新建")}（字节串以十六进制显示）</h3><pre>${esc(n.raw || "此书签为新建，无原始对象。")}</pre>`,
        [{ text: "关闭", run: closeModal }],
      );
  },
  theme: () => {
    settings.theme = settings.theme === "light" ? "dark" : "light";
    applySettings(false);
  },
  decrypt: () =>
    decryptDialog({
      S,
      modal,
      closeModal,
      choose,
      writeFile,
      rpc,
      settings,
      toast,
      setCleanup: (fn) => (modalCleanup = fn),
    }),
  settings: settingsDialog,
  help: helpDialog,
};
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn || btn.disabled) return;
  const a = btn.dataset.action;
  if (S.busy && !["help", "theme"].includes(a)) return;
  guarded(actions[a] || (() => {}));
});
$("#modal-close").onclick = closeModal;
$("#modal").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeModal();
});
$("#properties").onsubmit = (e) => guarded(() => applyProperty(e));
$("#prop-mode").onchange = () => {
  const mode = $("#prop-mode").value;
  $("#prop-page").disabled = mode === "preserve";
  coordinates(
    mode,
    mode === "FitR"
      ? [0, 0, S.info.pages[S.page - 1].width, S.info.pages[S.page - 1].height]
      : Array(MODES[mode] || 0).fill(null),
  );
};
$("#page-number").onchange = () =>
  guarded(() => goPage($("#page-number").value));
$("#zoom").onchange = () => {
  guarded(() => surface.zoom($("#zoom").value));
};
$("#find-text").onkeydown = (e) => {
  if (e.key === "Enter") guarded(searchText);
};
let filterComposing = false;
const updateFilter = () => {
  clearTimeout(filterTimer);
  if (filterComposing) return;
  // Invalidate an in-flight match immediately, before the debounce expires.
  filterEpoch++;
  filterJob?.worker.terminate();
  if (filterJob) clearTimeout(filterJob.timer);
  filterJob = null;
  S.filter = $("#filter").value;
  S.filterPage = $("#filter-page").value;
  filterTimer = setTimeout(() => {
    $("#tree").scrollTop = 0;
    rebuild();
  }, 120);
  $("#filter-select").disabled = true;
  $("#filter-batch").disabled = true;
};
$("#filter").oninput = updateFilter;
$("#filter").oncompositionstart = () => {
  filterComposing = true;
};
$("#filter").oncompositionend = () => {
  filterComposing = false;
  updateFilter();
};
$("#filter-page").oninput = updateFilter;
for (const [id, field] of [
  ["filter-regex", "filterRegex"],
  ["filter-case", "filterCase"],
])
  $("#" + id).onclick = () => {
    S[field] = !S[field];
    $("#" + id).setAttribute("aria-pressed", String(S[field]));
    updateFilter();
  };
$("#clear-filter").onclick = () => {
  $("#filter").value = "";
  $("#filter-page").value = "";
  updateFilter();
};
$("#filter-select").onclick = () => {
  if (!filterReady()) return;
  S.selected = new Set(filterCache.matches);
  rebuild();
};
$("#filter-batch").onclick = () => {
  if (filterReady()) batchDialog();
};
$("#tree").addEventListener("scroll", () => {
  if (treeFrame) return;
  treeFrame = requestAnimationFrame(() => {
    treeFrame = 0;
    renderTree();
  });
});
$("#tree").addEventListener("click", (e) => {
  if (S.busy) return;
  const row = e.target.closest(".tree-row");
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest(".toggle")) {
    S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id);
    rebuild();
    return;
  }
  selectNode(id, e);
  if (!e.ctrlKey && !e.shiftKey && !e.metaKey)
    guarded(() => jump(S.index.get(id)));
});
let dragIds = null,
  dragChosen = null,
  dropState = null,
  dragRow = null,
  dragLabel = null,
  dragFrame = 0,
  dragPointer = null,
  hoverTimer = null,
  hoverId = null;
function clearDrag() {
  dragIds = null;
  dragChosen = null;
  dropState = null;
  dragPointer = null;
  clearTimeout(hoverTimer);
  hoverId = null;
  cancelAnimationFrame(dragFrame);
  dragFrame = 0;
  dragRow?.classList.remove("drop-before", "drop-after", "drop-inside");
  dragRow = null;
  dragLabel?.remove();
  dragLabel = null;
  $("#tree").classList.remove("root-drop");
}
$("#tree").addEventListener("dragstart", (e) => {
  const row = e.target.closest(".tree-row");
  if (!row) return;
  if (!S.selected.has(row.dataset.id)) selectNode(row.dataset.id);
  dragIds = new Set(S.selected);
  dragChosen = descendants(S.nodes, dragIds);
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", row.dataset.id);
  dragLabel = document.createElement("div");
  dragLabel.id = "drag-label";
  dragLabel.textContent = `移动 ${dragChosen.size} 个书签`;
  document.body.append(dragLabel);
});
function dragTick() {
  dragFrame = 0;
  if (!dragPointer || !dragIds) return;
  const { x, y } = dragPointer,
    tree = $("#tree"),
    rect = tree.getBoundingClientRect();
  if (y < rect.top || y > rect.bottom || x < rect.left || x > rect.right) {
    dropState = null;
    return;
  }
  const el = document.elementFromPoint(x, y),
    row = el?.closest(".tree-row");
  dragRow?.classList.remove("drop-before", "drop-after", "drop-inside");
  tree.classList.remove("root-drop");
  let root = x < rect.left + 24 || !row;
  if (root) {
    dropState = { id: null, where: "inside" };
    tree.classList.add("root-drop");
    dragLabel.textContent = `${dragChosen.size} 项 → 根层末尾`;
  } else if (dragChosen.has(row.dataset.id)) {
    dropState = null;
    dragLabel.textContent = "不能移入自身或后代";
  } else {
    const r = row.getBoundingClientRect(),
      relative = (y - r.top) / r.height,
      where = relative < 0.3 ? "before" : relative > 0.7 ? "after" : "inside";
    dropState = { id: row.dataset.id, where };
    row.classList.add("drop-" + where);
    dragRow = row;
    dragLabel.textContent = `${dragChosen.size} 项 → ${where === "inside" ? "成为子项" : where === "before" ? "插到前面" : "插到后面"}`;
    if (where === "inside" && hoverId !== row.dataset.id) {
      clearTimeout(hoverTimer);
      hoverId = row.dataset.id;
      hoverTimer = setTimeout(() => {
        if (dragIds && hoverId === row.dataset.id) {
          S.collapsed.delete(row.dataset.id);
          rebuild();
        }
      }, 600);
    } else if (where !== "inside") {
      clearTimeout(hoverTimer);
      hoverId = null;
    }
  }
  if (root) {
    clearTimeout(hoverTimer);
    hoverId = null;
  }
  const speed =
    y < rect.top + 45
      ? -Math.ceil((rect.top + 45 - y) / 3)
      : y > rect.bottom - 45
        ? Math.ceil((y - rect.bottom + 45) / 3)
        : 0;
  if (speed) {
    tree.scrollTop += speed;
    dragFrame = requestAnimationFrame(dragTick);
  }
}
$("#tree").addEventListener("dragover", (e) => {
  if (!dragIds) return;
  e.preventDefault();
  dragPointer = { x: e.clientX, y: e.clientY };
  dragLabel.style.left = e.clientX + 16 + "px";
  dragLabel.style.top = e.clientY + 12 + "px";
  if (!dragFrame) dragFrame = requestAnimationFrame(dragTick);
});
$("#tree").addEventListener("drop", (e) => {
  e.preventDefault();
  if (!dragIds) return;
  dragPointer = { x: e.clientX, y: e.clientY };
  dragTick();
  const ids = dragIds,
    target = dropState;
  clearDrag();
  if (target)
    guarded(() => {
      commit(move(S.nodes, ids, target.id, target.where));
      if (target.id) S.collapsed.delete(target.id);
      rebuild();
      toast("书签已移动，可撤销");
    });
});
$("#tree").addEventListener("dragend", clearDrag);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && dragIds) clearDrag();
});
let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (S.pdf && !S.busy) guarded(() => renderPage());
    renderTree();
  }, 180);
}).observe($("#canvas-host"));
window.desktop?.onClose(async () => {
  if (largeWorkspace) { await guarded(() => largeWorkspace.close()); return; }
  if (S.busy) {
    toast("正在处理文档，请完成后关闭");
    return;
  }
  if (await confirmDiscard()) window.desktop.close();
});
window.addEventListener("beforeunload", (e) => {
  if ((S.dirty || S.flowDraftDirty) && !window.desktop) {
    e.preventDefault();
    e.returnValue = "";
  }
});
icons();
applySettings();
setBusy(false);
// Browser test harness uses the same file input flow; no network or document upload is involved.
$("#file-input").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file && !S.busy)
    await guarded(async () =>
      openIncoming({
        bytes: new Uint8Array(await file.arrayBuffer()),
        name: file.name,
      }),
    );
};

async function refreshNative(
  edits = S.nativeEdits,
  ocr = S.ocr,
  reference = ocr === S.ocr ? S.ocrReference : null,
) {
  if (!window.desktop?.native) throw Error("内容编辑和 OCR 需要完整桌面运行包");
  const anchor = surface.capture(),
    token = documentSession.capture();
  setBusy(true, "正在生成内容预览…");
  try {
    const bytes =
      edits.length || ocr.length
        ? new Uint8Array(
            (
              await nativeRequest({
                command: "apply",
                bytes: S.bytes,
                edits,
                ocr: reference ? [] : ocr,
                ocrReference: reference,
              })
            ).bytes,
          )
        : new Uint8Array(S.bytes);
    const pdf = await pdfjs.getDocument({
      data: bytes,
      cMapUrl: new URL("./vendor/cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./vendor/standard_fonts/", import.meta.url)
        .href,
      wasmUrl: new URL("./vendor/wasm/", import.meta.url).href,
      isEvalSupported: false,
      enableXfa: false,
    }).promise;
    try {
      documentSession.assert(token);
    } catch (e) {
      await pdf.destroy();
      throw e;
    }
    const old = S.pdf;
    surface.cancel(true);
    S.pdf = pdf;
    surface.signature = "";
    try {
      await surface.refresh(anchor);
    } catch (e) {
      S.pdf = old;
      await pdf.destroy();
      surface.signature = "";
      await surface.refresh(anchor).catch(() => {});
      throw e;
    }
    await old.destroy();
  } finally {
    setBusy(false);
  }
}
const bookmarkUI = installBookmarkUI({
  S,
  surface,
  modal,
  closeModal,
  esc,
  commit,
  guarded,
  toast,
  setCleanup: (fn) => (modalCleanup = fn),
});
async function openPageDiff() {
  if (!S.pdf) return;
  await S.flowEdit?.flush?.();
  const output = await rpc("save", {
    contentBytes:
      S.nativeEdits.length || S.ocr.length ? await S.pdf.getData() : null,
    nodes: S.nodes,
    rotations: S.rotation,
    annotations: S.annotations,
    metadata: S.metadata,
    showBookmarks: settings.showBookmarks,
  });
  return pageDiff({
    S,
    source: S.bytes,
    output,
    pdfjs,
    modal,
    closeModal,
    setCleanup: (fn) => (modalCleanup = fn),
    guarded,
    surface,
    esc,
  });
}
const nativeUI = installNativeUI({
  openPageDiff,
  S,
  surface,
  modal,
  closeModal,
  esc,
  commit,
  refreshNative,
  guarded,
  toast,
  pageRange,
  clone,
  descendants,
  writeFile,
  scheduleRecovery,
  setCleanup: (fn) => {
    modalCleanup = fn;
  },
});
Object.assign(actions, {
  "table-structure": () =>
    tableDialog({
      writeFile,
      S,
      modal,
      closeModal,
      commit,
      refreshNative,
      esc,
      guarded,
      toast,
      setCleanup: (fn) => (modalCleanup = fn),
    }),
  "page-diff": openPageDiff,
  whitespace: nativeUI.whitespaceDialog,
  calibrate: bookmarkUI.calibrateDialog,
  dedupe: bookmarkUI.dedupeDialog,
  "range-start": () => {
    S.rangeStart = S.page;
    toast(`范围起点：第 ${S.page} 页`);
  },
  "range-end": () => {
    S.rangeEnd = S.page;
    toast(`范围终点：第 ${S.page} 页`);
  },
  "edit-content": nativeUI.objectDialog,
  "flow-edit": nativeUI.flowDialog,
  "copy-page": () => copyPageText(surface.selection()?.text || ""),
  ocr: nativeUI.ocrDialog,
  "ocr-preview": nativeUI.toggleOCR,
  "left-expand": () => {
    settings.leftMode = "full";
    applySettings();
  },
  "right-expand": () => {
    settings.rightMode = "full";
    applySettings();
  },
  "toggle-bookmarks": () => {
    settings.leftMode = settings.leftMode === "hidden" ? "full" : "hidden";
    applySettings();
  },
  "toggle-inspector": () => {
    settings.rightMode = settings.rightMode === "hidden" ? "full" : "hidden";
    applySettings();
  },
  "left-mode": () => panelMode("left"),
  "right-mode": () => panelMode("right"),
  "toggle-thumbnails": thumbnailDialog,
  shortcuts: () =>
    shortcutDialog({
      settings,
      modal,
      closeModal,
      esc,
      choose,
      writeFile,
      applySettings,
    }),
  add: () => createBookmark("after"),
  "add-child": () => createBookmark("child"),
  "add-before": () => createBookmark("before"),
  "add-first-child": () => createBookmark("child"),
  "add-selection": () => createBookmark("after", surface.selection()),
  rename: renameInline,
  "copy-tree": () => copyTree(),
  "cut-tree": () => copyTree(true),
  "paste-tree": pasteTree,
  "move-up": () => moveSibling(-1),
  "move-down": () => moveSibling(1),
  "select-all": () => {
    S.selected = new Set(S.visible.map((n) => n.id));
    rebuild();
  },
  first: () => goPage(1),
  last: () => goPage(S.info.pageCount),
  goto: gotoDialog,
  back: () => surface.history(-1),
  forward: () => surface.history(1),
  fit: () => surface.zoom("fit"),
  actual: () => surface.zoom("1"),
  width: () => surface.zoom("width"),
  "screen-next": () => surface.screen(1),
  "screen-prev": () => surface.screen(-1),
  fullscreen,
  "apply-properties": applyProperty,
  "stop-draw": stopDraw,
});
installShortcuts({
  settings,
  actions,
  surface,
  S,
  guarded,
  treeNavigate,
  isModal: () => $("#modal").open,
});
$("#tree").addEventListener("contextmenu", (e) => {
  const row = e.target.closest(".tree-row");
  if (row && !S.selected.has(row.dataset.id)) selectNode(row.dataset.id);
  $("#tree").focus({ preventScroll: true });
  contextMenu(e, [
    ["调整跳转留白…", nativeUI.whitespaceDialog],
    ["按标题校准目标…", bookmarkUI.calibrateDialog],
    ["查找重复书签…", bookmarkUI.dedupeDialog],
    ["正则拆分书签…", actions["split-bookmark"]],
    ["编辑标题 · F2", renameInline],
    ["新增同级书签", () => createBookmark()],
    ["新增子书签", () => createBookmark("child")],
    ["剪切", () => copyTree(true)],
    ["复制", () => copyTree()],
    ["粘贴为子书签", pasteTree],
    ["删除所选与子项", deleteNodes],
    ["仅删除所选，保留子项", () => removeSpecial("retain")],
    ["仅删除子书签", () => removeSpecial("children")],
    ["设置当前视图为目标", () => setCurrentTarget()],
    [
      "属性",
      () => {
        settings.rightMode = "full";
        applySettings(false);
        $("#prop-title").focus();
      },
    ],
    ["底层字典", actions.raw],
  ]);
});
$("#tree").addEventListener("dblclick", (e) => {
  if (e.target.closest(".title") && !e.target.closest("input")) renameInline();
});
async function copyPageText(text) {
  if (window.desktop?.copyText) await window.desktop.copyText(text);
  else await navigator.clipboard.writeText(text);
  toast("已复制文字");
}
$("#canvas-host").addEventListener("contextmenu", (e) => {
  if (e.target.closest(".page-edit-layer")) return;
  const selection = surface.selection();
  contextMenu(e, [
    ...(selection
      ? [
          ["复制 Ctrl+C", () => copyPageText(selection.text)],
          [
            "复制为单行",
            () => copyPageText(selection.text.replace(/\s+/gu, " ").trim()),
          ],
        ]
      : []),
    [
      "从选中文字创建书签",
      () => {
        if (!selection) throw Error("请先选中页面文字");
        createBookmark("after", selection);
      },
    ],
    [
      "用选中文字位置设置目标",
      () => {
        if (!selection) throw Error("请先选中页面文字");
        setCurrentTarget(selection);
      },
    ],
    [
      "框选文字并复制…",
      () =>
        copyRegionDialog({
          S,
          surface,
          modal,
          closeModal,
          guarded,
          copy: copyPageText,
          setCleanup: (fn) => (modalCleanup = fn),
        }),
    ],
    ["当前视图设置为目标", () => setCurrentTarget()],
    ["适合宽度", actions.width],
    ["适合页面", actions.fit],
    ["页面缩略图", thumbnailDialog],
  ]);
});
$("#layout").onchange = () =>
  guarded(async () => {
    const anchor = surface.capture();
    surface.layout = $("#layout").value;
    settings.layout = surface.layout;
    localStorage.setItem("folio-settings", JSON.stringify(settings));
    await surface.refresh(anchor);
  });
for (const [id, key] of [
  ["cover", "cover"],
  ["gaps", "gaps"],
])
  $("#" + id).onchange = () =>
    guarded(async () => {
      surface[key] = $("#" + id).checked;
      settings[key] = surface[key];
      localStorage.setItem("folio-settings", JSON.stringify(settings));
      await surface.refresh();
    });
for (const side of ["left", "right"]) {
  const handle = document.createElement("div");
  handle.className = "panel-resizer " + side;
  handle.title = "拖动调整侧栏宽度";
  document
    .querySelector(side === "left" ? ".outline-panel" : ".inspector")
    .append(handle);
  handle.onpointerdown = (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
  };
  handle.onpointermove = (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const value = side === "left" ? e.clientX : innerWidth - e.clientX;
    settings[side === "left" ? "sidebar" : "inspectorWidth"] = Math.max(
      220,
      Math.min(520, value),
    );
    document.documentElement.style.setProperty(
      side === "left" ? "--sidebar" : "--inspector-width",
      settings[side === "left" ? "sidebar" : "inspectorWidth"] + "px",
    );
  };
  handle.onpointerup = (e) => {
    handle.releasePointerCapture(e.pointerId);
    applySettings();
  };
}
window.addEventListener("pagehide", saveView);
async function recoveryDialog() {
  const records = await recoveryList();
  if (!records.length) {
    toast("没有未保存的恢复草稿");
    return;
  }
  modal(
    "恢复未保存的编辑",
    `<label>选择草稿<select id="recovery-session">${records.map((r) => `<option value="${esc(r.sessionId)}">${esc(r.name || "未命名")} · ${esc(new Date(r.savedAt).toLocaleString())}</option>`).join("")}</select></label><p>恢复前会校验原文和编辑资源；首次保存需选择输出位置。</p>`,
    [
      { text: "稍后", run: closeModal },
      {
        text: "删除所选草稿",
        run: async () => {
          await recoveryStore(null, $("#recovery-session").value);
          closeModal();
          if ((await recoveryList()).length) await recoveryDialog();
        },
      },
      {
        text: "恢复编辑",
        primary: true,
        run: async () => {
          const saved = await recoveryRead($("#recovery-session").value);
          if (!saved) throw Error("草稿已不存在");
          closeModal();
          if (S.pdf && !(await confirmDiscard())) return;
          recoveryReady = false;
          try {
            let composed = null;
            if (saved.state.nativeEdits?.length || saved.state.ocr?.length)
              composed = new Uint8Array(
                (
                  await nativeRequest({
                    command: "apply",
                    bytes: saved.bytes,
                    edits: saved.state.nativeEdits || [],
                    ocr: saved.state.ocr || [],
                  })
                ).bytes,
              );
            const opened = await loadPDF(
              saved.bytes,
              saved.name,
              null,
              saved.state,
              composed,
            );
            if (!opened) return;
            S.sessionId = saved.sessionId || S.sessionId;
            setDirty(true);
            rebuild();
            if (saved.view) await surface.refresh(saved.view);
            if (saved.flowDraft) {
              S.pendingFlowDraft = saved.flowDraft;
              await surface.go(saved.flowDraft.page);
              S.page = saved.flowDraft.page;
              await nativeUI.flowDialog();
            }
          } finally {
            recoveryReady = true;
            if (S.bytes !== saved.bytes) void releaseSource(saved.bytes);
            scheduleRecovery();
          }
        },
      },
    ],
  );
}
guarded(async () => {
  try {
    if ((await recoveryList()).length) await recoveryDialog();
  } finally {
    recoveryReady = true;
  }
});
// Local regression harness exports. No IPC or network access is added.
export { S, surface, commit };

// Resolve an on-page draft before document mutations launched from a toolbar.
document.addEventListener(
  "click",
  (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || !S.flowEdit?.editing || b.disabled) return;
    const a = b.dataset.action;
    if (
      [
        "flow-edit",
        "fit",
        "actual",
        "width",
        "zoom-in",
        "zoom-out",
        "theme",
        "fullscreen",
        "toggle-bookmarks",
        "toggle-inspector",
      ].includes(a)
    )
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    guarded(async () => {
      await S.flowEdit?.flush();
      await (actions[a] || (() => {}))();
    });
  },
  true,
);

// Compact overflow menu closes after a command or outside click; Escape remains keyboard accessible.
document.addEventListener("click", (e) => {
  const menu = document.querySelector(".more-tools");
  if (menu && (!menu.contains(e.target) || e.target.closest("[data-action]")))
    menu.open = false;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const menu = document.querySelector(".more-tools");
    if (menu?.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  }
});

async function openIncoming(f) {
  if (S.busy) { if(f.large) await window.desktop.largeRelease(f.handle); return; }
  if (f.large) {
    if (largeWorkspace) { await window.desktop.largeRelease(f.handle); throw Error("请先关闭大文件工作区"); }
    await openLargeWorkspace(f, {
      originalDirty: !!(S.dirty || S.flowDraftDirty),
      confirmDiscard: text => confirmDialog("关闭大文件", text, "丢弃并关闭"),
      onReady: workspace => { largeWorkspace=workspace; },
      onClose: () => { largeWorkspace=null; },
    });
    return;
  }
  if (f.handle && f.handle === S.handle) {
    toast("此文档已打开");
    return;
  }
  if (await confirmDiscard()) await loadPDF(f.bytes, f.name, f.handle);
}
installDropOpen({
  open: openIncoming,
  toast,
  isBusy: () => S.busy || !!document.querySelector("dialog[open]"),
});

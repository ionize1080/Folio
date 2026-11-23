import { icon } from "./icons.mjs";
import { t } from "./i18n.mjs";

export function installCommandPalette({ S, actions, guarded, toast }) {
  let dialog = null;

  function collectCommands() {
    const items = [];
    const seen = new Set();
    const add = (id, label, group, run, { shortcut = "", doc = false, symbol = "sliders", keywords = "" } = {}) => {
      if (seen.has(id)) return;
      seen.add(id);
      const localLabel = t(label);
      const localGroup = t(group);
      items.push({
        id,
        label,
        group,
        run,
        shortcut,
        doc,
        symbol,
        search: `${label} ${localLabel} ${group} ${localGroup} ${id} ${keywords}`.toLowerCase(),
      });
    };

    const clickEl = (sel) => () => {
      const el = document.querySelector(sel);
      if (!el || el.disabled) throw Error("当前状态下不可用");
      el.click();
    };

    add("open", "打开 PDF 或工作工程", "文件", () => actions.open?.(), { shortcut: "Ctrl+O", symbol: "folder", keywords: "open file pdf folio" });
    add("save", "保存当前文档", "文件", () => actions.save?.(), { shortcut: "Ctrl+S", doc: true, symbol: "save", keywords: "save" });
    add("save-as", "另存为新 PDF", "文件", () => actions["save-as"]?.(), { shortcut: "Ctrl+Shift+S", doc: true, symbol: "save-as", keywords: "save as export copy" });
    add("save-project", "保存 .folio 工作工程", "文件", clickEl("#save-project, [data-action=save-project]"), { doc: true, symbol: "save", keywords: "project folio" });
    add("print", "打印 / 小册子 / 多页讲义", "文件", clickEl("#print-document"), { shortcut: "Ctrl+P", doc: true, symbol: "print", keywords: "print booklet nup" });
    add("find", "全文搜索", "阅读", () => actions.find?.(), { shortcut: "Ctrl+F", doc: true, symbol: "search", keywords: "find search text" });
    add("goto", "跳转到指定页", "阅读", () => actions.goto?.(), { shortcut: "Ctrl+Shift+N", doc: true, symbol: "page-target", keywords: "goto page jump" });
    add("toggle-thumbnails", "页面缩略图", "阅读", () => actions["toggle-thumbnails"]?.(), { shortcut: "Ctrl+T", symbol: "thumbs", keywords: "thumbnails sidebar pages preview" });
    add("toggle-bookmarks", "切换书签侧栏", "阅读", () => actions["toggle-bookmarks"]?.(), { shortcut: "Ctrl+B", symbol: "bookmark", keywords: "sidebar outline" });
    add("toggle-inspector", "切换属性侧栏", "阅读", () => actions["toggle-inspector"]?.(), { shortcut: "Ctrl+`", symbol: "sidebar-right", keywords: "inspector properties" });
    add("theme", "切换明暗外观", "视图", () => actions.theme?.(), { symbol: "sun", keywords: "dark light theme mode" });
    add("tone-default", "页面色调：原色纸张", "视图", () => actions["page-tone"]?.("default"), { symbol: "book", keywords: "tone white paper" });
    add("tone-warm", "页面色调：暖色护眼纸", "视图", () => actions["page-tone"]?.("warm"), { symbol: "book", keywords: "tone warm sepia eye care" });
    add("tone-dark", "页面色调：智能暗色反色", "视图", () => actions["page-tone"]?.("dark"), { symbol: "book", keywords: "tone dark night invert" });

    add("flow-edit", "页面文字与段落编辑", "编辑", () => actions["flow-edit"]?.(), { doc: true, symbol: "text", keywords: "edit text paragraph" });
    add("edit-image", "原位编辑图片（色阶 / 曲线 / 裁剪）", "编辑", () => actions["edit-image"]?.(), { doc: true, symbol: "image-edit", keywords: "image adjust crop curve" });
    add("edit-content", "编辑页面对象", "编辑", () => actions["edit-content"]?.(), { doc: true, symbol: "cursor", keywords: "objects select" });
    add("annotate", "添加页面批注", "编辑", () => actions.annotate?.(), { doc: true, symbol: "pen", keywords: "annotate highlight note ink" });
    add("table-structure", "表格结构与导出 CSV / XLSX", "编辑", () => actions["table-structure"]?.(), { doc: true, symbol: "table", keywords: "table excel csv" });
    add("font-tools", "字体工作台", "编辑", clickEl("#font-tools"), { symbol: "text-lines", keywords: "font glyph unicode" });
    add("ocr", "离线 OCR 识别与校对", "OCR", () => actions.ocr?.(), { doc: true, symbol: "scan", keywords: "ocr scan searchable" });
    add("ocr-preview", "切换 OCR 文字层预览", "OCR", () => actions["ocr-preview"]?.(), { doc: true, symbol: "text-lines", keywords: "ocr preview" });

    add("generate", "多级规则 · 自动生成书签", "书签", () => actions.generate?.(), { doc: true, symbol: "auto-bookmark", keywords: "auto bookmark regex rules" });
    add("smart-toc", "智能目录识别", "书签", () => actions["smart-toc"]?.(), { doc: true, symbol: "contents", keywords: "toc smart table of contents" });
    add("bookmark-qc", "书签统计与质量检查", "书签", clickEl("#bookmark-qc"), { doc: true, symbol: "bookmark-qc", keywords: "qc audit repair links" });
    add("bookmark-sort", "排序书签", "书签", clickEl("#bookmark-sort"), { doc: true, symbol: "bookmark-sort", keywords: "sort bookmarks" });
    add("bookmark-every", "每 N 页生成书签", "书签", clickEl("#bookmark-every"), { doc: true, symbol: "bookmark-interval", keywords: "every interval bookmark" });
    add("calibrate", "按标题校准书签目标", "书签", () => actions.calibrate?.(), { doc: true, symbol: "crosshair", keywords: "calibrate target" });
    add("calibrate-pages", "逐条校准目录页码", "书签", () => actions["calibrate-pages"]?.(), { doc: true, symbol: "page-target", keywords: "calibrate pages" });
    add("whitespace", "批量调整跳转留白", "书签", () => actions.whitespace?.(), { doc: true, symbol: "spacing", keywords: "whitespace margin offset" });
    add("batch", "书签批量规则（查找替换 / 样式）", "书签", () => actions.batch?.(), { doc: true, symbol: "rules", keywords: "batch replace" });
    add("exchange", "书签导入 / 导出（JSON / TXT / HTML）", "书签", () => actions.exchange?.(), { doc: true, symbol: "exchange", keywords: "import export json txt" });

    add("page-organizer", "组织页面（排序 / 旋转 / 插入 / 裁剪）", "组织", clickEl("#page-organizer"), { doc: true, symbol: "page-grid", keywords: "organize reorder rotate crop" });
    add("insert-blank-page", "插入空白页", "组织", clickEl("#insert-blank-page"), { doc: true, symbol: "new-page", keywords: "blank page" });
    add("document-assembly", "多格式合并 / 拆分 PDF", "组织", clickEl("#document-assembly"), { symbol: "merge-pages", keywords: "merge split combine" });
    add("export-word", "导出 Word (DOCX)", "导出", clickEl("#export-word"), { doc: true, symbol: "word", keywords: "word docx convert" });
    add("export-excel", "导出 Excel (XLSX)", "导出", clickEl("#export-excel"), { doc: true, symbol: "excel", keywords: "excel xlsx table" });
    add("document-utilities", "文档工具（压缩 / 加密 / PDF/A / 表单）", "工具", clickEl("#document-utilities"), { doc: true, symbol: "file", keywords: "compress encrypt pdfa pdfx form" });
    add("decrypt", "导出无密码副本", "工具", () => actions.decrypt?.(), { symbol: "unlock", keywords: "decrypt password unlock" });
    add("photo-studio", "图像创作工作室", "创作", clickEl("#photo-studio"), { symbol: "brush", keywords: "photo studio image layer" });
    add("vector-studio", "矢量创作工作室", "创作", clickEl("#vector-studio"), { symbol: "nodes", keywords: "vector svg studio" });
    add("ai", "打开 AI 助手 · Chatbox", "工具", clickEl(".folio-ai-open"), { symbol: "spark", keywords: "ai chatbox assistant" });
    add("settings", "偏好设置", "设置", () => actions.settings?.(), { shortcut: "Ctrl+K", symbol: "settings", keywords: "settings preferences" });
    add("shortcuts", "自定义快捷键", "设置", () => actions.shortcuts?.(), { symbol: "sliders", keywords: "shortcuts keybindings" });

    return items.filter((item) => !item.doc || !!S.pdf);
  }

  function openPalette() {
    if (dialog) { closePalette(); return; }
    if (document.querySelector("dialog[open]")) return;
    const all = collectCommands();
    dialog = document.createElement("dialog");
    dialog.className = "command-palette-dialog";
    dialog.setAttribute("aria-label", "命令面板");
    dialog.innerHTML = `<div class="cmd-search">${icon("search")}<input type="search" id="cmd-input" placeholder="输入命令名称、功能或关键词…" autocomplete="off" aria-label="搜索命令"><kbd>Esc</kbd></div><div class="cmd-list" role="listbox" aria-label="匹配命令"></div><div class="cmd-foot"><span>↑ ↓ 选择</span><span>Enter 执行</span><span>Ctrl+Shift+P 打开命令面板</span></div>`;
    document.body.append(dialog);
    dialog.showModal();

    const input = dialog.querySelector("#cmd-input");
    const listEl = dialog.querySelector(".cmd-list");
    let matches = all;
    let active = 0;

    function render() {
      const q = input.value.trim().toLowerCase();
      const terms = q ? q.split(/\s+/) : [];
      matches = !terms.length ? all : all.filter((item) => terms.every((term) => item.search.includes(term)));
      active = Math.max(0, Math.min(active, matches.length - 1));
      if (!matches.length) {
        listEl.innerHTML = `<p class="cmd-empty">没有找到匹配的命令</p>`;
        return;
      }
      const frag = document.createDocumentFragment();
      matches.forEach((item, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cmd-item";
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-selected", String(idx === active));
        btn.dataset.idx = idx;
        btn.innerHTML = `${icon(item.symbol)}<span class="cmd-label">${item.label}</span><span class="cmd-group">${item.group}</span>${item.shortcut ? `<kbd>${item.shortcut}</kbd>` : ""}`;
        btn.onmouseenter = () => {
          if (active !== idx) {
            listEl.children[active]?.setAttribute("aria-selected", "false");
            active = idx;
            btn.setAttribute("aria-selected", "true");
          }
        };
        btn.onclick = () => execute(idx);
        frag.append(btn);
      });
      listEl.replaceChildren(frag);
      listEl.children[active]?.scrollIntoView({ block: "nearest" });
    }

    function execute(idx) {
      const item = matches[idx];
      if (!item) return;
      closePalette();
      guarded(async () => {
        await item.run();
      });
    }

    input.oninput = () => { active = 0; render(); };
    dialog.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!matches.length) return;
        listEl.children[active]?.setAttribute("aria-selected", "false");
        active = (active + 1) % matches.length;
        listEl.children[active]?.setAttribute("aria-selected", "true");
        listEl.children[active]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!matches.length) return;
        listEl.children[active]?.setAttribute("aria-selected", "false");
        active = (active - 1 + matches.length) % matches.length;
        listEl.children[active]?.setAttribute("aria-selected", "true");
        listEl.children[active]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        execute(active);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePalette();
      }
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) closePalette();
    });
    dialog.oncancel = (e) => { e.preventDefault(); closePalette(); };

    render();
    input.focus();
  }

  function closePalette() {
    if (!dialog) return;
    const d = dialog;
    dialog = null;
    d.close();
    d.remove();
  }

  document.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      e.stopPropagation();
      openPalette();
    }
  });

  return { open: openPalette, close: closePalette };
}

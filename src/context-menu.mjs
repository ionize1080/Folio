// Shared right-click menu: icons, quiet keyboard hints, tones, arrow-key navigation, focus return.
// Rendered inside the open modal <dialog> when there is one, otherwise it would sit beneath the dialog.
import { icon } from "./icons.mjs";

// Icon / emphasis for context-menu rows, keyed by label. Unlisted rows stay text-only.
export const MENU_META = {
  "高亮选中文字": ["brush", "accent"], "下划线": ["text", ""], "删除线": ["case", ""], "复制标题": ["copy", ""],
  "上一页": ["chevron-left", ""], "下一页": ["chevron-right", ""], "转到页面…": ["page-target", ""], "旋转视图": ["rotate", ""],
  "确认并下一处": ["check", "accent"], "下一处待复核": ["target", ""], "不写入此条": ["close", ""], "恢复写入此条": ["undo", ""], "复制识别文字": ["copy", ""], "编辑校对文字": ["pen", ""],
  "复制批注文字": ["copy", ""], "删除批注": ["trash", "danger"],
  "转到此处": ["target", ""], "复制匹配文字": ["copy", ""], "复制所在片段": ["copy-line", ""], "复制全部结果": ["copy", ""], "从匹配创建书签": ["bookmark-plus", "accent"],
  "切换到此标签页": ["file", ""], "关闭标签页": ["close", ""], "关闭其他标签页": ["close", ""], "关闭右侧标签页": ["close", ""],
  "复制文件名": ["copy", ""], "复制文件路径": ["copy", ""], "打开": ["file", "accent"], "从最近记录移除": ["trash", "danger"],
  "粘贴": ["paste", ""],
  // Page organizer and thumbnail sidebar.
  "预览页面": ["eye", ""], "逆时针旋转": ["rotate-left", ""], "顺时针旋转": ["rotate", ""], "旋转 180°": ["rotate-half", ""],
  "在此页之前插入文件…": ["insert-page", ""], "在此页之后插入文件…": ["insert-page", ""], "在此处插入空白页…": ["new-page", ""],
  "替换为文件页面…": ["replace-page", ""], "复制所选页面": ["copy", ""], "提取所选页面…": ["extract-page", ""],
  "逆序排列所选页面": ["reverse", ""], "全选": ["check", ""], "反选": ["frame", ""], "删除所选页面": ["trash", "danger"],
  "撤销": ["undo", ""], "重做": ["redo", ""],
  "标记为范围起点": ["target", ""], "标记为范围终点": ["target", ""], "为该页新建书签": ["bookmark-plus", "accent"],
  "组织页面…": ["page-grid", ""], "页面操作…": ["sliders", ""],
  "编辑标题": ["pen", ""], "新增同级书签": ["bookmark-plus", "accent"], "新增子书签": ["bookmark-child", "accent"],
  "剪切": ["cut", ""], "复制": ["copy", ""], "粘贴为子书签": ["paste", ""], "粘贴到前面": ["paste", ""], "粘贴到后面": ["paste", ""],
  "更改书签缩放…": ["zoom", ""], "切换标题大小写…": ["case", ""], "设置当前视图为目标": ["target", "accent"],
  "展开所选子树": ["unfold", ""], "折叠所选子树": ["fold", ""],
  "删除所选与子项": ["trash", "danger"], "仅删除所选，保留子项": ["trash", "danger"], "仅删除子书签": ["trash", "danger"],
  "调整跳转留白…": ["spacing", ""], "按标题校准目标…": ["crosshair", ""], "查找重复书签…": ["dedupe", ""], "正则拆分书签…": ["split", ""],
  "属性": ["sliders", ""], "底层字典": ["code", ""],
  "复制 Ctrl+C": ["copy", ""], "复制为单行": ["copy-line", ""], "从选中文字创建书签": ["bookmark-plus", "accent"],
  "用选中文字位置设置目标": ["target", "accent"], "框选文字并复制…": ["select-text", ""], "当前视图设置为目标": ["target", "accent"],
  "适合宽度": ["fit-width", ""], "适合页面": ["fit-page", ""], "页面缩略图": ["thumbs", ""],
};
export function menuMeta(label) {
  // "名称 · F2" and "名称 Ctrl+C" carry their shortcut; show it as a quiet right-aligned hint.
  const m = /^(.*?)(?:\s·\s|\s)((?:Ctrl|Alt|Shift|Del|Space|F\d+)[\w+ ↑↓←→\[\]\-−,.;=/]*)$/.exec(label);
  const text = m ? m[1].trim() : label, kbd = m ? m[2].trim() : "";
  const [name, tone] = MENU_META[text] || MENU_META[label] || (/^转到第 d+ 页$/.test(text) ? ["fit-page", ""] : []);
  return { text, kbd, icon: name || "", tone: tone || "" };
}
export function showContextMenu(e, items, { guard = fn => fn(), parent } = {}) {
  e.preventDefault();
  document.getElementById("context-menu")?.dispatchEvent(new Event("dismiss"));
  const box = document.createElement("div");
  box.id = "context-menu";
  box.role = "menu";
  const previousFocus = document.activeElement;
  const listeners = new AbortController();
  const dismiss = () => {
    listeners.abort();
    box.remove();
    previousFocus?.focus?.({ preventScroll: true });
  };
  box.addEventListener("dismiss", dismiss, { signal: listeners.signal });
  box.onkeydown = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
      return;
    }
    if (e.key === "Tab") {
      dismiss();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const buttons = [...box.querySelectorAll("button:not(:disabled)")],
      at = buttons.indexOf(document.activeElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? buttons.length - 1
          : (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next]?.focus();
  };
  for (const item of items) {
    if (!item) {
      const separator = document.createElement("div");
      separator.role = "separator";
      box.append(separator);
      continue;
    }
    const [label, fn, disabled = false] = item;
    const b = document.createElement("button");
    const meta = menuMeta(label);
    b.innerHTML = (meta.icon ? icon(meta.icon) : '<i class="mi-blank"></i>') + '<span class="mi-label"></span>' + (meta.kbd ? '<kbd></kbd>' : "");
    b.querySelector(".mi-label").textContent = meta.text;
    if (meta.kbd) b.querySelector("kbd").textContent = meta.kbd;
    if (meta.tone) b.dataset.tone = meta.tone;
    b.setAttribute("aria-label", label);
    b.role = "menuitem";
    b.disabled = disabled;
    b.onclick = () => {
      dismiss();
      guard(fn);
    };
    box.append(b);
  }
  (parent || [...document.querySelectorAll("dialog[open]")].at(-1) || document.body).append(box);
  box.querySelector("button:not(:disabled)")?.focus();
  box.style.left =
    Math.max(8, Math.min(e.clientX, innerWidth - box.offsetWidth - 8)) + "px";
  box.style.top =
    Math.max(8, Math.min(e.clientY, innerHeight - box.offsetHeight - 8)) + "px";
  setTimeout(
    () =>
      document.addEventListener(
        "pointerdown",
        (ev) => {
          if (!box.contains(ev.target)) dismiss();
        },
        { signal: listeners.signal },
      ),
    0,
  );
}
// Electron has no native edit menu; give text fields and editable areas cut / copy / paste / select all.
export function installTextContextMenu({ guard } = {}) {
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    const field = e.target.closest?.("input, textarea, [contenteditable=''], [contenteditable='true']");
    if (!field) return;
    if (field.matches("input")) {
      const t = field.type;
      if (["checkbox", "radio", "range", "button", "submit", "color", "file"].includes(t)) return;
    }
    const text = field.matches("input, textarea");
    const selected = text ? field.selectionStart !== field.selectionEnd : !!getSelection()?.toString();
    const editable = !field.readOnly && !field.disabled;
    const run = (cmd) => () => { field.focus(); document.execCommand(cmd); };
    showContextMenu(e, [
      ["剪切 Ctrl+X", run("cut"), !selected || !editable],
      ["复制 Ctrl+C", run("copy"), !selected],
      ["粘贴 Ctrl+V", run("paste"), !editable],
      null,
      ["全选 Ctrl+A", run("selectAll")],
    ], { guard });
  });
}

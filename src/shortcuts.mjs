export const bindings = [
  ["open", "打开", "Ctrl+O", "global"],
  ["save", "保存", "Ctrl+S", "global"],
  ["save-as", "另存为", "Ctrl+Shift+S", "global"],
  ["settings", "偏好", "Ctrl+K", "global"],
  ["undo", "撤销", "Ctrl+Z", "global"],
  ["redo", "重做", "Ctrl+Y", "global"],
  ["toggle-bookmarks", "书签面板", "Ctrl+B", "global"],
  ["add-selection", "从选中文字 / 当前视图新建书签", "Ctrl+Shift+B", "global"],
  ["find", "搜索", "Ctrl+F", "global"],
  ["find-next", "下个搜索结果", "F3", "global"],
  ["find-prev", "上个搜索结果", "Shift+F3", "global"],
  ["fullscreen", "全屏", "F11", "global"],
  ["prev", "上一页", "Ctrl+ArrowLeft", "document"],
  ["next", "下一页", "Ctrl+ArrowRight", "document"],
  ["first", "第一页", "Home", "document"],
  ["last", "最后一页", "End", "document"],
  ["goto", "转到页", "Ctrl+Shift+N", "global"],
  ["back", "上一视图", "Alt+ArrowLeft", "document"],
  ["forward", "下一视图", "Alt+ArrowRight", "document"],
  ["fit", "适合页面", "Ctrl+0", "global"],
  ["actual", "实际大小", "Ctrl+1", "global"],
  ["width", "适合宽度", "Ctrl+2", "global"],
  ["zoom-in", "放大", "Ctrl++", "global"],
  ["zoom-out", "缩小", "Ctrl+-", "global"],
  ["screen-next", "下一屏", "PageDown", "document"],
  ["screen-prev", "上一屏", "PageUp", "document"],
  ["rename", "重命名", "F2", "tree"],
  ["delete", "删除子树", "Delete", "tree"],
  ["add", "在后面新增", "Insert", "tree"],
  ["add-before", "在前面新增", "Alt+Insert", "tree"],
  ["add-first-child", "新增首个子书签", "Ctrl+Alt+Insert", "tree"],
  ["indent", "降级", "Alt+ArrowRight", "tree"],
  ["outdent", "升级", "Alt+ArrowLeft", "tree"],
  ["move-up", "上移", "Alt+ArrowUp", "tree"],
  ["move-down", "下移", "Alt+ArrowDown", "tree"],
  ["copy-tree", "复制书签", "Ctrl+C", "tree"],
  ["cut-tree", "剪切书签", "Ctrl+X", "tree"],
  ["paste-tree", "粘贴书签", "Ctrl+V", "tree"],
  ["select-all", "全选书签", "Ctrl+A", "tree"],
  ["toggle-thumbnails", "缩略图", "Ctrl+T", "global"],
  ["toggle-inspector", "属性面板", "Ctrl+`", "global"],
  ["apply-properties", "应用属性", "Ctrl+Enter", "global"],
];
export function keyChord(e) {
  let k = e.key;
  if (e.code === "NumpadAdd" || k === "=") k = "+";
  if (e.code === "NumpadSubtract") k = "-";
  if (k.length === 1) k = k.toUpperCase();
  return [
    e.ctrlKey || e.metaKey ? "Ctrl" : "",
    e.altKey ? "Alt" : "",
    e.shiftKey && k !== "+" ? "Shift" : "",
    k,
  ]
    .filter(Boolean)
    .join("+");
}
export function conflicts(config) {
  const rows = bindings.map((b) => ({ ...b, key: config[b[0]] ?? b[2] })),
    out = [];
  for (let i = 0; i < rows.length; i++)
    for (let j = 0; j < i; j++) {
      const a = rows[i],
        b = rows[j];
      if (
        a.key &&
        a.key === b.key &&
        (a[3] === b[3] || a[3] === "global" || b[3] === "global")
      )
        out.push(a[1] + " / " + b[1] + ": " + a.key);
    }
  return out;
}
export function installShortcuts({
  settings,
  actions,
  surface,
  S,
  guarded,
  treeNavigate,
  isModal,
}) {
  document.addEventListener("keydown", (e) => {
    const editable = e.target.closest(
      "input,textarea,select,[contenteditable=true]",
    );
    if (e.key === "Escape") {
      if (isModal()) return;
      if (document.fullscreenElement || S.fullscreen) {
        e.preventDefault();
        guarded(actions.fullscreen);
      }
      surface.space = false;
      surface.host.classList.remove("hand-mode");
      actions["stop-draw"]?.();
      return;
    }
    if (isModal() || S.busy) return;
    const chord = keyChord(e),
      context = e.target.closest("#tree")
        ? "tree"
        : e.target.closest("#canvas-host")
          ? "document"
          : "global";
    if (!editable && chord === "Ctrl+C" && surface.selection()) {
      e.preventDefault();
      guarded(() => actions["copy-page"]());
      return;
    }
    // Native editing always wins, except explicit file/find/properties commands.
    const allowedInput = new Set([
      "open",
      "save",
      "save-as",
      "find",
      "find-next",
      "find-prev",
      "goto",
      "settings",
      "apply-properties",
    ]);
    let b = bindings.find(
      (b) =>
        (b[3] === "global" || b[3] === context) &&
        (settings.shortcuts[b[0]] ?? b[2]) === chord,
    );
    if (!b) {
      const aliases = {
        "Ctrl+PageUp": "prev",
        "Ctrl+PageDown": "next",
        "Ctrl+L": "fullscreen",
        "Ctrl+Shift+Z": "redo",
      };
      const a = aliases[chord];
      if (a && (context === "document" || ["fullscreen", "redo"].includes(a)))
        b = [a];
    }
    if (b && (!editable || allowedInput.has(b[0]))) {
      if (S.pdf || ["open", "settings", "fullscreen"].includes(b[0])) {
        e.preventDefault();
        guarded(actions[b[0]]);
      }
      return;
    }
    if (editable || e.ctrlKey || e.altKey || e.metaKey) return;
    if (
      context === "tree" &&
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Enter",
        " ",
      ].includes(e.key)
    ) {
      e.preventDefault();
      treeNavigate(e);
    } else if (context === "document" && e.code === "Space") {
      e.preventDefault();
      surface.space = true;
      surface.host.classList.add("hand-mode");
    } else if (
      context === "document" &&
      ["ArrowUp", "ArrowDown"].includes(e.key)
    ) {
      e.preventDefault();
      surface.host.scrollTop += e.key === "ArrowDown" ? 48 : -48;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      surface.space = false;
      surface.drag = null;
      surface.host.classList.remove("hand-mode");
    }
  });
  window.addEventListener("blur", () => {
    surface.space = false;
    surface.drag = null;
    surface.host.classList.remove("hand-mode");
  });
}
export function shortcutDialog({
  settings,
  modal,
  closeModal,
  esc,
  choose,
  writeFile,
  applySettings,
}) {
  let config = { ...settings.shortcuts };
  const render = () => {
    modal(
      "快捷键 · 焦点优先",
      `<p>点击输入框后按下快捷键；Backspace 清除。输入文本时保留原生编辑操作，Tab 始终移动焦点。</p><div class="shortcut-list">${bindings.map(([id, label, key, scope]) => `<label>${esc(label)} <small>${scope === "tree" ? "书签树" : scope === "document" ? "阅读区" : "通用"}</small><input data-key="${id}" readonly value="${esc(config[id] ?? key)}"></label>`).join("")}</div><p id="key-conflicts" class="callout"></p>`,
      [
        {
          text: "恢复默认",
          run: () => {
            config = {};
            render();
          },
        },
        {
          text: "导入",
          run: async () => {
            const f = await choose("json");
            if (f) {
              const v = JSON.parse(new TextDecoder().decode(f.bytes));
              if (
                v.format !== "folio-shortcuts/1" ||
                typeof v.bindings !== "object"
              )
                throw Error("快捷键配置格式错误");
              config = v.bindings;
              render();
            }
          },
        },
        {
          text: "导出",
          run: () =>
            writeFile(
              "Folio-shortcuts.json",
              new TextEncoder().encode(
                JSON.stringify(
                  { format: "folio-shortcuts/1", bindings: config },
                  null,
                  2,
                ),
              ),
              "json",
            ),
        },
        {
          text: "应用",
          primary: true,
          run: () => {
            const c = conflicts(config);
            if (c.length) throw Error("请先解决快捷键冲突");
            settings.shortcuts = config;
            applySettings(false);
            closeModal();
          },
        },
      ],
    );
    const update = () =>
      (document.querySelector("#key-conflicts").textContent =
        conflicts(config).join("；") ||
        "无冲突。相同按键可分别用于书签树与阅读区。");
    for (const input of document.querySelectorAll("[data-key]"))
      input.onkeydown = (e) => {
        if (["Tab", "Escape"].includes(e.key)) return;
        e.preventDefault();
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
        config[input.dataset.key] = e.key === "Backspace" ? "" : keyChord(e);
        input.value = config[input.dataset.key];
        update();
      };
    update();
  };
  render();
}

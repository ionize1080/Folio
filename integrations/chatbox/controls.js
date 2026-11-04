(() => {
  let mode = "sidebar",
    auto = false;
  const svg = (body) =>
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    body +
    "</svg>";
  const dock = document.createElement("button"),
    approval = document.createElement("button");
  dock.innerHTML = svg(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  );
  approval.innerHTML = svg(
    '<path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7Z"/><path d="m8 12 3 3 5-6"/>',
  );
  for (const b of [dock, approval]) {
    b.className = "folio-control";
    b.type = "button";
    b.style.cssText =
      "width:28px;height:28px;min-width:28px;padding:5px;border:0;border-radius:6px;background:transparent;color:var(--mantine-color-text);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;";
    b.onmouseenter = () =>
      (b.style.background = "var(--mantine-color-default-hover)");
    b.onmouseleave = () => (b.style.background = "transparent");
  }
  const style = document.createElement("style");
  style.textContent = '.folio-control:focus-visible{outline:2px solid var(--mantine-primary-color-filled);outline-offset:2px}';
  document.head.append(style);
  function update() {
    dock.title = mode === "sidebar" ? "切换为独立窗口" : "切换为Folio侧栏";
    approval.title = auto ? "自动审批（点击切回手动）" : "手动审批（点击切换）";
    approval.style.color = auto ? "#e03131" : "var(--mantine-color-text)";
    approval.setAttribute("aria-pressed", String(auto));
    dock.setAttribute("aria-label", dock.title);
    approval.setAttribute("aria-label", approval.title);
  }
  dock.onclick = () =>
    window.folioControls.display(mode === "sidebar" ? "window" : "sidebar");
  approval.onclick = () =>
    window.folioControls.approval().catch((e) => alert(e.message));
  window.folioControls.subscribe((state) => {
    if (state.mode) mode = state.mode;
    if (typeof state.auto === "boolean") auto = state.auto;
    update();
  });
  function attach() {
    const slot = document.getElementById("folio-toolbar-slot");
    if (slot && !slot.contains(dock)) {
      slot.style.cssText =
        "display:inline-flex;align-items:center;gap:4px;vertical-align:middle;";
      slot.append(dock, approval);
      update();
    }
  }
  new MutationObserver(attach).observe(document.body, {
    childList: true,
    subtree: true,
  });
  attach();
})();

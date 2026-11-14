// Turns a short <select> into a segmented control / chip grid without changing the select.
//
// The <select> stays in the DOM (hidden) and remains the single source of truth, so every
// existing handler, value read and `change` listener keeps working. Programmatic
// `select.value = …` and option list rebuilds are mirrored back into the control.

const REGISTRY = [
  // [selector, variant]
  ["#cal-scope, #space-scope, #batch-scope", "seg"],
  ["#st-filter, #qc-filter", "chips"],
  ["#batch-op", "cards"],
];

function build(select, variant) {
  const group = document.createElement("div");
  group.className = "choice choice-" + variant;
  group.setAttribute("role", "radiogroup");
  const label = select.closest("label");
  const name = label?.firstChild?.textContent?.trim() || select.getAttribute("aria-label") || "";
  if (name) group.setAttribute("aria-label", name);
  select.classList.add("choice-source");
  select.after(group);
  // The wrapper <label> would otherwise forward clicks to the hidden select.
  if (label) label.classList.add("has-choice");

  const sync = () => {
    for (const b of group.children) {
      const on = b.dataset.value === select.value;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  const render = () => {
    group.replaceChildren(...[...select.options].map(o => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.value = o.value;
      b.disabled = o.disabled;
      b.textContent = o.textContent;
      b.translate = false;
      return b;
    }));
    sync();
  };
  group.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b || b.disabled || select.value === b.dataset.value) return;
    select.value = b.dataset.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    sync();
  });
  group.addEventListener("keydown", e => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const list = [...group.children].filter(b => !b.disabled), at = list.findIndex(b => b.getAttribute("aria-checked") === "true");
    const next = list[(at + keys[e.key] + list.length) % list.length];
    next?.click();
    next?.focus();
  });
  // Mirror programmatic value writes and option changes.
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  Object.defineProperty(select, "value", {
    configurable: true,
    get() { return proto.get.call(this); },
    set(v) { proto.set.call(this, v); sync(); },
  });
  new MutationObserver(render).observe(select, { childList: true, characterData: true, subtree: true });
  select.addEventListener("change", sync);
  render();
}

export function enhanceChoices(root) {
  for (const [selector, variant] of REGISTRY)
    for (const select of root.querySelectorAll(selector))
      if (select instanceof HTMLSelectElement && !select.classList.contains("choice-source")) build(select, variant);
}

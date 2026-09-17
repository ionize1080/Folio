export const toPoints = (n, u) => Number(n) * (u === "mm" ? 72 / 25.4 : 1);
export const fromPoints = (n, u) => Number(n) / (u === "mm" ? 72 / 25.4 : 1);
export function preferredUnit() {
  try {
    return JSON.parse(localStorage.getItem("folio-settings") || "{}")
      .whitespaceUnit === "pt"
      ? "pt"
      : "mm";
  } catch {
    return "mm";
  }
}
export function bindUnit(
  select,
  inputs,
  initial = "pt",
  desired = preferredUnit(),
) {
  let current = initial;
  const exact = new WeakMap();
  const fields = () => (typeof inputs === "function" ? inputs() : inputs);
  const remember = (el) => {
    const prev = exact.get(el);
    if (!prev || prev.display !== el.value)
      exact.set(el, { pt: toPoints(el.value, current), display: el.value });
  };
  const change = () => {
    const next = select.value;
    for (const el of fields()) {
      if (el.value === "") continue;
      remember(el);
      const val = exact.get(el);
      el.value = String(Number(fromPoints(val.pt, next).toFixed(6)));
      val.display = el.value;
      el.step = next === "mm" ? "0.1" : "0.5";
    }
    current = next;
    select.dispatchEvent(new Event("input", { bubbles: true }));
  };
  select.value = desired;
  change();
  select.addEventListener("change", change, { capture: true });
  return {
    sync(unit) {
      current = unit;
      select.value = unit;
      for (const el of fields()) exact.delete(el);
    },
    convert: change,
  };
}

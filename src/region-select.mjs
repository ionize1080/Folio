// One-shot rectangle selection in an independently scrolling preview container.
export function selectRegion(canvas, onSelect) {
  const host = canvas.parentElement,
    overlay = document.createElement("div");
  overlay.className = "region-marquee";
  host.append(overlay);
  host.style.cursor = "crosshair";
  let start, pointer;
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(r.width, e.clientX - r.left)),
      Math.max(0, Math.min(r.height, e.clientY - r.top)),
    ];
  };
  const draw = (q) => {
    const c = canvas.getBoundingClientRect(),
      h = host.getBoundingClientRect();
    overlay.style.cssText = `left:${Math.min(start[0], q[0]) + c.left - h.left + host.scrollLeft - host.clientLeft}px;top:${Math.min(start[1], q[1]) + c.top - h.top + host.scrollTop - host.clientTop}px;width:${Math.abs(q[0] - start[0])}px;height:${Math.abs(q[1] - start[1])}px`;
  };
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    pointer = e.pointerId;
    start = point(e);
    host.setPointerCapture(pointer);
    draw(start);
  };
  const move = (e) => {
    if (!start) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    draw(point(e));
  };
  const up = (e) => {
    if (!start) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const q = point(e),
      r = [
        Math.min(start[0], q[0]),
        Math.min(start[1], q[1]),
        Math.max(start[0], q[0]),
        Math.max(start[1], q[1]),
      ];
    dispose();
    if (r[2] - r[0] >= 3 && r[3] - r[1] >= 3) onSelect(r);
  };
  const key = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      dispose();
    }
  };
  const dispose = () => {
    if (pointer !== undefined && host.hasPointerCapture(pointer))
      host.releasePointerCapture(pointer);
    host.removeEventListener("pointerdown", down, true);
    host.removeEventListener("pointermove", move, true);
    host.removeEventListener("pointerup", up, true);
    host.removeEventListener("pointercancel", dispose, true);
    document.removeEventListener("keydown", key, true);
    host.style.cursor = "";
    overlay.remove();
  };
  host.addEventListener("pointerdown", down, true);
  host.addEventListener("pointermove", move, true);
  host.addEventListener("pointerup", up, true);
  host.addEventListener("pointercancel", dispose, true);
  document.addEventListener("keydown", key, true);
  return dispose;
}

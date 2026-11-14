// Live thumbnail of a bookmark's destination page with the landing point marked.
//
// Read-only: it never writes to the form. It re-renders (debounced, latest wins) whenever the
// page / mode / coordinate inputs change, so you see where a jump will land before applying.

const W = 232; // CSS px; rendered at devicePixelRatio

// Which PDF-space point(s) a destination mode targets. null = unspecified (inherits viewer state).
export function markerFor(mode, args = []) {
  const n = i => (Number.isFinite(args[i]) ? args[i] : null);
  switch (mode) {
    case "XYZ": return { kind: "point", x: n(0), y: n(1) };
    case "FitH": case "FitBH": return { kind: "line", y: n(0) };
    case "FitV": case "FitBV": return { kind: "vline", x: n(0) };
    case "FitR": return { kind: "rect", l: n(0), b: n(1), r: n(2), t: n(3) };
    default: return { kind: "none" };
  }
}

export function installTargetThumb({ S, host, read }) {
  const fig = document.createElement("figure");
  fig.className = "target-thumb";
  fig.hidden = true;
  fig.innerHTML = '<div class="tt-frame"><canvas aria-hidden="true"></canvas><i class="tt-mark" hidden></i><span class="tt-empty" hidden></span></div><figcaption></figcaption>';
  host.append(fig);
  const canvas = fig.querySelector("canvas"), mark = fig.querySelector(".tt-mark"), empty = fig.querySelector(".tt-empty"), cap = fig.querySelector("figcaption");
  let token = 0, timer = 0, task = null, rendered = null;

  async function draw(t) {
    const { page: pageNumber, mode, args, note } = read();
    if (!S.pdf || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > S.info.pageCount) {
      canvas.hidden = true; mark.hidden = true; empty.hidden = false;
      empty.textContent = "无有效目标页";
      cap.textContent = note || "";
      return;
    }
    const pdf = S.pdf;
    let view = rendered?.view;
    if (rendered?.pdf !== pdf || rendered?.pageNumber !== pageNumber) {
      const page = await pdf.getPage(pageNumber);
      if (t !== token) return;
      const base = page.getViewport({ scale: 1 });
      const scale = W / base.width;
      view = page.getViewport({ scale });
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const off = document.createElement("canvas");
      off.width = Math.ceil(view.width * ratio); off.height = Math.ceil(view.height * ratio);
      task?.cancel?.();
      task = page.render({ canvasContext: off.getContext("2d"), viewport: view, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null, background: "#ffffff" });
      try { await task.promise; } catch (e) { if (e?.name === "RenderingCancelledException") return; throw e; }
      if (t !== token) return;
      canvas.width = off.width; canvas.height = off.height;
      canvas.style.width = view.width + "px"; canvas.style.height = view.height + "px";
      canvas.getContext("2d").drawImage(off, 0, 0);
      rendered = { pdf, pageNumber, view };
    }
    canvas.hidden = false; empty.hidden = true;

    const m = markerFor(mode, args), px = (x, y) => view.convertToViewportPoint(x ?? 0, y ?? 0);
    mark.hidden = m.kind === "none";
    mark.dataset.kind = m.kind;
    mark.style.cssText = "";
    if (m.kind === "point") {
      const [x, y] = px(m.x, m.y);
      mark.style.cssText = `left:${m.x == null ? 0 : x}px;top:${m.y == null ? 0 : y}px`;
      mark.dataset.loose = String(m.x == null || m.y == null);
    } else if (m.kind === "line") {
      mark.style.cssText = `top:${m.y == null ? 0 : px(0, m.y)[1]}px`;
    } else if (m.kind === "vline") {
      mark.style.cssText = `left:${m.x == null ? 0 : px(m.x, 0)[0]}px`;
    } else if (m.kind === "rect" && [m.l, m.b, m.r, m.t].every(Number.isFinite)) {
      const [x1, y1] = px(m.l, m.t), [x2, y2] = px(m.r, m.b);
      mark.style.cssText = `left:${Math.min(x1, x2)}px;top:${Math.min(y1, y2)}px;width:${Math.abs(x2 - x1)}px;height:${Math.abs(y2 - y1)}px`;
    } else mark.hidden = true;
    cap.textContent = `第 ${pageNumber} 页 · ${{ point: "定位点", line: "顶端对齐线", vline: "左侧对齐线", rect: "适合区域", none: "整页显示" }[m.kind]}${m.kind === "point" && mark.dataset.loose === "true" ? "（部分为 null）" : ""}`;
  }

  return {
    // Call whenever inputs change; cheap to call repeatedly.
    refresh(immediate = false) {
      if (fig.hidden) return;
      const t = ++token;
      clearTimeout(timer);
      const run = () => draw(t).catch(() => { if (t === token) { empty.hidden = false; empty.textContent = "无法生成预览"; canvas.hidden = true; mark.hidden = true; } });
      if (immediate) run(); else timer = setTimeout(run, 140);
    },
    show(visible) { fig.hidden = !visible; if (!visible) { token++; clearTimeout(timer); task?.cancel?.(); rendered = null; canvas.width = canvas.height = 0; } },
    destroy() { token++; clearTimeout(timer); task?.cancel?.(); rendered = null; fig.remove(); },
  };
}

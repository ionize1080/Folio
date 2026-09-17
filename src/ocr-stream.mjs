// A bounded continuous page surface. The active editor is moved, never cloned.
export function createOCRStream({
  host,
  canvas,
  boxes,
  pdf,
  rotation,
  getBlocks,
  onPage,
  isLocked,
  toast,
}) {
  let pages = [],
    active = 0,
    enabled = true,
    closed = false,
    pinned = false,
    busy = false,
    timer,
    epoch = 0;
  const shells = new Map(),
    jobs = new Map();
  const original = document.createElement("div");
  original.className = "ocr-stream-original";
  host.replaceChildren(original);
  original.append(canvas, boxes);
  async function paint(n) {
    const shell = shells.get(n);
    if (!shell || n === active || jobs.has(n) || shell.dataset.ready) return;
    const token = epoch,
      c = document.createElement("canvas");
    shell.append(c);
    const job = { cancel: () => {} };
    jobs.set(n, job);
    try {
      const p = await pdf.getPage(n);
      if (closed || token !== epoch || n === active) return;
      const b = p.getViewport({ scale: 1, rotation: rotation(n) }),
        v = p.getViewport({
          scale: Math.min(
            680 / b.width,
            Math.max(100, host.clientWidth - 34) / b.width,
            1.2,
          ),
          rotation: rotation(n),
        }),
        ratio = Math.min(devicePixelRatio || 1, 2);
      c.width = Math.ceil(v.width * ratio);
      c.height = Math.ceil(v.height * ratio);
      c.style.width = v.width + "px";
      c.style.height = v.height + "px";
      const task = p.render({
        canvasContext: c.getContext("2d"),
        viewport: v,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      job.cancel = () => task.cancel();
      await task.promise;
      if (closed || token !== epoch || n === active) return;
      shell.dataset.ready = "1";
      shell.style.minHeight = v.height + 28 + "px";
      const blocks = await getBlocks(n);
      if (closed || token !== epoch || n === active) return;
      const layer = document.createElement("div");
      layer.className = "ocr-passive-boxes";
      blocks.forEach((b, i) => {
        const q = b.quad.map((p) => v.convertToViewportPoint(...p)),
          xs = q.map((p) => p[0]),
          ys = q.map((p) => p[1]);
        const hit = document.createElement("button");
        hit.className = "ocr-hit" + (b.confidence < 0.85 ? " ocr-low-hit" : "");
        hit.style.cssText = `left:${Math.min(...xs)}px;top:${Math.min(...ys)}px;width:${Math.max(...xs) - Math.min(...xs)}px;height:${Math.max(...ys) - Math.min(...ys)}px`;
        hit.title = b.text;
        hit.onclick = (e) => {
          e.stopPropagation();
          change(n, i, true);
        };
        layer.append(hit);
      });
      shell.append(layer);
    } catch (e) {
      if (e.name !== "RenderingCancelledException")
        shell.dataset.error = e.message;
    } finally {
      jobs.delete(n);
      if (n === active || closed) c.remove();
    }
  }
  function scan() {
    if (closed || !enabled) return;
    const bounds = host.getBoundingClientRect(),
      visible = [];
    for (const [n, s] of shells) {
      const r = s.getBoundingClientRect();
      if (r.bottom > bounds.top - 500 && r.top < bounds.bottom + 500)
        visible.push(n);
      else if (n !== active && !jobs.has(n)) {
        s.querySelectorAll("canvas,.ocr-passive-boxes").forEach((c) => {
          if (c.tagName === "CANVAS") c.width = c.height = 0;
          c.remove();
        });
        delete s.dataset.ready;
      }
    }
    visible.slice(0, 5).forEach(paint);
    const center = bounds.top + Math.min(bounds.height * 0.35, 220);
    const n = pages.find((n) => {
      const r = shells.get(n).getBoundingClientRect();
      return r.top <= center && r.bottom > center;
    });
    if (active && n && n !== active && !busy && !pinned && !isLocked())
      change(n, null, false);
  }
  async function change(n, index, reveal) {
    if (busy) return;
    if (isLocked() && !reveal) return;
    if (reveal) pinned = true;
    busy = true;
    try {
      await onPage(n, index, reveal);
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
    }
  }
  function move(n, reveal = false) {
    if (!shells.has(n)) {
      if (n > 0) setPages([...pages, n]);
      else return;
    }
    const old = shells.get(active);
    if (old && active !== n) {
      old.style.minHeight = old.getBoundingClientRect().height + "px";
      delete old.dataset.ready;
    }
    active = n;
    const s = shells.get(n);
    if (!s) return;
    jobs.get(n)?.cancel();
    s.querySelectorAll("canvas,.ocr-passive-boxes").forEach((c) => {
      if (c !== canvas) c.remove();
    });
    s.append(original);
    s.dataset.ready = "1";
    for (const [p, el] of shells) el.classList.toggle("active", p === n);
    if (reveal) s.scrollIntoView({ block: "start" });
  }
  function setPages(list) {
    list = [...new Set(list)].sort((a, b) => a - b);
    if (list.join(",") === pages.join(",")) return;
    pages = list;
    epoch++;
    for (const j of jobs.values()) j.cancel();
    jobs.clear();
    original.remove();
    host.replaceChildren();
    shells.clear();
    pages.forEach((n, i) => {
      const s = document.createElement("section");
      s.className = "ocr-stream-page";
      s.dataset.page = n;
      s.style.minHeight =
        Math.min(680, Math.max(100, host.clientWidth - 34)) * 1.414 + 28 + "px";
      const label = document.createElement("div");
      label.className = "ocr-stream-label";
      label.textContent = `第 ${n} 页${i && n > pages[i - 1] + 1 ? " · 中间页面不在当前范围" : ""}`;
      s.append(label);
      s.onclick = (e) => {
        if (n === active || e.target.closest("button,input,textarea,select")) return;
        change(n, null, true);
      };
      host.append(s);
      shells.set(n, s);
    });
    move(active);
    setMode(enabled);
    scan();
  }
  function setMode(value) {
    enabled = value;
    host.classList.toggle("ocr-continuous", enabled);
    for (const [n, s] of shells) s.hidden = !enabled && n !== active;
    scan();
  }
  function scroll() {
    clearTimeout(timer);
    timer = setTimeout(scan, 120);
  }
  host.addEventListener("scroll", scroll, { passive: true });
  const unpin = () => { pinned = false; };
  const scrollPointer = (e) => { if (e.target === host) unpin(); };
  host.addEventListener("wheel", unpin, { passive: true });
  host.addEventListener("touchstart", unpin, { passive: true });
  host.addEventListener("pointerdown", scrollPointer);
  return {
    pin() { pinned = true; },
    setPages,
    setMode,
    resize() {
      const s = shells.get(active);
      if (s)
        s.style.minHeight = canvas.getBoundingClientRect().height + 28 + "px";
    },
    move(n, reveal) {
      move(n, reveal);
      for (const [p, s] of shells) s.hidden = !enabled && p !== active;
      scroll();
    },
    refresh() {
      for (const [n, s] of shells)
        if (n !== active) {
          delete s.dataset.ready;
          s.querySelectorAll("canvas,.ocr-passive-boxes").forEach((c) =>
            c.remove(),
          );
        }
      scroll();
    },
    destroy() {
      closed = true;
      epoch++;
      clearTimeout(timer);
      host.removeEventListener("scroll", scroll);
      host.removeEventListener("wheel", unpin);
      host.removeEventListener("touchstart", unpin);
      host.removeEventListener("pointerdown", scrollPointer);
      for (const j of jobs.values()) j.cancel();
    },
  };
}

import { nativeRequest } from "./native-source.mjs";
import {
  rectangle,
  matchesRect,
  transformedBounds,
  makeObjectEdit,
} from "./object-selection-model.mjs";
export function installObjectSelection({
  S,
  surface,
  guarded,
  toast,
  commit,
  refreshNative,
  clone,
  editImages,
}) {
  let active = null,
    opening = 0;
  const buttons = () => document.querySelectorAll("[data-select-mode]");
  function mark(mode) {
    buttons().forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.selectMode === mode)),
    );
  }
  async function start(mode = "all") {
    const rev = ++opening;
    await S.flowEdit?.finish(true);
    await S.imageEdit?.finish(true);
    if (rev !== opening) return;
    active?.destroy();
    surface.hand = mode === "hand";
    surface.host.classList.toggle("hand-mode", surface.hand);
    mark(mode);
    if (mode === "hand" || mode === "read" || !S.pdf) return;
    const source = S.bytes,
      selected = new Set();
    let page = S.page,
      objects = [],
      loading = false,
      closed = false,
      applying = false,
      gesture = null;
    const panel = document.createElement("aside");
    panel.className = "object-selection-panel";
    panel.innerHTML = `<header><strong>选择与批量编辑</strong><button data-done>完成</button></header><div class="selection-scroll"><p class="hint">拖动框选；Ctrl 点击切换；Shift 添加；Alt 拖动强制框选。拖动已选对象移动，Shift 锁定轴向。</p><label>框选规则<select data-match><option value="contain">完全包含</option><option value="intersect">相交即选</option></select></label><div class="adjust-tools"><button data-all>全选当前页</button><button data-clear>取消选择</button></div><p data-count role="status"></p><fieldset data-batch disabled><h3>位置</h3><div class="form-grid"><label>水平位移（pt）<input data-dx type="number" value="0" step="1"></label><label>垂直位移（pt，向下为正）<input data-dy type="number" value="0" step="1"></label></div><button data-move>移动所选对象</button><div data-text-fields><h3>文字属性</h3><p class="hint">仅修改勾选的属性；保留原有字体和字符间距比例。</p><label class="check"><input data-size-enable type="checkbox">字号（pt）</label><input data-size type="number" min="1" max="1000" value="12"><label class="check"><input data-color-enable type="checkbox">文字颜色</label><input data-color type="color" value="#000000"><button data-text>应用文字属性</button></div><button data-images>调整所选图片…</button><button data-delete>删除所选对象</button></fieldset><p data-reasons class="hint"></p></div><footer class="task-status" role="status"><progress hidden></progress><span data-progress>请框选当前页的文字或图片</span></footer>`;
    document.body.append(panel);
    document.body.classList.add("object-select-mode");
    const layer = document.createElement("div");
    layer.className = "object-selection-layer";
    layer.tabIndex = 0;
    layer.setAttribute("aria-label", "页面对象框选区域");
    const boxes = document.createElement("div"),
      marquee = document.createElement("div");
    marquee.className = "selection-marquee";
    marquee.hidden = true;
    layer.append(boxes, marquee);
    const q = (s) => panel.querySelector(s),
      prior = (o) =>
        (S.nativeEdits || []).find(
          (e) => e.page === page && e.index === o.index,
        ),
      bounds = (o) => transformedBounds(o, prior(o));
    const allowed = (o) =>
      ["text", "image"].includes(o.type) &&
      (mode === "all" || o.type === mode) &&
      !prior(o)?.delete;
    const editable = (o) =>
      (o.editable || o.styleEditable) &&
      !S.nativeEdits.some(
        (e) =>
          e.page === page &&
          e.type === "flow" &&
          e.sources?.some((x) => x.index === o.index),
      );
    const selectedObjects = () => objects.filter((o) => selected.has(o.index));
    function progress(text, busy = false) {
      q("[data-progress]").textContent = text;
      q("progress").hidden = !busy;
      panel.setAttribute("aria-busy", String(busy));
    }
    function refreshPanel() {
      const items = selectedObjects(),
        text = items.filter((o) => o.type === "text"),
        images = items.filter((o) => o.type === "image");
      q("[data-count]").textContent =
        `第 ${page} 页 · 已选 ${items.length} 项（文字 ${text.length} · 图片 ${images.length}）`;
      q("[data-batch]").disabled = !items.length || applying;
      q("[data-text-fields]").hidden = !text.length;
      q("[data-images]").hidden = !images.length;
      const blocked = items.filter((o) => !editable(o));
      q("[data-reasons]").textContent = blocked
        .map(
          (o) =>
            `#${o.index}：${o.reason || "与段落编辑重叠，请先保存并重新打开文档"}`,
        )
        .join("；");
      // Never silently skip read-only objects in a batch.
      if (blocked.length) q("[data-batch]").disabled = true;
    }
    async function load() {
      if (loading || closed) return;
      loading = true;
      const number = page;
      progress("正在读取页面对象…", true);
      try {
        const result = await nativeRequest({
          command: "inspect",
          bytes: source,
          page: number,
        });
        if (closed || source !== S.bytes || number !== page) return;
        objects = result.objects.map((o) => ({
          ...o,
          bounds: o.bounds.map((v, i) => v + (result.pageOrigin?.[i % 2] || 0)),
          matrix: o.matrix.map(
            (v, i) => v + (i >= 4 ? result.pageOrigin?.[i - 4] || 0 : 0),
          ),
        }));
        progress("可框选、Ctrl 多选；方向键 1 pt，Shift + 方向键 10 pt");
      } finally {
        loading = false;
        if (!closed) {
          draw();
          refreshPanel();
        }
      }
    }
    function draw() {
      if (closed) return;
      if (source !== S.bytes) {
        destroy();
        return;
      }
      if (S.page !== page && !applying && !gesture) {
        page = S.page;
        objects = [];
        selected.clear();
        guarded(load);
      }
      const entry = surface.entries.get(page);
      if (!entry?.viewport) return;
      if (layer.parentElement !== entry.shell) entry.shell.append(layer);
      boxes.replaceChildren();
      for (const o of objects.filter(allowed)) {
        const r = entry.viewport.convertToViewportRectangle(bounds(o)),
          b = document.createElement("div");
        b.className =
          "selection-object" +
          (selected.has(o.index) ? " selected" : "") +
          (!editable(o) ? " readonly" : "");
        b.dataset.index = o.index;
        b.dataset.type = o.type;
        b.style.cssText = `left:${Math.min(r[0], r[2])}px;top:${Math.min(r[1], r[3])}px;width:${Math.max(2, Math.abs(r[2] - r[0]))}px;height:${Math.max(2, Math.abs(r[3] - r[1]))}px`;
        boxes.append(b);
      }
    }
    function point(e) {
      const entry = surface.entries.get(page),
        r = entry.shell.getBoundingClientRect();
      return entry.viewport.convertToPdfPoint(
        e.clientX - r.left,
        e.clientY - r.top,
      );
    }
    function at(p) {
      return objects
        .filter(
          (o) =>
            allowed(o) &&
            p[0] >= bounds(o)[0] &&
            p[0] <= bounds(o)[2] &&
            p[1] >= bounds(o)[1] &&
            p[1] <= bounds(o)[3],
        )
        .sort((a, b) => {
          const x = bounds(a),
            y = bounds(b);
          return (x[2] - x[0]) * (x[3] - x[1]) - (y[2] - y[0]) * (y[3] - y[1]);
        })[0];
    }
    layer.onpointerdown = (e) => {
      if (e.button !== 0 || applying || loading || surface.space) return;
      e.preventDefault();
      e.stopPropagation();
      layer.focus({ preventScroll: true });
      const p = point(e),
        hit = at(p);
      gesture = {
        p,
        x: e.clientX,
        y: e.clientY,
        hit,
        add: e.shiftKey || e.ctrlKey || e.metaKey,
        toggle: e.ctrlKey || e.metaKey,
        move:
          !e.altKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          hit &&
          selected.has(hit.index),
        base: new Set(selected),
        dx: 0,
        dy: 0,
      };
      layer.setPointerCapture(e.pointerId);
    };
    layer.onpointermove = (e) => {
      if (!gesture) return;
      const g = gesture,
        p = point(e);
      g.drag = Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4;
      if (!g.drag) return;
      if (g.move) {
        let dx = e.clientX - g.x,
          dy = e.clientY - g.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const end = point({ clientX: g.x + dx, clientY: g.y + dy });
        g.dx = end[0] - g.p[0];
        g.dy = end[1] - g.p[1];
        boxes
          .querySelectorAll(".selected")
          .forEach((b) => (b.style.transform = `translate(${dx}px,${dy}px)`));
        progress(
          `移动 ${selected.size} 项 · ΔX ${g.dx.toFixed(1)} / ΔY ${(-g.dy).toFixed(1)} pt`,
        );
        return;
      }
      const box = rectangle(g.p, p);
      selected.clear();
      if (g.add) g.base.forEach((i) => selected.add(i));
      objects
        .filter(
          (o) =>
            allowed(o) &&
            matchesRect(
              bounds(o),
              box,
              q("[data-match]").value === "intersect",
            ),
        )
        .forEach((o) => selected.add(o.index));
      const r = layer.getBoundingClientRect();
      marquee.hidden = false;
      marquee.style.cssText = `left:${Math.min(g.x, e.clientX) - r.left}px;top:${Math.min(g.y, e.clientY) - r.top}px;width:${Math.abs(e.clientX - g.x)}px;height:${Math.abs(e.clientY - g.y)}px`;
      draw();
      refreshPanel();
    };
    layer.onpointerup = (e) => {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      marquee.hidden = true;
      if (layer.hasPointerCapture(e.pointerId))
        layer.releasePointerCapture(e.pointerId);
      if (g.drag && g.move) {
        guarded(() => change({ move: [g.dx, g.dy] }));
        return;
      }
      if (!g.drag) {
        if (!g.add) selected.clear();
        if (g.hit) {
          if (g.toggle && g.base.has(g.hit.index)) selected.delete(g.hit.index);
          else selected.add(g.hit.index);
        }
      }
      draw();
      refreshPanel();
    };
    layer.onpointercancel = () => {
      if (gesture) {
        selected.clear();
        gesture.base.forEach((i) => selected.add(i));
      }
      gesture = null;
      marquee.hidden = true;
      draw();
      refreshPanel();
    };
    async function change(changes) {
      if (applying || closed || !selected.size || source !== S.bytes) return;
      const targets = selectedObjects().filter(
        (o) =>
          !(changes.size !== undefined || changes.fill) || o.type === "text",
      );
      if (!targets.length) return;
      if (targets.some((o) => !editable(o)))
        throw Error("所选内容包含只读对象，请先取消选择该对象");
      applying = true;
      refreshPanel();
      progress(`正在应用 ${targets.length} 个对象的修改…`, true);
      try {
        const edits = clone(S.nativeEdits || []).filter(
          (e) => e.page !== page || !targets.some((o) => o.index === e.index),
        );
        for (const o of targets)
          edits.push(makeObjectEdit(o, prior(o), page, changes));
        await refreshNative(edits, S.ocr || []);
        if (closed || source !== S.bytes) return;
        commit(clone(S.nodes), { nativeEdits: edits });
        if (changes.delete) selected.clear();
        progress(`已完成 ${targets.length} 项 · 可整批撤销`);
      } catch (e) {
        progress("修改失败，文档保持原状态：" + e.message);
        throw e;
      } finally {
        applying = false;
        draw();
        refreshPanel();
      }
    }
    function destroy() {
      if (closed) return;
      closed = true;
      layer.remove();
      panel.remove();
      document.body.classList.remove("object-select-mode");
      if (active?.destroy === destroy) active = null;
      if (S.objectSelection?.destroy === destroy) S.objectSelection = null;
      mark("read");
    }
    q("[data-done]").onclick = destroy;
    q("[data-clear]").onclick = () => {
      selected.clear();
      draw();
      refreshPanel();
    };
    q("[data-all]").onclick = () => {
      objects.filter(allowed).forEach((o) => selected.add(o.index));
      draw();
      refreshPanel();
    };
    q("[data-move]").onclick = () =>
      guarded(() => {
        const x = +q("[data-dx]").value,
          y = +q("[data-dy]").value;
        if (!Number.isFinite(x + y)) throw Error("位移数值无效");
        return change({ move: [x, -y] });
      });
    q("[data-text]").onclick = () =>
      guarded(() => {
        const c = {};
        if (q("[data-size-enable]").checked) {
          if (!q("[data-size]").checkValidity())
            throw Error("字号应为 1–1000 pt");
          c.size = +q("[data-size]").value;
        }
        if (q("[data-color-enable]").checked)
          c.fill = [1, 3, 5].map((i) =>
            parseInt(q("[data-color]").value.slice(i, i + 2), 16),
          );
        if (!Object.keys(c).length) {
          toast("请勾选要修改的文字属性");
          return;
        }
        return change(c);
      });
    q("[data-delete]").onclick = () => guarded(() => change({ delete: true }));
    q("[data-images]").onclick = () =>
      guarded(async () => {
        const indices = selectedObjects()
          .filter((o) => o.type === "image")
          .map((o) => o.index);
        destroy();
        await editImages({ indices, page });
      });
    active = {
      destroy,
      overlay: draw,
      change,
      selectAll: q("[data-all]").onclick,
      clear: q("[data-clear]").onclick,
    };
    S.objectSelection = active;
    await load();
  }
  document.addEventListener(
    "keydown",
    (e) => {
      if (
        !active ||
        S.busy ||
        document.querySelector("#modal")?.open ||
        e.target.closest("input,select,textarea,[contenteditable=true]") ||
        !e.target.closest("#canvas-host,.object-selection-panel")
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        active.clear();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopImmediatePropagation();
        active.selectAll();
        return;
      }
      const step = e.shiftKey ? 10 : 1,
        d = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }[e.key];
      if ((d && !e.ctrlKey && !e.metaKey && !e.altKey) || e.key === "Delete") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (d) {
          const v = surface.entries.get(S.page)?.viewport;
          if (!v) return;
          const a = v.convertToPdfPoint(0, 0),
            b = v.convertToPdfPoint(d[0] * v.scale, d[1] * v.scale);
          guarded(() => active?.change({ move: [b[0] - a[0], b[1] - a[1]] }));
        } else guarded(() => active?.change({ delete: true }));
      }
    },
    true,
  );
  buttons().forEach((b) =>
    b.addEventListener("click", () =>
      guarded(() => start(b.dataset.selectMode)),
    ),
  );
  return {
    start,
    stop() {
      ++opening;
      active?.destroy();
      surface.hand = false;
      surface.host.classList.remove("hand-mode");
      mark("read");
    },
  };
}

import { icon } from "./icons.mjs";
import { pageRange } from "./generation.mjs";
import { pdfLoadingOptions } from "./pdf-loading.mjs";
import { MM, planPrint } from "./print-layout.mjs";
import { paintPrintSheet } from "./print-render.mjs";

export function installPrinting({ S, pdfjs, exportPDF, session }) {
  const button = document.createElement("button");
  button.id = "print-document";
  button.dataset.doc = "";
  button.title = "打印 Ctrl+P";
  button.innerHTML = icon("print") + "<span>打印</span>";
  document.querySelector(".toolbar .toolgroup").append(button);
  button.hidden = !window.desktop?.printDocument;
  let dialog = null;
  button.onclick = () => {
    if (!S.pdf || S.busy || dialog) return;
    const d = document.createElement("dialog");
    dialog = d;
    d.className = "print-dialog";
    d.setAttribute("aria-label", "打印");
    d.innerHTML = `
      <header><div>${icon("print")}<h2>打印</h2></div><p class="hint" data-name></p></header>
      <div class="print-columns"><section class="print-settings" aria-label="打印设置">
        <div class="print-scope print-modes" role="group" aria-label="打印模式">
          <button data-mode="single" aria-pressed="true">单页</button><button data-mode="nup" aria-pressed="false">多页讲义</button><button data-mode="booklet" aria-pressed="false">小册子</button>
        </div>
        <h3>页面</h3><div class="print-scope" role="group" aria-label="打印范围">
          <button data-scope="all" aria-pressed="true">全部页面</button><button data-scope="current" aria-pressed="false">当前页</button><button data-scope="custom" aria-pressed="false">自定义</button><button data-scope="selected" aria-pressed="false">缩略图选页</button>
        </div>
        <div class="print-thumbnails" hidden role="group" aria-label="选择打印页面"></div>
        <div class="form-grid"><label>页面范围<input data-range value="1-${S.info.pageCount}" aria-label="打印页码范围"></label><label>页面子集<select data-subset><option value="all">全部</option><option value="odd">奇数页</option><option value="even">偶数页</option></select></label><label class="check"><input data-reverse type="checkbox">逆序打印</label></div>
        <h3>纸张与布局</h3><div class="form-grid">
          <label>纸张<select data-paper><option value="source">原页面大小</option><option value="A4">A4</option><option value="A3">A3</option><option value="A5">A5</option><option value="Letter">Letter</option><option value="Legal">Legal</option><option value="custom">自定义</option></select></label>
          <label>方向<select data-orientation><option value="auto">自动</option><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
          <label data-custom-paper hidden>纸张宽度 · mm<input data-paper-width type="number" value="210" min="10" max="2000"></label><label data-custom-paper hidden>纸张高度 · mm<input data-paper-height type="number" value="297" min="10" max="2000"></label>
        </div>
        <div class="form-grid" data-nup hidden>
          <label>每面页数<select data-preset><option value="2">2 页</option><option value="4" selected>4 页</option><option value="6">6 页</option><option value="9">9 页</option><option value="16">16 页</option><option value="custom">自定义行列</option></select></label>
          <label>排列顺序<select data-order><option value="row">横向 · 从左到右</option><option value="row-reverse">横向 · 从右到左</option><option value="column">纵向 · 从上到下</option><option value="column-reverse">纵向 · 从右列开始</option></select></label>
          <label data-custom-grid hidden>行数<input data-rows type="number" value="2" min="1" max="10" step="1"></label><label data-custom-grid hidden>列数<input data-cols type="number" value="2" min="1" max="10" step="1"></label>
        </div>
        <div class="form-grid" data-booklet hidden>
          <label>装订方向<select data-binding><option value="left">左侧装订</option><option value="right">右侧装订</option></select></label>
          <label>打印面<select data-sides><option value="both">正反两面</option><option value="front">仅正面 · 手动双面</option><option value="back">仅背面 · 手动双面</option></select></label>
          <label>每帖页数<select data-signature><option value="0">整本</option><option value="8">8 页</option><option value="16">16 页</option><option value="32">32 页</option></select></label>
          <label class="check"><input data-reverse-sheets type="checkbox">输出纸张逆序</label>
        </div>
        <div class="form-grid">
          <label>缩放<select data-scaling><option value="fit">适合可用区域</option><option value="shrink">仅缩小过大页面</option><option value="actual">实际大小 · 100%</option><option value="custom">自定义比例</option></select></label>
          <label>比例 · %<input data-percent type="number" value="100" min="1" max="1000" disabled></label>
          <label class="check"><input data-auto-rotate type="checkbox" checked>自动旋转子页面</label><label class="check"><input data-border type="checkbox">打印页面边框</label>
        </div>
        <details class="print-spacing"><summary>边距、间距与子页面大小</summary><div class="form-grid">
          <label>页边距 · mm<input data-margin type="number" value="0" min="0" max="200" step="0.5"></label><span></span>
          <label>水平间距 · mm<input data-gap-x type="number" value="6" min="0" max="200" step="0.5"></label><label>垂直间距 · mm<input data-gap-y type="number" value="6" min="0" max="200" step="0.5"></label>
          <label>子页面宽度 · mm<input data-sub-width type="number" value="0" min="0" max="2000" step="0.5"></label><label>子页面高度 · mm<input data-sub-height type="number" value="0" min="0" max="2000" step="0.5"></label>
        </div><p class="hint">子页面大小填 0 时自动分配。拖动预览中的页面可调整位置，拖动角点可等比缩放。</p></details>
        <h3>输出</h3><label class="print-printer-label">打印机<select data-printer><option value="">系统对话框…</option></select></label><div class="form-grid">
          <label>颜色<select data-color><option value="color">彩色</option><option value="gray">黑白 · 灰度</option></select></label>
          <label>双面<select data-duplex><option value="simplex">单面</option><option value="longEdge">双面 · 长边翻转</option><option value="shortEdge">双面 · 短边翻转</option></select></label>
          <label>份数<input data-copies type="number" value="1" min="1" max="999" step="1"></label><label>清晰度<select data-quality><option value="300">标准 · 300 DPI</option><option value="150">快速 · 150 DPI</option><option value="600">精细 · 600 DPI</option></select></label>
          <label class="check"><input data-collate type="checkbox" checked>逐份打印</label>
        </div><p class="hint">选择打印机后使用当前设置打印。若改用系统对话框，请确认纸张方向、尺寸与预览一致。讲义与小册子已排版，打印机的“每张页数”请保持 1。</p>
      </section><aside class="print-preview" aria-label="打印预览">
        <div class="print-preview-nav"><button data-prev aria-label="上一打印面">‹</button><span data-sheet-label></span><button data-next aria-label="下一打印面">›</button></div>
        <div class="print-paper-stage"><div class="print-paper"><canvas data-preview></canvas><svg data-overlay aria-label="调整打印页面" role="group"></svg></div></div>
        <p data-paper-label class="hint"></p><p data-layout-warning class="print-layout-warning" role="status"></p>
        <div class="print-adjust"><span data-selected-label>选择预览中的页面</span><button data-reset>重置调整</button></div>
        <div class="form-grid print-adjust-fields"><label>水平偏移 · mm<input data-offset-x type="number" value="0" min="-5000" max="5000" step="0.5"></label><label>垂直偏移 · mm<input data-offset-y type="number" value="0" min="-5000" max="5000" step="0.5"></label><label>单页缩放 · %<input data-item-scale type="number" value="100" min="5" max="2000"></label></div>
        <p class="hint">拖动页面或使用数值微调。方向键移动，Shift + 方向键加速。仅改变打印布局。</p>
      </aside></div>
      <div class="print-footer"><p data-count class="print-count" aria-live="polite"></p><progress data-progress value="0" max="1" hidden></progress><p data-status role="status" aria-live="polite"></p><footer><button data-pdf>存为 PDF…</button><span></span><button data-cancel>取消</button><button data-print class="primary">打印…</button></footer></div>`;
    const q = (selector) => d.querySelector(selector),
      value = (key) => q("[data-" + key + "]").value,
      number = (key) => Number(value(key)),
      checked = (key) => q("[data-" + key + "]").checked;
    q("[data-name]").textContent = S.name;
    document.body.append(d);
    d.showModal();
    let cancelled = false,
      busy = false,
      pdf = null,
      ready = false,
      mode = "single",
      scope = "all",
      anchor = S.page;
    let plan = null,
      previewIndex = 0,
      selectedNumber = null,
      refreshId = 0,
      previewRevision = 0,
      previewChain = Promise.resolve(),
      drag = null;
    const adjustments = {},
      selected = new Set([S.page]),
      grid = q(".print-thumbnails"),
      queue = [],
      renderTasks = new Set(),
      cache = new Map(),
      dimensions = new Map();
    const status = q("[data-status]"),
      progress = q("progress"),
      overlay = q("[data-overlay]");
    let thumbLoading = false,
      refreshTimer;
    function numbers() {
      if (!value("range").trim()) throw Error("请选择至少一页");
      const subset = value("subset");
      let pages = pageRange(value("range"), S.info.pageCount).filter(
        (n) => subset === "all" || (n % 2 === 1) === (subset === "odd"),
      );
      if (checked("reverse")) pages.reverse();
      if (!pages.length) throw Error("请选择至少一页");
      return pages;
    }
    function options() {
      return {
        mode,
        paper: value("paper"),
        paperWidth: number("paper-width"),
        paperHeight: number("paper-height"),
        orientation: value("orientation"),
        rows: number("rows"),
        cols: number("cols"),
        order: mode === "booklet" ? "row" : value("order"),
        margin: number("margin"),
        gapX: number("gap-x"),
        gapY: number("gap-y"),
        subWidth: number("sub-width"),
        subHeight: number("sub-height"),
        scaling: value("scaling"),
        percent: number("percent"),
        autoRotate: checked("auto-rotate"),
        border: checked("border"),
        binding: value("binding"),
        sides: value("sides"),
        signature: number("signature"),
        reverseSheets: mode === "booklet" && checked("reverse-sheets"),
      };
    }
    function enable(valid) {
      q("[data-print]").disabled = q("[data-pdf]").disabled =
        busy || !ready || !valid;
    }
    function schedule() {
      clearTimeout(refreshTimer);
      ++refreshId;
      try {
        numbers();
      } catch (e) {
        q("[data-count]").textContent = e.message;
        enable(false);
        return;
      }
      enable(false);
      refreshTimer = setTimeout(refresh, 80);
    }
    async function refresh() {
      const id = ++refreshId;
      try {
        const chosen = numbers();
        q("[data-count]").textContent =
          `已选 ${chosen.length} / ${S.info.pageCount} 页`;
        if (!ready || cancelled || busy) return;
        const pages = [];
        for (const [i, n] of chosen.entries()) {
          if (!dimensions.has(n)) {
            const p = await pdf.getPage(n),
              v = p.getViewport({ scale: 1 });
            dimensions.set(n, { number: n, width: v.width, height: v.height });
          }
          if (cancelled || id !== refreshId) return;
          pages.push(dimensions.get(n));
          if (i % 64 === 63) await new Promise((r) => setTimeout(r, 0));
        }
        const copies = number("copies");
        if (!Number.isInteger(copies) || copies < 1 || copies > 999)
          throw Error("份数须为 1–999 的整数");
        plan = planPrint(pages, options(), adjustments);
        previewIndex = Math.min(previewIndex, plan.sheets.length - 1);
        q("[data-count]").textContent =
          `已选 ${chosen.length} 页 · ${plan.sheets.length} 个打印面${plan.blanks ? " · 补 " + plan.blanks + " 个空白页" : ""}`;
        enable(true);
        showPreview();
      } catch (e) {
        if (id === refreshId) {
          plan = null;
          q("[data-count]").textContent = e.message;
          enable(false);
        }
      }
    }
    function setScope(next) {
      scope = next;
      for (const b of d.querySelectorAll("[data-scope]"))
        b.setAttribute("aria-pressed", String(b.dataset.scope === scope));
      grid.hidden = scope !== "selected";
      if (scope === "all") q("[data-range]").value = `1-${S.info.pageCount}`;
      else if (scope === "current") q("[data-range]").value = S.page;
      else if (scope === "selected")
        q("[data-range]").value = [...selected].sort((a, b) => a - b).join(",");
      schedule();
      paintThumbnails();
    }
    async function renderImage(n, scale, preview = false) {
      const key = n + ":" + Math.round(scale * 100),
        hit = preview && cache.get(key);
      if (hit) return hit;
      if (cancelled) throw Error("已取消");
      const p = await pdf.getPage(n),
        base = p.getViewport({ scale: 1 }),
        limited = Math.min(
          scale,
          Math.sqrt(24000000 / (base.width * base.height)),
        ),
        vp = p.getViewport({ scale: limited });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const task = p.render({
        canvasContext: canvas.getContext("2d"),
        viewport: vp,
        intent: "print",
        background: "#ffffff",
      });
      renderTasks.add(task);
      try {
        await task.promise;
      } finally {
        renderTasks.delete(task);
      }
      if (preview) {
        cache.set(key, canvas);
        while (cache.size > 36) {
          const old = cache.keys().next().value;
          const image = cache.get(old);
          image.width = image.height = 1;
          cache.delete(old);
        }
      }
      return canvas;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting && !e.target.dataset.loaded) {
            e.target.dataset.loaded = "true";
            queue.push(e.target);
          }
        paintThumbnails();
      },
      { root: grid, rootMargin: "120px" },
    );
    async function paintThumbnails() {
      if (thumbLoading || cancelled || busy || !ready || scope !== "selected")
        return;
      thumbLoading = true;
      try {
        while (queue.length && !cancelled && !busy) {
          const tile = queue.shift(),
            n = Number(tile.dataset.page),
            p = await pdf.getPage(n),
            v = p.getViewport({ scale: 1 }),
            image = await renderImage(n, 90 / v.width, true),
            canvas = tile.querySelector("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          canvas.getContext("2d").drawImage(image, 0, 0);
        }
      } catch {
      } finally {
        thumbLoading = false;
      }
    }
    for (let n = 1; n <= S.info.pageCount; n++) {
      const b = document.createElement("button");
      b.dataset.page = n;
      b.setAttribute("aria-label", `第 ${n} 页`);
      b.setAttribute("aria-pressed", String(selected.has(n)));
      b.innerHTML = "<canvas></canvas><span>" + n + "</span>";
      b.onclick = (e) => {
        if (busy) return;
        if (e.shiftKey) {
          for (let i = Math.min(anchor, n); i <= Math.max(anchor, n); i++)
            selected.add(i);
        } else {
          selected.has(n) ? selected.delete(n) : selected.add(n);
          anchor = n;
        }
        for (const tile of grid.children)
          tile.setAttribute(
            "aria-pressed",
            String(selected.has(Number(tile.dataset.page))),
          );
        setScope("selected");
      };
      grid.append(b);
      observer.observe(b);
    }
    for (const b of d.querySelectorAll("[data-scope]"))
      b.onclick = () => {
        if (!busy) setScope(b.dataset.scope);
      };
    for (const b of d.querySelectorAll("[data-mode]"))
      b.onclick = () => {
        if (busy) return;
        mode = b.dataset.mode;
        previewIndex = 0;
        for (const item of d.querySelectorAll("[data-mode]"))
          item.setAttribute("aria-pressed", String(item === b));
        q("[data-nup]").hidden = mode !== "nup";
        q("[data-booklet]").hidden = mode !== "booklet";
        q("[data-paper] option[value=source]").disabled = mode !== "single";
        if (mode !== "single" && value("paper") === "source")
          q("[data-paper]").value = "A4";
        if (mode === "booklet") {
          q("[data-orientation]").value = "landscape";
          q("[data-duplex]").value = "shortEdge";
          q("[data-gap-x]").value = 0;
        } else q("[data-orientation]").value = "auto";
        q("[data-margin]").value = mode === "single" ? 0 : 10;
        schedule();
      };
    q("[data-range]").oninput = () => setScope("custom");
    q("[data-preset]").onchange = () => {
      const preset = value("preset"),
        dims = { 2: [1, 2], 4: [2, 2], 6: [2, 3], 9: [3, 3], 16: [4, 4] }[
          preset
        ];
      if (dims) {
        q("[data-rows]").value = dims[0];
        q("[data-cols]").value = dims[1];
      }
      for (const el of d.querySelectorAll("[data-custom-grid]"))
        el.hidden = preset !== "custom";
    };
    q("[data-paper]").onchange = () => {
      for (const el of d.querySelectorAll("[data-custom-paper]"))
        el.hidden = value("paper") !== "custom";
    };
    q("[data-scaling]").onchange = () =>
      (q("[data-percent]").disabled = value("scaling") !== "custom");
    q("[data-sides]").onchange = () =>
      (q("[data-duplex]").value =
        value("sides") === "both" ? "shortEdge" : "simplex");
    q("[data-printer]").onchange = () => {
      q("[data-print]").textContent = value("printer") ? "打印" : "打印…";
    };
    for (const el of d.querySelectorAll(
      ".print-settings input,.print-settings select",
    ))
      el.addEventListener("input", schedule);
    for (const el of d.querySelectorAll(".print-settings select"))
      el.addEventListener("change", schedule);
    function adjustFields() {
      const a = adjustments[selectedNumber] || {};
      q("[data-selected-label]").textContent = selectedNumber
        ? `第 ${selectedNumber} 页 · 单页调整`
        : "选择预览中的页面";
      q("[data-offset-x]").value = ((a.x || 0) / MM).toFixed(1);
      q("[data-offset-y]").value = ((a.y || 0) / MM).toFixed(1);
      q("[data-item-scale]").value = Math.round((a.scale || 1) * 100);
      for (const el of d.querySelectorAll(".print-adjust-fields input"))
        el.disabled = busy || !selectedNumber;
      q("[data-reset]").disabled = busy || !selectedNumber;
    }
    function drawOverlay() {
      const sheet = plan.sheets[previewIndex];
      overlay.setAttribute("viewBox", `0 0 ${sheet.width} ${sheet.height}`);
      overlay.replaceChildren();
      const svg = (tag, attrs) => {
        const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        return e;
      };
      for (const p of sheet.slots) {
        const r = p.rect || p.cell,
          g = svg("g", {
            "data-slot": p.number ?? "",
            tabindex: p.number == null ? -1 : 0,
            role: "button",
            "aria-label":
              p.number == null ? "补齐空白页" : `调整第 ${p.number} 页`,
          });
        g.append(
          svg("rect", {
            ...p.cell,
            fill: "transparent",
            stroke: p.number === selectedNumber ? "var(--accent)" : "#a5acb644",
            "stroke-width": p.number === selectedNumber ? 1.2 : 0.5,
            "stroke-dasharray": "3 3",
            "vector-effect": "non-scaling-stroke",
          }),
        );
        const label = svg("text", {
          x: p.cell.x + 4,
          y: p.cell.y + 12,
          "font-size": 9,
          fill: "#64748b",
          "pointer-events": "none",
        });
        label.textContent = p.number ?? "空白";
        g.append(label);
        if (p.number === selectedNumber) {
          const x = Math.max(
              p.cell.x,
              Math.min(p.cell.x + p.cell.width, r.x + r.width),
            ),
            y = Math.max(
              p.cell.y,
              Math.min(p.cell.y + p.cell.height, r.y + r.height),
            ),
            size = (8 * sheet.width) / 420;
          g.append(
            svg("rect", {
              x: x - size / 2,
              y: y - size / 2,
              width: size,
              height: size,
              rx: 2,
              fill: "var(--accent)",
              stroke: "white",
              "stroke-width": 1,
              "data-handle": "scale",
            }),
          );
        }
        overlay.append(g);
      }
    }
    function showPreview() {
      if (!plan || cancelled) return;
      const sheet = plan.sheets[previewIndex],
        revision = ++previewRevision;
      if (!sheet.slots.some((p) => p.number === selectedNumber))
        selectedNumber =
          sheet.slots.find((p) => p.number != null)?.number || null;
      q("[data-sheet-label]").textContent =
        `${previewIndex + 1} / ${plan.sheets.length}${sheet.side === "single" ? "" : " · 第 " + sheet.sheet + " 张 · " + (sheet.side === "front" ? "正面" : "背面")}`;
      q("[data-prev]").disabled = previewIndex === 0;
      q("[data-next]").disabled = previewIndex === plan.sheets.length - 1;
      q("[data-paper-label]").textContent =
        `${(sheet.width / MM).toFixed(1)} × ${(sheet.height / MM).toFixed(1)} mm`;
      const mixed = plan.sheets.some(
        (s) =>
          Math.abs(s.width - sheet.width) > 0.1 ||
          Math.abs(s.height - sheet.height) > 0.1,
      );
      q("[data-layout-warning]").textContent = plan.clipped
        ? "部分内容超出子页面边界，输出时会裁切。"
        : mixed
          ? "页面尺寸不一致。打印机使用统一纸张时请选择固定纸张；存为 PDF 可保留各页大小。"
          : "";
      fitPaper();
      drawOverlay();
      adjustFields();
      const border = checked("border"),
        grayscale = value("color") === "gray";
      previewChain = previewChain
        .catch(() => {})
        .then(async () => {
          if (cancelled || busy || revision !== previewRevision) return;
          const scale = Math.min(700 / sheet.width, 800 / sheet.height),
            canvas = document.createElement("canvas");
          canvas.width = Math.ceil(sheet.width * scale);
          canvas.height = Math.ceil(sheet.height * scale);
          const ctx = canvas.getContext("2d");
          ctx.scale(scale, scale);
          await paintPrintSheet(
            ctx,
            sheet,
            (p) => renderImage(p.number, Math.min(2, p.scale * scale), true),
            { border, grayscale },
          );
          if (cancelled || revision !== previewRevision) return;
          const target = q("[data-preview]");
          target.width = canvas.width;
          target.height = canvas.height;
          target.getContext("2d").drawImage(canvas, 0, 0);
          canvas.width = canvas.height = 1;
        })
        .catch((e) => {
          if (!cancelled && !busy) status.textContent = e.message;
        });
    }
    function fitPaper() {
      if (!plan) return;
      const sheet = plan.sheets[previewIndex],
        stage = q(".print-paper-stage"),
        scale = Math.min(
          stage.clientWidth / sheet.width,
          stage.clientHeight / sheet.height,
        ),
        paper = q(".print-paper");
      paper.style.width = sheet.width * scale + "px";
      paper.style.height = sheet.height * scale + "px";
    }
    const resizeObserver = new ResizeObserver(fitPaper);
    resizeObserver.observe(q(".print-paper-stage"));
    q("[data-prev]").onclick = () => {
      if (!busy && previewIndex > 0) {
        previewIndex--;
        showPreview();
      }
    };
    q("[data-next]").onclick = () => {
      if (!busy && plan && previewIndex < plan.sheets.length - 1) {
        previewIndex++;
        showPreview();
      }
    };
    function updateAdjustment(a) {
      if (!selectedNumber || busy) return;
      adjustments[selectedNumber] = a;
      refresh();
    }
    for (const el of d.querySelectorAll(".print-adjust-fields input"))
      el.oninput = () =>
        updateAdjustment({
          x: number("offset-x") * MM,
          y: number("offset-y") * MM,
          scale: number("item-scale") / 100,
        });
    q("[data-reset]").onclick = () => {
      if (selectedNumber) {
        delete adjustments[selectedNumber];
        refresh();
      }
    };
    overlay.onpointerdown = (e) => {
      const item = e.target.closest("[data-slot]"),
        n = Number(item?.dataset.slot);
      if (busy || !n || !plan) return;
      e.preventDefault();
      selectedNumber = n;
      const p = plan.sheets[previewIndex].slots.find((p) => p.number === n),
        box = overlay.getBoundingClientRect(),
        unit = plan.sheets[previewIndex].width / box.width;
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        unit,
        scale: e.target.hasAttribute("data-handle"),
        a: { x: 0, y: 0, scale: 1, ...adjustments[n] },
        width: p.rect.width,
        height: p.rect.height,
      };
      overlay.setPointerCapture(e.pointerId);
      drawOverlay();
      adjustFields();
    };
    overlay.onpointermove = (e) => {
      if (!drag || busy) return;
      const dx = (e.clientX - drag.x) * drag.unit,
        dy = (e.clientY - drag.y) * drag.unit;
      const a = { ...drag.a };
      if (drag.scale) {
        const factor = Math.max(
          0.05,
          1 +
            (2 * (dx * drag.width + dy * drag.height)) /
              (drag.width ** 2 + drag.height ** 2),
        );
        a.scale = Math.max(0.05, Math.min(20, drag.a.scale * factor));
      } else {
        a.x += dx;
        a.y += dy;
      }
      adjustments[selectedNumber] = a;
      refresh();
    };
    overlay.onpointerup = overlay.onpointercancel = () => {
      drag = null;
    };
    overlay.onkeydown = (e) => {
      const n = Number(e.target.closest("[data-slot]")?.dataset.slot);
      if (
        !n ||
        busy ||
        !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      )
        return;
      e.preventDefault();
      selectedNumber = n;
      const a = { x: 0, y: 0, scale: 1, ...adjustments[n] },
        step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowUp") a.y -= step;
      if (e.key === "ArrowDown") a.y += step;
      if (e.key === "ArrowLeft") a.x -= step;
      if (e.key === "ArrowRight") a.x += step;
      updateAdjustment(a);
    };
    async function close() {
      cancelled = true;
      ++refreshId;
      ++previewRevision;
      clearTimeout(refreshTimer);
      observer.disconnect();
      resizeObserver.disconnect();
      for (const t of renderTasks) t.cancel();
      if (!busy) {
        d.close();
        d.remove();
        dialog = null;
        await previewChain.catch(() => {});
        if (pdf) {
          await pdf.destroy();
          pdf = null;
        }
        for (const image of cache.values()) image.width = image.height = 1;
        cache.clear();
      }
    }
    q("[data-cancel]").onclick = close;
    d.oncancel = (e) => {
      e.preventDefault();
      close();
    };
    async function output(destination) {
      if (busy || !plan || !ready) return;
      try {
        const token = session.capture(),
          sheets = plan.sheets,
          dpi = number("quality"),
          grayscale = value("color") === "gray",
          border = checked("border");
        const settings = {
          color: !grayscale,
          duplexMode: value("duplex"),
          copies: number("copies"),
          collate: checked("collate"),
          dpi,
          deviceName: value("printer"),
        };
        busy = true;
        enable(false);
        ++previewRevision;
        for (const el of d.querySelectorAll(
          ".print-settings input,.print-settings select,.print-settings button",
        ))
          el.disabled = true;
        adjustFields();
        await previewChain.catch(() => {});
        const pages = [];
        let memory = 0;
        progress.hidden = false;
        progress.max = sheets.length;
        for (const [i, sheet] of sheets.entries()) {
          if (cancelled) return;
          session.assert(token);
          status.textContent = `正在准备第 ${i + 1} / ${sheets.length} 个打印面`;
          const scale = Math.min(
              dpi / 72,
              Math.sqrt(24000000 / (sheet.width * sheet.height)),
            ),
            canvas = document.createElement("canvas");
          canvas.width = Math.ceil(sheet.width * scale);
          canvas.height = Math.ceil(sheet.height * scale);
          const ctx = canvas.getContext("2d");
          ctx.scale(scale, scale);
          try {
            let previous = null;
            try {
              await paintPrintSheet(
                ctx,
                sheet,
                async (slot) => {
                  if (cancelled) throw Error("已取消");
                  if (previous) previous.width = previous.height = 1;
                  previous = await renderImage(slot.number, slot.scale * scale);
                  return previous;
                },
                { border, grayscale },
              );
            } finally {
              if (previous) previous.width = previous.height = 1;
            }
            const blob = await new Promise((r) =>
              canvas.toBlob(r, "image/png"),
            );
            if (!blob) throw Error("无法生成打印页面");
            const image = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(Error("打印页面读取失败"));
              reader.readAsDataURL(blob);
            });
            memory += image.length;
            if (memory > 256 * 1024 ** 2)
              throw Error("打印内容较大，请减少页面范围或选择 150 DPI");
            pages.push({ image, width: sheet.width, height: sheet.height });
          } finally {
            canvas.width = canvas.height = 1;
          }
          progress.value = i + 1;
          await new Promise((r) => setTimeout(r, 0));
        }
        if (cancelled) return;
        status.textContent =
          destination === "pdf"
            ? "请选择 PDF 保存位置"
            : settings.deviceName
              ? "正在发送到打印机…"
              : "请在系统对话框中选择打印机";
        q("[data-cancel]").disabled = true;
        const result = await window.desktop.printDocument({
          title: S.name,
          pages,
          settings,
          destination,
        });
        if (!result.cancelled) cancelled = true;
      } catch (e) {
        if (!cancelled) status.textContent = e.message;
      } finally {
        busy = false;
        q("[data-cancel]").disabled = false;
        for (const el of d.querySelectorAll(
          ".print-settings input,.print-settings select,.print-settings button",
        ))
          el.disabled = false;
        q("[data-percent]").disabled = value("scaling") !== "custom";
        q("[data-paper] option[value=source]").disabled = mode !== "single";
        if (cancelled) await close();
        else {
          adjustFields();
          enable(!!plan);
        }
      }
    }
    q("[data-print]").onclick = () => output("printer");
    q("[data-pdf]").onclick = () => output("pdf");
    enable(false);
    adjustFields();
    status.textContent = "正在准备当前文档…";
    window.desktop
      .listPrinters?.()
      .then((printers) => {
        if (cancelled || busy) return;
        const select = q("[data-printer]");
        for (const printer of printers) {
          const option = document.createElement("option");
          option.value = printer.name;
          option.textContent = printer.displayName || printer.name;
          select.append(option);
        }
        select.value = printers.find((p) => p.isDefault)?.name || "";
        q("[data-print]").textContent = select.value ? "打印" : "打印…";
      })
      .catch(() => {});
    (async () => {
      try {
        const bytes = await exportPDF();
        if (cancelled) return;
        pdf = await pdfjs.getDocument({ ...pdfLoadingOptions, data: bytes })
          .promise;
        if (cancelled) {
          await pdf.destroy();
          pdf = null;
          return;
        }
        ready = true;
        status.textContent = "";
        await refresh();
        paintThumbnails();
      } catch (e) {
        if (!cancelled) status.textContent = e.message;
      }
    })();
  };
  document.addEventListener("keydown", (e) => {
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      e.key.toLowerCase() === "p" &&
      !e.isComposing
    ) {
      e.preventDefault();
      if (!document.body.classList.contains("studio-active")) button.click();
    }
  });
}

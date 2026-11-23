// Virtualized, lazy-rendered PDF page thumbnail sidebar.
// Features commercial PDF reader Ctrl+Wheel continuous zooming with automatic
// multi-column reflow, scroll-anchor preservation, and zero-flicker LRU cache.

const MAX_CACHE = 64;
const OVERSCAN_PX = 320;
const PAD_Y = 12;
const GAP = 10;
const LABEL_H = 22;
const MIN_THUMB_W = 72;
const MAX_THUMB_W = 240;
const DEFAULT_THUMB_W = 156;

export function installThumbnailSidebar({
  S,
  surface,
  goPage,
  contextMenu,
  actions,
  guarded,
  createBookmark,
  setRangeMark,
  onModeChange = () => {},
}) {
  const aside = document.querySelector(".outline-panel");
  const panel = document.getElementById("thumb-panel");
  const list = document.getElementById("thumb-list");
  const spacer = document.getElementById("thumb-spacer");
  const rowsHost = document.getElementById("thumb-rows");
  const emptyEl = document.getElementById("thumb-empty");
  const statusEl = document.getElementById("thumb-status");
  const footInfoEl = document.getElementById("thumb-foot-info");
  const countBadge = document.getElementById("thumb-page-count");
  const tabBookmarks = document.getElementById("sidebar-tab-bookmarks");
  const tabThumbnails = document.getElementById("sidebar-tab-thumbnails");
  const zoomSlider = document.getElementById("thumb-zoom-slider");
  const zoomOutBtn = document.querySelector('[data-thumb-zoom="out"]');
  const zoomInBtn = document.querySelector('[data-thumb-zoom="in"]');
  const organizeButtons = [...document.querySelectorAll('[data-thumb-action="organize"]')];

  if (!aside || !panel || !list || !spacer || !rowsHost) {
    return {
      mode: () => "bookmarks",
      setMode: () => {},
      syncDocument: () => {},
      syncActivePage: () => {},
      invalidate: () => {},
      onVisibilityChange: () => {},
    };
  }

  let mode = "bookmarks";
  let thumbWidth = DEFAULT_THUMB_W;
  try {
    const savedMode = localStorage.getItem("folio-sidebar-tab");
    if (savedMode === "thumbnails" || savedMode === "bookmarks") mode = savedMode;
    const savedW = Number(localStorage.getItem("folio-thumb-width"));
    if (Number.isFinite(savedW) && savedW >= MIN_THUMB_W && savedW <= MAX_THUMB_W) {
      thumbWidth = Math.round(savedW);
    }
  } catch {}

  let docRevision = 0;
  let renderEpoch = 0;
  let scrollFrame = 0;
  let zoomFrame = 0;
  let pendingWheelDelta = 0;
  let pendingWheelY = null;
  let zoomRenderTimer = 0;
  let activeTask = null;
  let rendering = false;
  let rowMetrics = []; // [{ top, height, pages: [{ page, frameW, frameH, cardW }], effectiveCols }]
  let totalHeight = 0;
  let lastLayoutKey = "";
  let renderedRows = new Map(); // rowIndex -> element
  let renderedCards = new Map(); // page -> { el, canvas, frame, frameW, frameH, renderedKey, renderedPx }
  const bitmapCache = new Map(); // exactKey -> { canvas, page, rot, px } (LRU)
  const fallbackByPage = new Map(); // `${docRevision}:${page}:${rot}` -> HTMLCanvasElement (latest rendered)

  const clampWidth = (w) => Math.max(MIN_THUMB_W, Math.min(MAX_THUMB_W, Math.round(w)));

  function isVisible() {
    return (
      mode === "thumbnails" &&
      document.body.dataset.left === "full" &&
      !document.body.classList.contains("studio-active")
    );
  }

  function clearCache() {
    for (const entry of bitmapCache.values()) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    bitmapCache.clear();
    fallbackByPage.clear();
  }

  function putCache(key, entry) {
    if (bitmapCache.has(key)) {
      bitmapCache.delete(key);
    } else if (bitmapCache.size >= MAX_CACHE) {
      const oldestKey = bitmapCache.keys().next().value;
      const oldest = bitmapCache.get(oldestKey);
      bitmapCache.delete(oldestKey);
      if (oldest) {
        const fbKey = `${docRevision}:${oldest.page}:${oldest.rot}`;
        if (fallbackByPage.get(fbKey) === oldest.canvas) fallbackByPage.delete(fbKey);
        oldest.canvas.width = 0;
        oldest.canvas.height = 0;
      }
    }
    bitmapCache.set(key, entry);
    fallbackByPage.set(`${docRevision}:${entry.page}:${entry.rot}`, entry.canvas);
  }

  function getCache(key) {
    const hit = bitmapCache.get(key);
    if (!hit) return null;
    bitmapCache.delete(key);
    bitmapCache.set(key, hit);
    return hit;
  }

  function cancelPending() {
    renderEpoch++;
    if (zoomRenderTimer) {
      clearTimeout(zoomRenderTimer);
      zoomRenderTimer = 0;
    }
    if (activeTask) {
      try {
        activeTask.cancel();
      } catch {}
      activeTask = null;
    }
  }

  function pageCount() {
    return S.pdf && S.info?.pageCount ? S.info.pageCount : 0;
  }

  function pageAspect(p) {
    const info = S.info?.pages?.[p - 1];
    if (!info?.box) return 1.414;
    let w = info.box.width * (info.userUnit || 1);
    let h = info.box.height * (info.userUnit || 1);
    if ((surface.rotation(p) || 0) % 180) [w, h] = [h, w];
    if (!w || !h) return 1.414;
    return Math.max(0.45, Math.min(2.4, h / w));
  }

  // Commercial PDF reader auto-reflow: columns derive naturally from sidebar width & target thumbnail size.
  function computeLayout(force = false) {
    const count = pageCount();
    const hostW = list.clientWidth || 248;
    const innerW = Math.max(104, hostW - 22);
    const effectiveCols = Math.max(1, Math.floor((innerW + GAP) / (thumbWidth + GAP)));
    const cardW =
      effectiveCols === 1
        ? Math.min(innerW, Math.max(MIN_THUMB_W, thumbWidth))
        : Math.floor((innerW - GAP * (effectiveCols - 1)) / effectiveCols);
    const frameW = Math.max(52, cardW - 12);
    const rotSig = surface.viewRotation || 0;
    const layoutKey = `${docRevision}:${count}:${effectiveCols}:${cardW}:${rotSig}`;
    if (!force && layoutKey === lastLayoutKey) return false;
    lastLayoutKey = layoutKey;

    rowMetrics = [];
    let y = PAD_Y;
    for (let p = 1; p <= count; p += effectiveCols) {
      const pages = [];
      let maxFrameH = 0;
      for (let c = 0; c < effectiveCols && p + c <= count; c++) {
        const pn = p + c;
        const aspect = pageAspect(pn);
        const fh = Math.max(46, Math.min(Math.round(frameW * 1.85), Math.round(frameW * aspect)));
        pages.push({ page: pn, frameW, frameH: fh, cardW });
        if (fh > maxFrameH) maxFrameH = fh;
      }
      const rowH = maxFrameH + LABEL_H + 14;
      rowMetrics.push({ top: y, height: rowH, pages, effectiveCols });
      y += rowH + GAP;
    }
    totalHeight = count ? y - GAP + PAD_Y : 0;
    spacer.style.height = totalHeight + "px";
    return true;
  }

  function clearDomRows() {
    for (const card of renderedCards.values()) {
      card.canvas.width = 0;
      card.canvas.height = 0;
    }
    renderedCards.clear();
    renderedRows.clear();
    rowsHost.replaceChildren();
  }

  function pageLabelText(p) {
    const label = S.labels?.[p - 1];
    return label && String(label) !== String(p) ? `${p} · ${label}` : String(p);
  }

  function targetPixelWidth(frameW) {
    const dpr = Math.min(2, Math.max(1, Math.round((window.devicePixelRatio || 1) * 2) / 2));
    // Bucket render widths in 24px steps so slight zoom tweaks reuse sharp cached bitmaps cleanly.
    return Math.max(96, Math.ceil((frameW * dpr) / 24) * 24);
  }

  function cacheKeyFor(page, frameW) {
    const rot = surface.rotation(page) || 0;
    return `${docRevision}:${page}:${rot}:${targetPixelWidth(frameW)}`;
  }

  function drawBitmapInto(card, sourceCanvas, cacheKey, isExact) {
    const target = card.canvas;
    if (target.width !== sourceCanvas.width || target.height !== sourceCanvas.height) {
      target.width = sourceCanvas.width;
      target.height = sourceCanvas.height;
    }
    const ctx = target.getContext("2d", { alpha: false });
    if (ctx) ctx.drawImage(sourceCanvas, 0, 0);
    if (isExact) card.renderedKey = cacheKey;
    card.el.dataset.loaded = "true";
  }

  function createRowElement(rowIdx, metric) {
    const row = document.createElement("div");
    row.className = "thumb-row";
    row.dataset.row = String(rowIdx);
    row.dataset.cols = String(metric.effectiveCols);
    row.style.top = metric.top + "px";
    row.style.height = metric.height + "px";

    for (const item of metric.pages) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "thumb-card" + (item.page === S.page ? " active" : "");
      btn.dataset.page = String(item.page);
      btn.style.width = item.cardW + "px";
      if (item.page === S.page) btn.setAttribute("aria-current", "page");
      btn.setAttribute("aria-label", `第 ${item.page} 页`);

      const frame = document.createElement("span");
      frame.className = "thumb-frame";
      frame.style.width = item.frameW + "px";
      frame.style.height = item.frameH + "px";

      const canvas = document.createElement("canvas");
      canvas.className = "thumb-canvas";
      canvas.setAttribute("aria-hidden", "true");
      frame.append(canvas);

      const num = document.createElement("span");
      num.className = "thumb-label";
      num.translate = false;
      num.textContent = pageLabelText(item.page);

      btn.append(frame, num);
      row.append(btn);

      const card = {
        el: btn,
        canvas,
        frame,
        frameW: item.frameW,
        frameH: item.frameH,
        renderedKey: "",
      };
      renderedCards.set(item.page, card);

      const key = cacheKeyFor(item.page, item.frameW);
      const exact = getCache(key);
      if (exact) {
        drawBitmapInto(card, exact.canvas, key, true);
      } else {
        // Zero-flicker zoom: immediately display last rendered bitmap scaled to new frame while sharper render queues.
        const rot = surface.rotation(item.page) || 0;
        const fb = fallbackByPage.get(`${docRevision}:${item.page}:${rot}`);
        if (fb && fb.width > 0) drawBitmapInto(card, fb, key, false);
      }
    }

    return row;
  }

  function findFirstRow(scrollTop) {
    let lo = 0;
    let hi = rowMetrics.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rowMetrics[mid].top + rowMetrics[mid].height >= scrollTop) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  function syncVisibleRows(forceRebuild = false, { deferRender = false } = {}) {
    const count = pageCount();
    if (countBadge) countBadge.textContent = count ? count.toLocaleString() : "0";
    if (statusEl) {
      statusEl.textContent = count ? `第 ${S.page || 1} / ${count} 页` : "未打开文档";
    }
    if (footInfoEl) {
      footInfoEl.textContent = count ? `共 ${count.toLocaleString()} 页` : "打开 PDF 浏览页面";
    }
    if (emptyEl) emptyEl.hidden = count > 0;
    for (const btn of organizeButtons) btn.disabled = !count;

    if (!count || !isVisible()) {
      cancelPending();
      if (!count) {
        lastLayoutKey = "";
        rowMetrics = [];
        totalHeight = 0;
        spacer.style.height = "0px";
        clearDomRows();
      }
      return;
    }

    const layoutChanged = computeLayout(forceRebuild);
    if (layoutChanged) clearDomRows();

    const scrollTop = list.scrollTop;
    const viewH = list.clientHeight || 500;
    const low = Math.max(0, scrollTop - OVERSCAN_PX);
    const high = scrollTop + viewH + OVERSCAN_PX;

    const first = findFirstRow(low);
    const keepRows = new Set();
    for (let i = first; i < rowMetrics.length && rowMetrics[i].top <= high; i++) {
      keepRows.add(i);
    }

    for (const [idx, el] of renderedRows) {
      if (!keepRows.has(idx)) {
        for (const cardEl of el.querySelectorAll(".thumb-card")) {
          const p = Number(cardEl.dataset.page);
          const card = renderedCards.get(p);
          if (card) {
            card.canvas.width = 0;
            card.canvas.height = 0;
            renderedCards.delete(p);
          }
        }
        el.remove();
        renderedRows.delete(idx);
      }
    }

    const frag = document.createDocumentFragment();
    for (const idx of keepRows) {
      if (!renderedRows.has(idx)) {
        const el = createRowElement(idx, rowMetrics[idx]);
        renderedRows.set(idx, el);
        frag.append(el);
      }
    }
    if (frag.childNodes.length) rowsHost.append(frag);

    if (deferRender) {
      if (zoomRenderTimer) clearTimeout(zoomRenderTimer);
      zoomRenderTimer = setTimeout(() => {
        zoomRenderTimer = 0;
        pumpRenderQueue();
      }, 90);
    } else {
      pumpRenderQueue();
    }
  }

  function pumpRenderQueue() {
    if (rendering || !isVisible() || !S.pdf) return;
    rendering = true;
    const epoch = renderEpoch;

    (async () => {
      try {
        while (epoch === renderEpoch && isVisible() && S.pdf) {
          const centerY = list.scrollTop + (list.clientHeight || 500) / 2;
          let best = null;
          let bestDist = Infinity;

          for (const [page, card] of renderedCards) {
            const key = cacheKeyFor(page, card.frameW);
            if (card.renderedKey === key) continue;
            const exact = getCache(key);
            if (exact) {
              drawBitmapInto(card, exact.canvas, key, true);
              continue;
            }
            const rowTop = parseFloat(card.el.parentElement?.style.top || "0");
            const dist = Math.abs(rowTop - centerY);
            if (dist < bestDist) {
              bestDist = dist;
              best = { page, card, key };
            }
          }

          if (!best) break;

          const pdf = S.pdf;
          const { page, card, key } = best;
          const targetPx = targetPixelWidth(card.frameW);
          const rot = surface.rotation(page) || 0;
          try {
            const pdfPage = await pdf.getPage(page);
            if (epoch !== renderEpoch || !isVisible() || S.pdf !== pdf) break;
            const baseVp = pdfPage.getViewport({ scale: 1, rotation: rot });
            const scale = targetPx / Math.max(1, baseVp.width);
            const vp = pdfPage.getViewport({ scale, rotation: rot });

            const off = document.createElement("canvas");
            off.width = Math.max(1, Math.ceil(vp.width));
            off.height = Math.max(1, Math.ceil(vp.height));
            const ctx = off.getContext("2d", { alpha: false });
            if (!ctx) break;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, off.width, off.height);

            const task = pdfPage.render({
              canvasContext: ctx,
              viewport: vp,
              background: "white",
            });
            activeTask = task;
            await task.promise;
            if (activeTask === task) activeTask = null;

            if (epoch !== renderEpoch || S.pdf !== pdf) {
              off.width = 0;
              off.height = 0;
              break;
            }

            putCache(key, { canvas: off, page, rot, px: targetPx });
            const liveCard = renderedCards.get(page);
            if (liveCard && cacheKeyFor(page, liveCard.frameW) === key) {
              drawBitmapInto(liveCard, off, key, true);
            }
          } catch (err) {
            if (err?.name === "RenderingCancelledException") break;
            if (renderedCards.get(page) === card) card.renderedKey = key;
          }

          await new Promise((r) => requestAnimationFrame(r));
        }
      } finally {
        rendering = false;
        if (epoch === renderEpoch && isVisible() && S.pdf) {
          for (const [page, card] of renderedCards) {
            if (card.renderedKey !== cacheKeyFor(page, card.frameW)) {
              pumpRenderQueue();
              break;
            }
          }
        }
      }
    })();
  }

  function captureAnchor(clientY = null) {
    if (!rowMetrics.length) return null;
    const rect = list.getBoundingClientRect();
    const viewOffset =
      clientY == null
        ? Math.min(48, (list.clientHeight || 200) * 0.25)
        : Math.max(0, Math.min(list.clientHeight || 200, clientY - rect.top));
    const targetY = list.scrollTop + viewOffset;
    const rowIdx = Math.min(rowMetrics.length - 1, findFirstRow(targetY));
    const metric = rowMetrics[rowIdx];
    if (!metric?.pages.length) return null;
    const frac = metric.height > 0 ? Math.max(0, Math.min(1, (targetY - metric.top) / metric.height)) : 0;
    return { page: metric.pages[0].page, frac, viewOffset };
  }

  function restoreAnchor(anchor) {
    if (!anchor || !rowMetrics.length) return;
    const effectiveCols = rowMetrics[0]?.effectiveCols || 1;
    const rowIdx = Math.min(rowMetrics.length - 1, Math.floor((anchor.page - 1) / effectiveCols));
    const metric = rowMetrics[rowIdx];
    if (!metric) return;
    const targetY = metric.top + anchor.frac * metric.height - anchor.viewOffset;
    list.scrollTop = Math.max(0, targetY);
  }

  function syncZoomControls() {
    if (zoomSlider && Number(zoomSlider.value) !== thumbWidth) {
      zoomSlider.value = String(thumbWidth);
    }
    if (zoomOutBtn) zoomOutBtn.disabled = thumbWidth <= MIN_THUMB_W;
    if (zoomInBtn) zoomInBtn.disabled = thumbWidth >= MAX_THUMB_W;
  }

  function setThumbWidth(nextWidth, { clientY = null, deferRender = false } = {}) {
    const clamped = clampWidth(nextWidth);
    if (clamped === thumbWidth) {
      syncZoomControls();
      return;
    }
    const anchor = captureAnchor(clientY);
    thumbWidth = clamped;
    try {
      localStorage.setItem("folio-thumb-width", String(thumbWidth));
    } catch {}
    syncZoomControls();
    cancelPending();
    computeLayout(true);
    restoreAnchor(anchor);
    clearDomRows();
    syncVisibleRows(false, { deferRender });
  }

  function scrollPageIntoView(page) {
    if (!isVisible() || !rowMetrics.length) return;
    const effectiveCols = rowMetrics[0]?.effectiveCols || 1;
    const rowIdx = Math.floor((page - 1) / effectiveCols);
    const metric = rowMetrics[rowIdx];
    if (!metric) return;
    const top = list.scrollTop;
    const viewH = list.clientHeight || 500;
    if (metric.top < top + 8) {
      list.scrollTop = Math.max(0, metric.top - 12);
    } else if (metric.top + metric.height > top + viewH - 8) {
      list.scrollTop = Math.max(0, metric.top + metric.height - viewH + 12);
    }
  }

  function syncActivePage(page = S.page, follow = true) {
    const count = pageCount();
    if (statusEl) {
      statusEl.textContent = count ? `第 ${page || 1} / ${count} 页` : "未打开文档";
    }
    for (const [p, card] of renderedCards) {
      const isActive = p === page;
      card.el.classList.toggle("active", isActive);
      if (isActive) card.el.setAttribute("aria-current", "page");
      else card.el.removeAttribute("aria-current");
    }
    if (follow && isVisible() && page) {
      scrollPageIntoView(page);
      syncVisibleRows(false);
    }
  }

  function setMode(nextMode, { persist = true, focus = false } = {}) {
    const normalized = nextMode === "thumbnails" ? "thumbnails" : "bookmarks";
    const changed = mode !== normalized;
    mode = normalized;
    aside.dataset.sidebarMode = mode;
    panel.hidden = mode !== "thumbnails";
    if (tabBookmarks) {
      tabBookmarks.setAttribute("aria-selected", String(mode === "bookmarks"));
      tabBookmarks.tabIndex = mode === "bookmarks" ? 0 : -1;
    }
    if (tabThumbnails) {
      tabThumbnails.setAttribute("aria-selected", String(mode === "thumbnails"));
      tabThumbnails.tabIndex = mode === "thumbnails" ? 0 : -1;
    }
    const railLabel = aside.querySelector(".panel-rail > span");
    if (railLabel) railLabel.textContent = mode === "thumbnails" ? "缩略图" : "书签";

    if (persist) {
      try {
        localStorage.setItem("folio-sidebar-tab", mode);
      } catch {}
    }

    if (mode === "thumbnails") {
      syncVisibleRows(false);
      if (S.page) {
        scrollPageIntoView(S.page);
        syncVisibleRows(false);
      }
    } else {
      cancelPending();
    }

    if (focus) {
      (mode === "thumbnails" ? tabThumbnails : tabBookmarks)?.focus({ preventScroll: true });
    }
    if (changed) onModeChange(mode);
  }

  function bindFastTab(btn, targetMode) {
    if (!btn) return;
    btn.addEventListener("pointerdown", (e) => {
      if (e.button === 0 && e.pointerType !== "touch") {
        setMode(targetMode);
      }
    });
    btn.addEventListener("click", () => setMode(targetMode));
  }

  bindFastTab(tabBookmarks, "bookmarks");
  bindFastTab(tabThumbnails, "thumbnails");

  const tabStrip = aside.querySelector(".sidebar-mode-tabs");
  tabStrip?.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const target =
      e.key === "Home"
        ? "bookmarks"
        : e.key === "End"
          ? "thumbnails"
          : mode === "bookmarks"
            ? "thumbnails"
            : "bookmarks";
    setMode(target, { focus: true });
  });

  // Commercial PDF reader Ctrl+Wheel zooming inside the thumbnail sidebar.
  panel.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey || !isVisible()) return;
      e.preventDefault();
      e.stopPropagation();
      pendingWheelDelta += e.deltaY;
      pendingWheelY = e.clientY;
      if (zoomFrame) return;
      zoomFrame = requestAnimationFrame(() => {
        zoomFrame = 0;
        const delta = pendingWheelDelta;
        const cy = pendingWheelY;
        pendingWheelDelta = 0;
        pendingWheelY = null;
        if (!delta) return;
        const factor = Math.exp(-delta * 0.0018);
        let next = Math.round(thumbWidth * factor);
        // Guarantee a crisp noticeable step per notched wheel detent.
        if (Math.abs(next - thumbWidth) < 8) {
          next = thumbWidth + (delta < 0 ? 12 : -12);
        }
        setThumbWidth(next, { clientY: cy, deferRender: true });
      });
    },
    { passive: false },
  );

  zoomSlider?.addEventListener("input", () => {
    setThumbWidth(Number(zoomSlider.value), { deferRender: true });
  });
  zoomOutBtn?.addEventListener("click", () => setThumbWidth(thumbWidth - 24));
  zoomInBtn?.addEventListener("click", () => setThumbWidth(thumbWidth + 24));

  for (const btn of organizeButtons) {
    btn.addEventListener("click", () => {
      document.getElementById("page-organizer")?.click();
    });
  }

  list.addEventListener(
    "scroll",
    () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        syncVisibleRows(false);
      });
    },
    { passive: true },
  );

  list.addEventListener("click", (e) => {
    const card = e.target.closest(".thumb-card");
    if (!card || !S.pdf) return;
    const p = Number(card.dataset.page);
    if (p) guarded(() => goPage(p));
  });

  list.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "0") {
      e.preventDefault();
      setThumbWidth(DEFAULT_THUMB_W);
      return;
    }
    const count = pageCount();
    if (!count) return;
    const activeEl = document.activeElement?.closest?.(".thumb-card");
    const cur = Number(activeEl?.dataset.page) || S.page || 1;
    const step = rowMetrics[0]?.effectiveCols || 1;
    let next = null;
    if (e.key === "ArrowRight") next = Math.min(count, cur + 1);
    else if (e.key === "ArrowLeft") next = Math.max(1, cur - 1);
    else if (e.key === "ArrowDown") next = Math.min(count, cur + step);
    else if (e.key === "ArrowUp") next = Math.max(1, cur - step);
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = count;
    if (next == null || next === cur) return;
    e.preventDefault();
    scrollPageIntoView(next);
    syncVisibleRows(false);
    renderedCards.get(next)?.el.focus({ preventScroll: true });
    guarded(() => goPage(next));
  });

  list.addEventListener("contextmenu", (e) => {
    const card = e.target.closest(".thumb-card");
    if (!card || !S.pdf) return;
    e.preventDefault();
    const p = Number(card.dataset.page);
    if (!p) return;
    contextMenu(e.clientX, e.clientY, [
      [`转到第 ${p} 页`, () => guarded(() => goPage(p))],
      null,
      ["标记为范围起点", () => setRangeMark?.("start", p)],
      ["标记为范围终点", () => setRangeMark?.("end", p)],
      [
        "为该页新建书签",
        () =>
          guarded(async () => {
            await goPage(p);
            createBookmark?.("after");
          }),
      ],
      null,
      ["组织页面…", () => document.getElementById("page-organizer")?.click()],
      ["页面操作…", () => actions?.pages?.()],
    ]);
  });

  const resizeObserver = new ResizeObserver(() => {
    if (isVisible()) syncVisibleRows(false);
  });
  resizeObserver.observe(list);

  syncZoomControls();
  setMode(mode, { persist: false });

  return {
    mode: () => mode,
    setMode,
    thumbWidth: () => thumbWidth,
    setThumbWidth,
    syncDocument({ resetScroll = true } = {}) {
      docRevision++;
      cancelPending();
      clearCache();
      lastLayoutKey = "";
      clearDomRows();
      if (resetScroll) list.scrollTop = 0;
      syncVisibleRows(true);
      if (S.page && isVisible()) {
        scrollPageIntoView(S.page);
        syncVisibleRows(false);
      }
    },
    invalidate() {
      docRevision++;
      cancelPending();
      clearCache();
      lastLayoutKey = "";
      syncVisibleRows(true);
    },
    syncActivePage,
    onVisibilityChange() {
      if (isVisible()) {
        syncVisibleRows(false);
        if (S.page) {
          scrollPageIntoView(S.page);
          syncVisibleRows(false);
        }
      } else {
        cancelPending();
      }
    },
  };
}

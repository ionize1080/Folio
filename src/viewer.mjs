// Virtual page surface. PDF coordinates are always transformed by PDF.js viewports.
export class PageSurface {
  constructor(pdfjs, host, state, settings, onActive, onError) {
    Object.assign(this, { pdfjs, host, s: state, settings, onActive, onError });
    this.layout = "continuous";
    this.cover = true;
    this.gaps = true;
    this.viewRotation = 0;
    this.entries = new Map();
    this.fallback = new Map();
    this.tileSerial = 0;
    this.boxes = [];
    this.epoch = 0;
    this.navigation = 0;
    this.past = [];
    this.future = [];
    host.tabIndex = 0;
    host.addEventListener("scroll", () => this.schedule(), { passive: true });
    host.addEventListener("pointerdown", (e) => {
      if (
        !e.target.closest(
          "input,button,textarea,[contenteditable],.page-edit-layer",
        )
      )
        host.focus({ preventScroll: true });
    });
    host.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    this.space = false;
    this.lastWheel = 0;
    this.boundary = 0;
    host.addEventListener("pointerdown", (e) => {
      if (!this.space || e.button !== 0) return;
      e.preventDefault();
      this.drag = [e.clientX, e.clientY, host.scrollLeft, host.scrollTop];
      host.setPointerCapture(e.pointerId);
    });
    host.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      host.scrollLeft = this.drag[2] + this.drag[0] - e.clientX;
      host.scrollTop = this.drag[3] + this.drag[1] - e.clientY;
    });
    host.addEventListener("pointerup", () => (this.drag = null));
  }
  reset() {
    this.cancel();
    this.past = [];
    this.future = [];
    this.viewRotation = 0;
    this.boxes = [];
    this.signature = "";
    this.host.querySelector("#page-shell")?.remove();
    this.host.querySelector("#page-stage")?.remove();
    this.stage = document.createElement("div");
    this.stage.id = "page-stage";
    this.host.append(this.stage);
  }
  dispose(e) {
    e.cancelled = true;
    e.task?.cancel();
    e.textTask?.cancel();
    for (const t of e.tiles?.values() || []) t.task?.cancel();
    e.shell.remove();
    for (const c of e.shell.querySelectorAll("canvas")) {
      c.width = 0;
      c.height = 0;
    }
  }
  cancel(keep = false) {
    this.epoch++;
    this.tileSerial++;
    for (const [p, e] of this.entries) {
      e.cancelled = true;
      e.task?.cancel();
      e.textTask?.cancel();
      for (const t of e.tiles?.values() || []) t.task?.cancel();
      if (keep && e.shell.dataset.ready === "true") {
        if (this.fallback.has(p)) this.dispose(this.fallback.get(p));
        for (const el of [e.shell, ...e.shell.querySelectorAll("[id]")])
          el.removeAttribute("id");
        e.text.hidden = true;
        e.marks.hidden = true;
        e.draw.hidden = true;
        e.shell.querySelector(".target-marker")?.remove();
        e.shell.classList.add("page-fallback");
        e.shell.style.pointerEvents = "none";
        this.fallback.set(p, e);
      } else this.dispose(e);
    }
    this.entries.clear();
    if (!keep) {
      for (const e of this.fallback.values()) this.dispose(e);
      this.fallback.clear();
    }
  }
  rotation(p) {
    return (
      ((this.s.rotation[p] ?? this.s.info.pages[p - 1].rotation) +
        this.viewRotation) %
      360
    );
  }
  geometry(p) {
    const a = this.s.info.pages[p - 1],
      b = a.box;
    let w = b.width * (a.userUnit || 1),
      h = b.height * (a.userUnit || 1);
    if (this.rotation(p) % 180) [w, h] = [h, w];
    return { w, h };
  }
  capture(clientX, clientY) {
    if (!this.boxes.length) return null;
    const r = this.host.getBoundingClientRect();
    const sx =
        clientX === undefined ? this.host.clientWidth / 2 : clientX - r.left,
      sy = clientY === undefined ? this.host.clientHeight / 2 : clientY - r.top;
    const x = this.host.scrollLeft + sx,
      y = this.host.scrollTop + sy;
    let b = this.boxes.reduce((a, b) =>
      this.distance(b, x, y) < this.distance(a, x, y) ? b : a,
    );
    const e = this.entries.get(b.page);
    const rx = (x - b.x) / b.w,
      ry = (y - b.y) / b.h;
    return {
      page: b.page,
      rx,
      ry,
      sx,
      sy,
      zoom: this.s.zoom,
      layout: this.layout,
      viewRotation: this.viewRotation,
      point: e?.viewport?.convertToPdfPoint(x - b.x, y - b.y),
    };
  }
  distance(b, x, y) {
    return (
      Math.max(b.x - x, 0, x - b.x - b.w) ** 2 +
      Math.max(b.y - y, 0, y - b.y - b.h) ** 2
    );
  }
  restoreAnchor(a) {
    if (!a) return;
    const b = this.boxes.find((b) => b.page === a.page);
    if (!b) return;
    this.host.scrollLeft = b.x + a.rx * b.w - a.sx;
    this.host.scrollTop = b.y + a.ry * b.h - a.sy;
  }
  remember() {
    const a = this.capture();
    if (a) {
      this.past.push(a);
      if (this.past.length > 100) this.past.shift();
      this.future = [];
    }
  }
  async history(dir) {
    const from = dir < 0 ? this.past : this.future,
      to = dir < 0 ? this.future : this.past,
      a = from.pop();
    if (!a) return;
    const current = this.capture();
    if (current) to.push(current);
    this.s.page = a.page;
    this.s.zoom = a.zoom;
    this.layout = a.layout;
    this.viewRotation = a.viewRotation;
    await this.refresh(a);
  }
  async refresh(anchor = this.capture(), render = true) {
    if (!this.s.pdf) return;
    const { s, host } = this;
    const facing = this.layout === "two" || this.layout === "two-continuous",
      horizontal = this.layout === "horizontal",
      single = this.layout === "single" || this.layout === "two";
    const base = this.geometry(s.page),
      margin = this.gaps ? 24 : 0,
      gap = this.gaps ? 16 : 0;
    let scale = Number(s.zoom);
    if (s.zoom === "width")
      scale =
        (host.clientWidth - margin * 2 - (facing ? gap : 0)) /
        (base.w * (facing ? 2 : 1));
    if (s.zoom === "fit")
      scale = Math.min(
        (host.clientWidth - margin * 2 - (facing ? gap : 0)) /
          (base.w * (facing ? 2 : 1)),
        (host.clientHeight - margin * 2) / base.h,
      );
    scale = Math.max(0.1, Math.min(12, scale || 1));
    s.scale = scale;
    let pages = Array.from({ length: s.info.pageCount }, (_, i) => i + 1);
    if (this.layout === "single") pages = [s.page];
    const spread = (p) =>
      this.cover ? (p === 1 ? 0 : Math.floor(p / 2)) : Math.floor((p - 1) / 2);
    if (this.layout === "two")
      pages = pages.filter((p) => spread(p) === spread(s.page));
    const key = JSON.stringify([
      this.layout,
      this.cover,
      this.gaps,
      scale,
      host.clientWidth,
      host.clientHeight,
      devicePixelRatio || 1,
      this.settings.quality || 2,
      s.rotation,
      this.viewRotation,
      single ? s.page : 0,
    ]);
    if (key !== this.signature) {
      this.signature = key;
      this.cancel(true);
      let rows = [];
      for (const page of pages) {
        let row = rows.at(-1);
        if (!row || !facing || spread(row[0]) !== spread(page))
          rows.push((row = []));
        row.push(page);
      }
      this.boxes = [];
      let y = margin,
        x = margin,
        totalW = host.clientWidth,
        totalH = host.clientHeight;
      for (const row of rows) {
        const sizes = row.map((p) => this.geometry(p)),
          w =
            sizes.reduce((v, b) => v + b.w * scale, 0) + gap * (row.length - 1),
          h = Math.max(...sizes.map((b) => b.h * scale));
        let xx = horizontal ? x : Math.max(margin, (host.clientWidth - w) / 2);
        for (let i = 0; i < row.length; i++) {
          const b = {
            page: row[i],
            x: xx,
            y: horizontal ? margin : y,
            w: sizes[i].w * scale,
            h: sizes[i].h * scale,
          };
          this.boxes.push(b);
          xx += b.w + gap;
          totalW = Math.max(totalW, xx - gap + margin);
        }
        if (horizontal) {
          x += w + gap;
          totalH = Math.max(totalH, h + 2 * margin);
        } else {
          y += h + gap;
          totalH = Math.max(totalH, y - gap + margin);
        }
      }
      this.stage.style.width = totalW + "px";
      this.stage.style.height = totalH + "px";
    }
    for (const [p, e] of this.fallback) {
      const b = this.boxes.find((b) => b.page === p);
      if (!b) {
        this.dispose(e);
        this.fallback.delete(p);
        continue;
      }
      e.shell.style.left = b.x + "px";
      e.shell.style.top = b.y + "px";
      e.shell.style.transformOrigin = "0 0";
      e.shell.style.transform = `scale(${b.w / e.b.w},${b.h / e.b.h})`;
    }
    this.restoreAnchor(anchor);
    if (render) await this.update();
  }
  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update().catch(this.onError);
    });
  }
  async update() {
    this.updateAgain = true;
    if (this.updatePromise) return this.updatePromise;
    this.updatePromise = (async () => {
      while (this.updateAgain) {
        this.updateAgain = false;
        await this.updateVisible();
      }
    })();
    try {
      await this.updatePromise;
    } finally {
      this.updatePromise = null;
    }
  }
  async updateVisible() {
    if (!this.boxes.length) return;
    const { host } = this,
      x = host.scrollLeft,
      y = host.scrollTop,
      w = host.clientWidth,
      h = host.clientHeight;
    const wanted = this.boxes
      .filter(
        (b) =>
          b.x + b.w > x - 150 &&
          b.x < x + w + 150 &&
          b.y + b.h > y - h * 0.65 &&
          b.y < y + h * 1.65,
      )
      .sort(
        (a, b) =>
          this.distance(a, x + w / 2, y + h / 2) -
          this.distance(b, x + w / 2, y + h / 2),
      )
      .slice(0, 8);
    // Keep the active editor mounted while its caret travels into the
    // pasteboard. Scroll position must not silently select the next PDF page.
    const editingPage = this.s.flowEdit?.editing ? this.s.flowEdit.page : null;
    const editingBox =
      editingPage && this.boxes.find((b) => b.page === editingPage);
    if (editingBox && !wanted.some((b) => b.page === editingPage))
      wanted.push(editingBox);
    const keep = new Set(wanted.map((b) => b.page));
    for (const [p, e] of this.entries)
      if (!keep.has(p) && this.entries.size > 6) {
        this.dispose(e);
        this.entries.delete(p);
      }
    for (const [p, e] of this.fallback)
      if (!keep.has(p)) {
        this.dispose(e);
        this.fallback.delete(p);
      }
    // Sequential render prioritizes center; already running work is shared by its promise.
    const epoch = this.epoch;
    for (const b of wanted) {
      if (epoch !== this.epoch) return;
      await this.ensure(b);
      this.scheduleTiles();
    }
    if (epoch !== this.epoch) return;
    const visible = wanted.filter(
      (b) => this.distance(b, x + w / 2, y + h / 2) === 0,
    );
    const b = visible.find((b) => b.page === this.s.page) || wanted[0];
    if (editingBox) this.activate(editingPage);
    else if (b) this.activate(b.page);
    this.scheduleTiles();
  }
  async ensure(b) {
    if (this.entries.has(b.page)) return this.entries.get(b.page).promise;
    const shell = document.createElement("div");
    shell.className = "pdf-page";
    shell.dataset.page = b.page;
    shell.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--scale-factor:${this.s.scale};--total-scale-factor:${this.s.scale};--user-unit:1`;
    const canvas = document.createElement("canvas"),
      text = document.createElement("div"),
      marks = document.createElement("div"),
      draw = document.createElement("div");
    text.className = "textLayer";
    marks.className = "marks";
    draw.className = "draw";
    shell.style.background = "transparent";
    const tileLayer = document.createElement("div");
    tileLayer.className = "page-tiles";
    shell.append(tileLayer, text, marks, draw);
    this.stage.append(shell);
    const e = {
      shell,
      canvas,
      text,
      marks,
      draw,
      tileLayer,
      tiles: new Map(),
      b: { ...b },
      cancelled: false,
    };
    this.entries.set(b.page, e);
    const pdf = this.s.pdf,
      scale = this.s.scale;
    e.promise = (async () => {
      const p = await pdf.getPage(b.page);
      if (e.cancelled) return;
      e.page = p;
      e.viewport = p.getViewport({ scale, rotation: this.rotation(b.page) });
      // PDF.js TextLayer needs scale * userUnit and the minimum font-size correction.
      shell.style.setProperty(
        "--total-scale-factor",
        e.viewport.scale * e.viewport.userUnit,
      );
      const vp = e.viewport,
        ratio = Math.min(
          devicePixelRatio || 1,
          this.settings.quality || 2,
          Math.sqrt(6000000 / (vp.width * vp.height)),
        );
      e.ratio = ratio;
      e.lastUsed = performance.now();
      canvas.width = Math.max(1, Math.ceil(vp.width * ratio));
      canvas.height = Math.max(1, Math.ceil(vp.height * ratio));
      canvas.style.width = vp.width + "px";
      canvas.style.height = vp.height + "px";
      e.task = p.render({
        canvasContext: canvas.getContext("2d", { alpha: false }),
        viewport: vp,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
      });
      await e.task.promise;
      if (e.cancelled) return;
      shell.prepend(canvas);
      shell.style.background = "white";
      shell.dataset.ready = "true";
      const old = this.fallback.get(b.page);
      if (
        old &&
        ratio >=
          Math.min(devicePixelRatio || 1, this.settings.quality || 2) - 0.001
      ) {
        this.dispose(old);
        this.fallback.delete(b.page);
      }
      if (this.fallback.has(b.page)) {
        canvas.style.opacity = "0";
        shell.style.background = "transparent";
      }
      this.scheduleTiles();
      const content = await p.getTextContent();
      if (e.cancelled) return;
      e.content = content;
      e.textTask = new this.pdfjs.TextLayer({
        textContentSource: content,
        container: text,
        viewport: vp,
      });
      await e.textTask.render();
      if (e.cancelled) return;
      shell.dataset.ready = "true";
    })().catch((err) => {
      if (!e.cancelled && err.name !== "RenderingCancelledException")
        this.onError(err);
    });
    return e.promise;
  }
  scheduleTiles() {
    this.tilesAgain = true;
    if (this.tileRunning || this.tileTimer) return;
    this.tileTimer = setTimeout(async () => {
      this.tileTimer = null;
      if (this.tileRunning) return;
      this.tileRunning = true;
      try {
        while (this.tilesAgain) {
          this.tilesAgain = false;
          await this.renderTiles(this.tileSerial);
        }
      } catch (e) {
        this.onError(e);
      } finally {
        this.tileRunning = false;
      }
    }, 16);
  }
  async renderTiles(serial) {
    const ratio = Math.min(devicePixelRatio || 1, this.settings.quality || 2),
      size = 512,
      h = this.host;
    const desired = [],
      visibleKeys = new Map();
    const vx = h.scrollLeft,
      vy = h.scrollTop,
      vw = h.clientWidth,
      vh = h.clientHeight;
    for (const e of this.entries.values()) {
      if (!e.page || e.cancelled || !e.viewport || !e.ratio) continue;
      const b = e.b,
        v = e.viewport;
      const visible =
        b.x + b.w > vx && b.x < vx + vw && b.y + b.h > vy && b.y < vy + vh;
      if (visible) e.lastUsed = performance.now();
      if (e.ratio >= ratio - 0.001) {
        e.shell.dataset.sharp = "true";
        continue;
      }
      const keys = new Set();
      visibleKeys.set(e, keys);
      for (
        let iy = Math.max(0, Math.floor((vy - b.y - size) / size));
        iy <=
        Math.min(
          Math.ceil(v.height / size) - 1,
          Math.floor((vy + vh - b.y + size) / size),
        );
        iy++
      )
        for (
          let ix = Math.max(0, Math.floor((vx - b.x) / size));
          ix <=
          Math.min(
            Math.ceil(v.width / size) - 1,
            Math.floor((vx + vw - b.x) / size),
          );
          ix++
        ) {
          const key = ix + ":" + iy,
            x = ix * size,
            y = iy * size;
          const isVisible =
            b.x + x + size > vx &&
            b.x + x < vx + vw &&
            b.y + y + size > vy &&
            b.y + y < vy + vh;
          if (isVisible) keys.add(key);
          const t = e.tiles.get(key);
          if (t) {
            t.lastUsed = performance.now();
            continue;
          }
          desired.push({
            e,
            key,
            x,
            y,
            priority: isVisible ? 0 : 1,
            distance: Math.abs(b.y + y - vy - vh / 2),
          });
        }
    }
    desired.sort((a, b) => a.priority - b.priority || a.distance - b.distance);
    for (const q of desired) {
      if (serial !== this.tileSerial) return;
      const { e, key, x, y } = q,
        v = e.viewport;
      if (e.cancelled || e.tiles.has(key)) continue;
      // Scroll updates reprioritize after the current tile, without discarding completed work.
      if (this.tilesAgain) break;
      const w = Math.min(size, v.width - x),
        hh = Math.min(size, v.height - y),
        c = document.createElement("canvas");
      c.width = Math.ceil(w * ratio);
      c.height = Math.ceil(hh * ratio);
      c.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${hh}px`;
      const t = { canvas: c, lastUsed: performance.now() };
      e.tiles.set(key, t);
      try {
        t.task = e.page.render({
          canvasContext: c.getContext("2d", { alpha: false }),
          viewport: v,
          transform: [ratio, 0, 0, ratio, -x * ratio, -y * ratio],
          background: "white",
        });
        await t.task.promise;
        if (serial !== this.tileSerial || e.cancelled) {
          e.tiles.delete(key);
          c.width = 0;
          continue;
        }
        e.tileLayer.append(c);
        t.ready = true;
      } catch (err) {
        e.tiles.delete(key);
        c.width = 0;
        if (err.name !== "RenderingCancelledException") throw err;
      }
    }
    for (const [e, keys] of visibleKeys) {
      if (keys.size && [...keys].every((key) => e.tiles.get(key)?.ready)) {
        const old = this.fallback.get(e.b.page);
        if (old) {
          this.dispose(old);
          this.fallback.delete(e.b.page);
        }
        e.canvas.style.opacity = "1";
        e.shell.style.background = "white";
        e.shell.dataset.sharp = "true";
      }
    }
    // Byte-based LRU includes base canvases, tiles and fallback canvases, not just a page count.
    const memory = (e) =>
      e.canvas.width * e.canvas.height * 4 +
      [...e.tiles.values()].reduce(
        (n, t) => n + t.canvas.width * t.canvas.height * 4,
        0,
      );
    let bytes = [...this.entries.values(), ...this.fallback.values()].reduce(
      (n, e) => n + memory(e),
      0,
    );
    const budget = 128 * 1024 * 1024;
    const offscreen = [...this.entries.values()]
      .filter(
        (e) =>
          e.b.x + e.b.w <= vx ||
          e.b.x >= vx + vw ||
          e.b.y + e.b.h <= vy ||
          e.b.y >= vy + vh,
      )
      .sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
    for (const e of offscreen) {
      if (bytes <= budget) break;
      bytes -= memory(e);
      this.dispose(e);
      this.entries.delete(e.b.page);
    }
    const stale = [];
    for (const e of this.entries.values())
      for (const [key, t] of e.tiles)
        if (!visibleKeys.get(e)?.has(key) && t.ready) stale.push({ e, key, t });
    stale.sort((a, b) => a.t.lastUsed - b.t.lastUsed);
    for (const { e, key, t } of stale) {
      if (bytes <= budget) break;
      bytes -= t.canvas.width * t.canvas.height * 4;
      t.canvas.remove();
      t.canvas.width = 0;
      e.tiles.delete(key);
    }
    this.tileBytes = [...this.entries.values()].reduce(
      (n, e) =>
        n +
        [...e.tiles.values()].reduce(
          (v, t) => v + t.canvas.width * t.canvas.height * 4,
          0,
        ),
      0,
    );
  }
  activate(page) {
    const e = this.entries.get(page);
    if (!e?.viewport || e.cancelled) return;
    for (const a of this.entries.values())
      for (const el of [a.shell, a.canvas, a.text, a.marks, a.draw])
        el.removeAttribute("id");
    [e.shell.id, e.canvas.id, e.text.id, e.marks.id, e.draw.id] = [
      "page-shell",
      "pdf-canvas",
      "text-layer",
      "mark-layer",
      "draw-layer",
    ];
    this.s.page = page;
    this.s.view = e.viewport;
    this.s.currentText = e.content;
    this.onActive(e);
  }
  async go(page, target = null, history = true) {
    if (!this.s.pdf) return;
    const nav = ++this.navigation;
    if (history) this.remember();
    page = Math.max(1, Math.min(this.s.info.pageCount, Number(page) || 1));
    this.s.page = page;
    await this.refresh(null, false);
    if (nav !== this.navigation) return;
    const b = this.boxes.find((b) => b.page === page);
    if (!b) return;
    this.host.scrollTop = b.y;
    this.host.scrollLeft = Math.max(0, b.x - 24);
    await this.ensure(b);
    if (nav !== this.navigation) return;
    const e = this.entries.get(page);
    if (!e?.viewport) return;
    if (!target) this.marker = null;
    if (target) {
      const vp = e.viewport,
        v = e.page.view,
        a = target.args || [];
      let point;
      if (target.mode === "XYZ")
        point = vp.convertToViewportPoint(a[0] ?? v[0], a[1] ?? v[3]);
      else if (["FitH", "FitBH"].includes(target.mode))
        point = vp.convertToViewportPoint(v[0], a[0] ?? v[3]);
      else if (["FitV", "FitBV"].includes(target.mode))
        point = vp.convertToViewportPoint(a[0] ?? v[0], v[3]);
      else if (target.mode === "FitR") {
        const r = vp.convertToViewportRectangle(a);
        point = [Math.min(r[0], r[2]), Math.min(r[1], r[3])];
      }
      if (point) {
        this.host.scrollLeft = Math.max(0, b.x + point[0] - 16);
        this.host.scrollTop = Math.max(0, b.y + point[1] - 16);
        this.marker = {
          page,
          point,
          native: e.viewport.convertToPdfPoint(...point),
        };
      }
    }
    await this.update();
    if (nav === this.navigation) this.activate(page);
  }
  async zoom(value, cx, cy) {
    this.navigation++;
    const a = this.capture(cx, cy);
    this.s.zoom = value;
    await this.refresh(a);
  }
  wheel(e) {
    if (!this.s.pdf) return;
    const now = performance.now(),
      fresh = now - this.lastWheel > 200;
    this.lastWheel = now;
    if (e.ctrlKey) {
      e.preventDefault();
      this.zoom(
        String(
          Math.max(
            0.1,
            Math.min(12, this.s.scale * Math.exp(-e.deltaY * 0.002)),
          ),
        ),
        e.clientX,
        e.clientY,
      ).catch(this.onError);
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      this.host.scrollLeft += e.deltaY || e.deltaX;
      return;
    }
    if (this.layout === "horizontal" && !e.deltaX) {
      e.preventDefault();
      this.host.scrollLeft += e.deltaY;
      return;
    }
    if (!["single", "two"].includes(this.layout)) return;
    const down = e.deltaY > 0,
      at = down
        ? this.host.scrollTop + this.host.clientHeight >=
          this.host.scrollHeight - 2
        : this.host.scrollTop <= 1;
    if (at) {
      e.preventDefault();
      if (fresh && now - this.boundary > 350) {
        this.boundary = now;
        this.go(this.s.page + (down ? 1 : -1) * (this.layout === "two" ? 2 : 1))
          .then(() => {
            if (!down) this.host.scrollTop = this.host.scrollHeight;
          })
          .catch(this.onError);
      }
    }
  }
  screen(dir) {
    const h = this.host;
    if (
      ["single", "two"].includes(this.layout) &&
      ((dir > 0 && h.scrollTop + h.clientHeight >= h.scrollHeight - 2) ||
        (dir < 0 && h.scrollTop <= 1))
    )
      return this.go(this.s.page + dir * (this.layout === "two" ? 2 : 1)).then(
        () => {
          if (dir < 0) h.scrollTop = h.scrollHeight;
        },
      );
    if (this.layout === "horizontal") h.scrollLeft += dir * h.clientWidth * 0.9;
    else h.scrollTop += dir * h.clientHeight * 0.9;
  }
  point() {
    const e = this.entries.get(this.s.page);
    if (!e?.viewport) return [0, 0];
    const h = this.host.getBoundingClientRect(),
      r = e.shell.getBoundingClientRect();
    return e.viewport.convertToPdfPoint(
      Math.max(0, h.left - r.left),
      Math.max(0, h.top - r.top),
    );
  }
  selection() {
    const sel = window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0),
      el = (
        range.startContainer.nodeType === 1
          ? range.startContainer
          : range.startContainer.parentElement
      )?.closest(".pdf-page");
    if (!el) return null;
    const page = Number(el.dataset.page),
      e = this.entries.get(page),
      rect = range.getClientRects()[0],
      r = el.getBoundingClientRect();
    if (!e || !rect) return null;
    return {
      page,
      text: sel.toString().trim(),
      point: e.viewport.convertToPdfPoint(rect.left - r.left, rect.top - r.top),
    };
  }
}

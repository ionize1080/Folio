// Page organizer: thumbnail grid for reordering, inserting, rotating, replacing and extracting pages.
//
// Performance notes
// - Thumbnails of the open document come from the viewer's already-loaded PDF.js document, so the
//   grid paints immediately instead of re-exporting and re-parsing the whole file first.
// - Each source page is rasterized once into an ImageBitmap (LRU cache). Rotation, page marks,
//   resizing and cropping only recompose that bitmap on the tile canvas; PDF.js never re-renders.
// - Tiles are keyed DOM nodes reused across edits; a change reorders nodes instead of rebuilding.
// - Marquee selection uses rectangles cached at pointerdown and is throttled to animation frames.
import {pageRange} from './generation.mjs';
import * as pdfjs from './vendor/pdf.mjs';
import {pdfLoadingOptions} from './pdf-loading.mjs';
import {icon} from './icons.mjs';
import {chooseBlankPages} from './blank-pages-ui.mjs';
import {readPageBoxes, organizerGeometry} from './page-organization-geometry.mjs';
import {nativeRequest, releaseSource} from './native-source.mjs';
import {toBase64, fromBase64} from './portable-state.mjs';

const THUMB_MAX = 240; // largest thumbnail size (CSS px) offered by the zoom slider
const BITMAP_LIMIT = 160; // rasterized source pages kept in memory
const CANVAS_LIMIT = 96; // off-screen tile canvases kept before their pixels are released
const DRAG_TYPE = 'application/x-folio-pages';

export function installPageOrganizer({S, session, run, exportPDF, replaceDocument}) {
  const menu = document.querySelector('.more-tools-menu');
  const button = document.createElement('button');
  button.id = 'page-organizer';
  button.dataset.doc = '';
  button.innerHTML = icon('page-grid') + '组织页面';
  button.title = '缩略图多选、拖动排序、插入、删除、提取与替换';
  const blankButton = document.createElement('button');
  blankButton.id = 'insert-blank-page';
  blankButton.dataset.doc = '';
  blankButton.innerHTML = icon('new-page') + '插入空白页…';
  blankButton.title = '选择空白页尺寸、方向、数量和插入位置';
  menu.append(button, blankButton);
  button.onclick = () => open();
  blankButton.onclick = () => open('blank');

  async function open(initialAction = '') {
    button.closest('details')?.removeAttribute('open');
    if (!S.pdf || S.busy) return;
    const capture = session.capture();
    const d = document.createElement('dialog');
    d.className = 'organizer-dialog';
    d.setAttribute('aria-label', '组织页面');
    d.innerHTML = template();
    document.body.append(d);
    d.showModal();
    const q = s => d.querySelector(s);
    const grid = q('.organizer-grid'), statusLine = q('[data-status]');
    const dpr = Math.min(2, Math.max(1, devicePixelRatio || 1));
    const raster = Math.round(THUMB_MAX * dpr);

    // ---- state ----------------------------------------------------------------------------
    let order = Array.from({length: S.info.pageCount}, (_, i) => ({key: crypto.randomUUID(), source: 'current', page: i + 1, rotation: 0}));
    let selected = new Set([order[S.page - 1]?.key].filter(Boolean));
    let anchor = Math.max(0, S.page - 1), focusKey = order[anchor]?.key;
    let busy = false, closed = false;
    const history = [], future = [];
    const sources = []; // inserted documents sent with organize requests
    const docs = new Map(), owned = new Set(), boxes = new Map();
    const index = new Map(); // key -> position in order

    function setStatus(text) { statusLine.textContent = text; }
    function selectionText() {
      return `已选 ${selected.size} / ${order.length} 页 · 拖动排序 · 空格预览`;
    }
    function updateChrome() {
      if (!busy) setStatus(selectionText());
      q('[data-count]').textContent = `${order.length} 页`;
      q('[data-org=undo]').disabled = busy || !history.length;
      q('[data-org=redo]').disabled = busy || !future.length;
      const none = !selected.size;
      for (const id of ['delete', 'extract', 'copy', 'rotate', 'rotate-left', 'rotate-half', 'reverse', 'replace'])
        q(`[data-org="${id}"]`).disabled = busy || none;
      if (!busy && selected.size >= order.length) q('[data-org=delete]').disabled = true;
    }

    // ---- documents and geometry ---------------------------------------------------------
    async function loadDocument(id, data) {
      const loading = pdfjs.getDocument({...pdfLoadingOptions, data: data.slice()});
      try {
        docs.set(id, await loading.promise);
        owned.add(id);
        boxes.set(id, readPageBoxes(data).then(info => (boxes.set(id, info), info)));
      } catch (e) {
        await loading.destroy();
        throw e;
      }
    }
    async function pageOf(item) { return docs.get(item.source).getPage(item.page); }
    function viewInfo(page) {
      const [x0, y0, x1, y1] = page.view, box = {x: x0, y: y0, width: x1 - x0, height: y1 - y0};
      return {media: box, crop: box, rotation: page.rotate || 0, userUnit: page.userUnit || 1};
    }
    async function exactBoxes(source) {
      let value = boxes.get(source);
      if (!value) {
        // Page boxes of the open document are only needed for resize and crop; read them lazily.
        value = (async () => {
          const bytes = await exportPDF();
          try { return await readPageBoxes(bytes); } finally { if (bytes !== S.bytes) await releaseSource(bytes); }
        })().then(info => (boxes.set(source, info), info));
        boxes.set(source, value);
      }
      return value;
    }
    // Geometry for drawing. Untouched pages use PDF.js page info (CropBox ∩ MediaBox, /Rotate,
    // UserUnit), which equals the exact boxes for that case; resized or cropped pages wait for them.
    async function geometryOf(item, page) {
      if (item.blank) return organizerGeometry(item, null);
      if (!item.size && !item.crop) return organizerGeometry(item, viewInfo(page || await pageOf(item)));
      return organizerGeometry(item, (await exactBoxes(item.source))[item.page - 1]);
    }

    // ---- rasterization ------------------------------------------------------------------
    const bitmaps = new Map(), pendingBitmaps = new Map(), renderTasks = new Set();
    let rendering = 0;
    const renderQueue = [];
    function bitmapKey(item) { return item.source + ':' + item.page; }
    function takeBitmap(key) {
      const value = bitmaps.get(key);
      if (value) { bitmaps.delete(key); bitmaps.set(key, value); }
      return value;
    }
    function keepBitmap(key, value) {
      bitmaps.set(key, value);
      while (bitmaps.size > BITMAP_LIMIT) {
        const [oldest, old] = bitmaps.entries().next().value;
        bitmaps.delete(oldest);
        old.close?.();
      }
    }
    function sourceBitmap(item) {
      const key = bitmapKey(item), cached = takeBitmap(key);
      if (cached) return Promise.resolve(cached);
      if (pendingBitmaps.has(key)) return pendingBitmaps.get(key);
      const promise = new Promise((resolve, reject) => {
        renderQueue.push({item, resolve, reject});
        pumpRenders();
      }).finally(() => pendingBitmaps.delete(key));
      pendingBitmaps.set(key, promise);
      return promise;
    }
    function pumpRenders() {
      while (rendering < 2 && renderQueue.length) {
        const job = renderQueue.shift();
        rendering++;
        rasterize(job.item).then(job.resolve, job.reject).finally(() => { rendering--; pumpRenders(); });
      }
    }
    async function rasterize(item) {
      const page = await pageOf(item);
      if (closed) throw cancelled();
      const original = page.getViewport({scale: 1, rotation: 0});
      const viewport = page.getViewport({scale: raster / Math.max(original.width, original.height), rotation: 0});
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const task = page.render({canvasContext: canvas.getContext('2d'), viewport, background: 'rgba(0,0,0,0)'});
      renderTasks.add(task);
      try { await task.promise; } finally { renderTasks.delete(task); }
      const bitmap = await createImageBitmap(canvas);
      canvas.width = canvas.height = 0;
      if (closed) { bitmap.close(); throw cancelled(); }
      const value = {bitmap, page, close: () => bitmap.close()};
      keepBitmap(bitmapKey(item), value);
      return value;
    }
    const cancelled = () => Object.assign(Error('cancelled'), {name: 'RenderingCancelledException'});

    function marks() {
      if (!q('[data-marks]').checked) return undefined;
      return {
        kind: q('[data-mark-kind]').value, text: q('[data-mark-text]').value,
        size: Number(q('[data-mark-size]').value), color: q('[data-mark-color]').value,
        pages: order.flatMap((o, i) => selected.has(o.key) ? [i + 1] : []),
      };
    }
    // Draws one organized page into a canvas whose longest side is `size` pixels.
    function compose(canvas, item, g, source, size, mark, position) {
      const {width: w, height: h, rotation, sourceRect, destRect} = g, turned = rotation % 180 !== 0;
      const scale = size / Math.max(w, h);
      canvas.width = Math.ceil((turned ? h : w) * scale);
      canvas.height = Math.ceil((turned ? w : h) * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rotation * Math.PI / 180);
      ctx.scale(scale, scale);
      ctx.translate(-w / 2, -h / 2);
      const marked = mark?.pages.includes(position);
      if (marked && mark.kind === 'background') { ctx.fillStyle = mark.color; ctx.fillRect(0, 0, w, h); }
      if (source) {
        const b = source.bitmap;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
        ctx.drawImage(b, sourceRect[0] * b.width, sourceRect[1] * b.height, sourceRect[2] * b.width, sourceRect[3] * b.height, ...(destRect || [0, 0, w, h]));
        ctx.restore();
      }
      if (marked && mark.kind !== 'background') {
        ctx.fillStyle = mark.color;
        ctx.globalAlpha = mark.kind === 'watermark' ? .2 : 1;
        ctx.font = mark.size + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const y = mark.kind === 'header' ? 24 : mark.kind === 'watermark' ? h / 2 - mark.size : h - 24 - mark.size * 1.5;
        ctx.fillText(mark.text.replaceAll('{page}', String(position)).replaceAll('{pages}', String(order.length)), w / 2, y, Math.max(1, w - 48));
      }
    }

    // ---- tiles --------------------------------------------------------------------------
    const tiles = new Map(); // key -> {el, canvas, label, badge, sig, drawn}
    const drawnOffscreen = new Set();
    let generation = 0;
    function signature(item, position, mark) {
      const marked = mark?.pages.includes(position);
      return JSON.stringify([item.source, item.page, item.blank ? [item.width, item.height] : 0, item.rotation, item.size, item.resize, item.crop,
        marked ? [mark.kind, mark.text, mark.size, mark.color, position, order.length] : 0]);
    }
    function makeTile(item) {
      const el = document.createElement('div');
      el.className = 'organizer-page';
      el.setAttribute('role', 'option');
      el.tabIndex = -1;
      el.draggable = true;
      el.dataset.key = item.key;
      el.innerHTML = '<div class="organizer-paper"><canvas width="0" height="0"></canvas></div><span class="organizer-label"><b></b><em></em><em></em></span>';
      const [note, turn] = el.querySelectorAll('em');
      const tile = {el, canvas: el.querySelector('canvas'), number: el.querySelector('b'), note, turn, sig: '', visible: false};
      tiles.set(item.key, tile);
      observer.observe(el);
      return tile;
    }
    function describe(item) {
      if (item.blank) return '空白';
      if (item.source !== 'current') return '插入';
      if (item.size || item.crop) return '已调整';
      return '';
    }
    function paint() {
      generation++;
      index.clear();
      order.forEach((o, i) => index.set(o.key, i));
      for (const [key, tile] of tiles) if (!index.has(key)) {
        observer.unobserve(tile.el);
        tile.el.remove();
        tiles.delete(key);
        drawnOffscreen.delete(tile);
      }
      const mark = marks();
      // Moving a focused node with insertBefore blurs it; restore focus after reordering.
      const hadFocus = grid.contains(document.activeElement) ? document.activeElement : null;
      let node = grid.firstElementChild;
      order.forEach((item, i) => {
        const tile = tiles.get(item.key) || makeTile(item), el = tile.el, position = i + 1;
        if (el === node) node = node.nextElementSibling;
        else if (el.isConnected && grid.moveBefore) grid.moveBefore(el, node);
        else grid.insertBefore(el, node);
        if (el.dataset.position !== String(position)) el.dataset.position = position;
        tile.number.textContent = position;
        tile.note.textContent = describe(item);
        tile.turn.textContent = item.rotation ? `${item.rotation}°` : '';
        el.setAttribute('aria-label', `第 ${position} 页${item.blank ? ' · 空白页' : ` · 来源第 ${item.page} 页`}`);
        el.setAttribute('aria-selected', String(selected.has(item.key)));
        el.tabIndex = item.key === focusKey ? 0 : -1;
        const sig = signature(item, position, mark);
        if (sig !== tile.sig) {
          tile.sig = sig;
          delete el.dataset.rendered;
          if (tile.visible) draw(tile, item, position, mark);
        }
      });
      if (!tiles.has(focusKey) && order.length) { focusKey = order[Math.min(anchor, order.length - 1)].key; tiles.get(focusKey).el.tabIndex = 0; }
      if (hadFocus && document.activeElement !== hadFocus)
        (hadFocus.isConnected ? hadFocus : tiles.get(focusKey)?.el)?.focus({preventScroll: true});
      updateChrome();
    }
    async function draw(tile, item, position, mark) {
      const sig = tile.sig, gen = generation;
      try {
        const source = item.blank ? null : await sourceBitmap(item);
        const g = await geometryOf(item, source?.page);
        if (closed || tile.sig !== sig || !tile.el.isConnected) return;
        // Position or marks may have moved while rendering; compose with the latest values.
        const now = gen === generation ? position : index.get(item.key) + 1;
        compose(tile.canvas, item, g, source, raster, gen === generation ? mark : marks(), now);
        tile.el.dataset.rendered = 'true';
        if (!tile.visible) retire(tile);
      } catch (e) {
        if (!closed && e.name !== 'RenderingCancelledException') setStatus(e.message);
      }
    }
    function retire(tile) {
      drawnOffscreen.add(tile);
      if (drawnOffscreen.size <= CANVAS_LIMIT) return;
      const [old] = drawnOffscreen;
      drawnOffscreen.delete(old);
      old.canvas.width = old.canvas.height = 0;
      old.sig = '';
      delete old.el.dataset.rendered;
    }
    const observer = new IntersectionObserver(entries => {
      const mark = entries.some(e => e.isIntersecting) ? marks() : undefined;
      for (const {target, isIntersecting} of entries) {
        const tile = tiles.get(target.dataset.key);
        if (!tile) continue;
        tile.visible = isIntersecting;
        if (!isIntersecting) { if (target.dataset.rendered) retire(tile); continue; }
        drawnOffscreen.delete(tile);
        if (!target.dataset.rendered) {
          const i = index.get(target.dataset.key);
          tile.sig = signature(order[i], i + 1, mark);
          draw(tile, order[i], i + 1, mark);
        }
      }
    }, {root: grid, rootMargin: '300px 0px'});

    // ---- selection ----------------------------------------------------------------------
    function refreshSelection() {
      for (const [key, tile] of tiles) {
        const value = String(selected.has(key));
        if (tile.el.getAttribute('aria-selected') !== value) tile.el.setAttribute('aria-selected', value);
      }
      if (q('[data-marks]').checked) paint(); else updateChrome();
    }
    function focusTile(i) {
      const item = order[i];
      if (!item) return;
      tiles.get(focusKey)?.el.setAttribute('tabindex', '-1');
      focusKey = item.key;
      const el = tiles.get(item.key).el;
      el.tabIndex = 0;
      el.focus({preventScroll: true});
      el.scrollIntoView({block: 'nearest'});
    }
    function choose(i, e = {}) {
      if (busy || !order[i]) return;
      const key = order[i].key;
      if (e.shiftKey) {
        if (!(e.ctrlKey || e.metaKey)) selected.clear();
        for (let n = Math.min(anchor, i); n <= Math.max(anchor, i); n++) selected.add(order[n].key);
      } else if (e.ctrlKey || e.metaKey) {
        selected.has(key) ? selected.delete(key) : selected.add(key);
        anchor = i;
      } else {
        selected = new Set([key]);
        anchor = i;
      }
      refreshSelection();
    }
    function selectWhere(test) { selected = new Set(order.filter(test).map(o => o.key)); refreshSelection(); }
    function columns() {
      const first = grid.firstElementChild;
      if (!first) return 1;
      const top = first.offsetTop;
      let n = 0;
      for (let el = first; el && el.offsetTop === top; el = el.nextElementSibling) n++;
      return Math.max(1, n);
    }

    // ---- edits --------------------------------------------------------------------------
    const snapshot = () => ({order: structuredClone(order), selected: [...selected]});
    function change(fn) {
      if (busy) return;
      history.push(snapshot());
      if (history.length > 80) history.shift();
      future.length = 0;
      fn();
      paint();
    }
    function restore(value) { order = value.order; selected = new Set(value.selected); paint(); }
    const selectedOrder = () => order.filter(o => selected.has(o.key));
    function insertionPoint() {
      const positions = order.flatMap((o, i) => selected.has(o.key) ? [i] : []);
      if (!positions.length) return order.length;
      return q('[data-insert-position]').value === 'before' ? Math.min(...positions) : Math.max(...positions) + 1;
    }
    function moveSelection(at) {
      const moving = selectedOrder();
      const before = order.slice(0, at).filter(o => !selected.has(o.key)).length;
      order = order.filter(o => !selected.has(o.key));
      order.splice(before, 0, ...moving);
    }
    function rotate(angle) { change(() => { order = order.map(o => selected.has(o.key) ? {...o, rotation: (o.rotation + angle) % 360} : o); }); }

    const controls = () => d.querySelectorAll('header button, .organizer-controls :is(button,input,select), footer button');
    const perform = fn => async () => {
      if (busy) return;
      busy = true;
      grid.inert = true;
      for (const el of controls()) el.disabled = true;
      setStatus('正在处理…');
      try {
        session.assert(capture);
        await fn();
        if (!closed && statusLine.textContent === '正在处理…') setStatus(selectionText());
      } catch (e) {
        if (!closed) setStatus(e.message);
      } finally {
        busy = false;
        grid.inert = false;
        for (const el of controls()) el.disabled = false;
        if (!closed) { const text = statusLine.textContent; updateChrome(); setStatus(text); }
      }
    };
    const message = text => () => setStatus(text);

    // Adds pages from files (picker or drop). Replacing swaps them for the selected pages.
    async function addFiles(files, {replace = false, at} = {}) {
      const added = [], range = q('[data-source-range]').value.trim();
      for (const file of files) {
        session.assert(capture);
        const result = await nativeRequest({command: 'document-assemble', bytes: S.bytes, parts: [{name: file.name, data: toBase64(new Uint8Array(file.bytes))}]});
        session.assert(capture);
        const data = fromBase64(result.bytes), id = crypto.randomUUID();
        await loadDocument(id, data);
        const pdf = docs.get(id);
        sources.push({id, name: file.name.replace(/\.[^.]+$/, '.pdf'), data: result.bytes});
        const pages = replace && range ? pageRange(range, pdf.numPages) : Array.from({length: pdf.numPages}, (_, i) => i + 1);
        for (const page of pages) added.push({key: crypto.randomUUID(), source: id, page, rotation: 0,
          ...(replace ? {copyAnnotations: q('[data-replace-annots]').checked, copyForms: q('[data-replace-forms]').checked} : {})});
      }
      if (!added.length) return;
      const targets = selectedOrder(), pair = replace && q('[data-replace-pair]').checked;
      if (replace && !targets.length) throw Error('请选择要替换的目标页面');
      if (pair && targets.length !== added.length) throw Error('逐页替换要求来源和目标页数相同');
      if (replace) for (let i = 0; i < Math.min(targets.length, added.length); i++) {
        added[i].replaces = {source: targets[i].source, page: targets[i].page};
        added[i].keepTargetAnnotations = q('[data-replace-keep]').checked;
        if (q('[data-replace-fit]').checked) {
          added[i].size = (await geometryOf(targets[i])).displayedSize;
          added[i].resize = {keepAspect: true, canvasOnly: false};
        }
      }
      history.push(snapshot());
      future.length = 0;
      if (pair) {
        let n = 0;
        order = order.map(o => selected.has(o.key) ? added[n++] : o);
      } else {
        let position = replace ? order.findIndex(o => selected.has(o.key)) : at ?? insertionPoint();
        if (position < 0) position = order.length;
        if (replace) order = order.filter(o => !selected.has(o.key));
        order.splice(position, 0, ...added);
      }
      selected = new Set(added.map(o => o.key));
      anchor = index.get(added[0].key) ?? anchor;
      paint();
      focusTile(order.findIndex(o => o.key === added[0].key));
    }
    const pickAndAdd = replace => perform(async () => {
      const picked = await window.desktop.mergeFiles();
      if (!picked.length) return;
      await addFiles(picked, {replace});
    });
    const save = (entries, filename) => run({action: 'organize-pages', filename, options: {order: clean(entries), sources, marks: entries === order ? marks() : undefined}});
    const clean = entries => entries.map(({key, ...e}) => e);

    q('[data-org=insert]').onclick = pickAndAdd(false);
    q('[data-org=replace]').onclick = pickAndAdd(true);
    q('[data-org=blank]').onclick = async () => {
      if (busy) return;
      try {
        const positions = order.flatMap((o, i) => selected.has(o.key) ? [i] : []);
        const currentPage = (positions[0] ?? Math.max(0, Math.min(order.length - 1, S.page - 1))) + 1;
        const plan = await chooseBlankPages({pageCount: order.length, currentPage, position: q('[data-insert-position]').value,
          getSize: async number => (await geometryOf(order[number - 1])).displayedSize});
        if (!plan || closed) return;
        session.assert(capture);
        change(() => {
          const added = Array.from({length: plan.count}, () => ({key: crypto.randomUUID(), blank: true, width: plan.width, height: plan.height, rotation: 0}));
          order.splice(plan.at, 0, ...added);
          selected = new Set(added.map(o => o.key));
          anchor = plan.at;
        });
        tiles.get(order[plan.at]?.key)?.el.scrollIntoView({block: 'nearest'});
      } catch (e) {
        if (!closed) setStatus(e.message);
      }
    };
    q('[data-org=delete]').onclick = () => {
      if (!selected.size) return;
      if (selected.size >= order.length) { setStatus('请至少保留一页'); return; }
      const first = order.findIndex(o => selected.has(o.key));
      change(() => { order = order.filter(o => !selected.has(o.key)); selected.clear(); });
      if (order.length) { anchor = Math.min(first, order.length - 1); focusTile(anchor); }
    };
    q('[data-org=copy]').onclick = () => change(() => {
      const added = selectedOrder().map(o => ({...o, key: crypto.randomUUID()}));
      order.splice(insertionPoint(), 0, ...added);
      selected = new Set(added.map(o => o.key));
    });
    q('[data-org=rotate]').onclick = () => rotate(90);
    q('[data-org=rotate-left]').onclick = () => rotate(270);
    q('[data-org=rotate-half]').onclick = () => rotate(180);
    q('[data-org=reverse]').onclick = () => change(() => {
      const reversed = selectedOrder().reverse();
      order = order.map(o => selected.has(o.key) ? reversed.shift() : o);
    });
    for (const action of ['undo', 'redo']) q(`[data-org=${action}]`).onclick = () => {
      const from = action === 'undo' ? history : future, to = action === 'undo' ? future : history;
      if (!busy && from.length) { to.push(snapshot()); restore(from.pop()); }
    };
    q('[data-org=extract]').onclick = perform(async () => {
      if (!selected.size) throw Error('请选择要提取的页面');
      const r = await save(selectedOrder());
      message(r.saved ? '已提取选中页面，原文档保持不变。' : '已取消保存')();
    });
    q('[data-apply]').onclick = perform(async () => {
      if (!history.length && !q('[data-marks]').checked) { setStatus('页面顺序尚无更改'); return; }
      if (!replaceDocument) throw Error('当前环境不支持应用到当前文档，请使用“另存为新 PDF”');
      const r = await run({action: 'organize-pages', apply: true, options: {order: clean(order), sources, marks: marks()}});
      session.assert(capture);
      if (!r?.data) throw Error('整理失败，文档未改动');
      dispose();
      await replaceDocument(r.data);
    });
    q('[data-save]').onclick = perform(async () => {
      const r = await save(order);
      message(r.saved ? '整理结果已保存，包含当前 PDF 的全部已应用编辑。' : '已取消保存')();
    });
    q('[data-split]').onclick = perform(async () => {
      const size = Number(q('[data-split-size]').value);
      if (!Number.isInteger(size) || size < 1 || Math.ceil(order.length / size) > 100) throw Error('请设置有效份数，每次最多 100 份');
      let count = 0;
      for (let i = 0; i < order.length; i += size) {
        const r = await save(order.slice(i, i + size), S.name.replace(/\.pdf$/i, '') + '-part-' + String(count + 1).padStart(3, '0') + '.pdf');
        if (!r.saved) break;
        count++;
      }
      message(`已保存 ${count} 份`)();
    });
    q('[data-resize]').onclick = () => {
      const size = [Number(q('[data-width]').value), Number(q('[data-height]').value)];
      if (!size.every(v => Number.isFinite(v) && v > 0)) { setStatus('请输入有效的页面尺寸'); return; }
      change(() => {
        const resize = {keepAspect: q('[data-size-aspect]').checked, canvasOnly: q('[data-size-canvas]').checked};
        order = order.map(o => selected.has(o.key) ? {...o, size, resize} : o);
      });
    };
    q('[data-crop-apply]').onclick = () => {
      const crop = q('[data-crop]').value.split(',').map(Number);
      if (crop.length !== 4 || !crop.every(v => Number.isFinite(v) && v >= 0)) { setStatus('请输入四个非负边距'); return; }
      change(() => { order = order.map(o => selected.has(o.key) ? {...o, crop} : o); });
    };
    q('[data-size-preset]').onchange = e => {
      if (!e.target.value) return;
      const [w, h] = e.target.value.split(',');
      q('[data-width]').value = w;
      q('[data-height]').value = h;
    };
    for (const el of d.querySelectorAll('[data-select-mode]')) el.onclick = () => {
      const mode = el.dataset.selectMode;
      selectWhere((o, i) => mode === 'all' || (mode === 'odd' && i % 2 === 0) || (mode === 'even' && i % 2 === 1));
    };
    const selectRange = () => {
      const value = q('[data-range]').value.trim();
      if (!value) return;
      try {
        const pages = new Set(pageRange(value, order.length));
        selectWhere((_, i) => pages.has(i + 1));
        const first = order.findIndex(o => selected.has(o.key));
        if (first >= 0) { anchor = first; focusTile(first); }
      } catch (e) { setStatus(e.message); }
    };
    q('[data-range-select]').onclick = selectRange;
    q('[data-range]').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); selectRange(); } };
    for (const input of d.querySelectorAll('[data-marks],[data-mark-kind],[data-mark-text],[data-mark-size],[data-mark-color]'))
      input.addEventListener(input.matches('[data-mark-text]') ? 'input' : 'change', () => { if (!busy) paint(); });

    // Only one options popover open at a time; clicking elsewhere closes it.
    const popovers = [...d.querySelectorAll('.organizer-options')];
    for (const p of popovers) p.addEventListener('toggle', () => { if (p.open) for (const other of popovers) if (other !== p) other.open = false; });
    d.addEventListener('pointerdown', e => { for (const p of popovers) if (p.open && !p.contains(e.target)) p.open = false; });

    // ---- grid interaction (delegated) ---------------------------------------------------
    const tileIndex = target => {
      const el = target.closest?.('.organizer-page');
      return el ? index.get(el.dataset.key) : undefined;
    };
    grid.addEventListener('click', e => {
      const i = tileIndex(e.target);
      if (i === undefined) return;
      choose(i, e);
      focusTile(i);
    });
    grid.addEventListener('dblclick', e => { const i = tileIndex(e.target); if (i !== undefined) peek(i); });
    grid.addEventListener('keydown', e => {
      const i = index.get(focusKey);
      if (i === undefined || busy || !peekLayer.hidden) return;
      const step = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns(), ArrowDown: columns()}[e.key];
      if (step !== undefined && e.altKey) {
        // Alt+arrow moves the selected pages, a keyboard alternative to dragging.
        e.preventDefault();
        if (!selected.has(focusKey)) choose(i);
        const positions = order.flatMap((o, n) => selected.has(o.key) ? [n] : []);
        const target = step < 0 ? Math.max(0, positions[0] + step) : Math.min(order.length, positions.at(-1) + 1 + step);
        change(() => moveSelection(target));
        focusTile(index.get(focusKey));
        return;
      }
      let next;
      if (step !== undefined) next = i + step;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = order.length - 1;
      else if (e.key === 'PageDown' || e.key === 'PageUp') {
        const rows = Math.max(1, Math.floor(grid.clientHeight / (tiles.get(focusKey).el.offsetHeight || 1)));
        next = i + (e.key === 'PageDown' ? 1 : -1) * rows * columns();
      } else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); peek(i); return; }
      else return;
      e.preventDefault();
      next = Math.max(0, Math.min(order.length - 1, next));
      if (e.shiftKey || !(e.ctrlKey || e.metaKey)) choose(next, e);
      focusTile(next);
    });

    // Drag to reorder; drop PDF or image files from Explorer to insert them at that position.
    let dropTile = null;
    const clearDrop = () => { if (dropTile) delete dropTile.dataset.drop; dropTile = null; };
    const dropSide = (el, e) => e.clientX < el.getBoundingClientRect().left + el.offsetWidth / 2 ? 'before' : 'after';
    grid.addEventListener('dragstart', e => {
      const i = tileIndex(e.target);
      if (busy || i === undefined) { e.preventDefault(); return; }
      if (!selected.has(order[i].key)) choose(i, e);
      e.dataTransfer.setData(DRAG_TYPE, '1');
      e.dataTransfer.setData('text/plain', 'folio-pages');
      e.dataTransfer.effectAllowed = 'move';
      grid.dataset.dragging = String(selected.size);
    });
    grid.addEventListener('dragend', () => { delete grid.dataset.dragging; clearDrop(); });
    grid.addEventListener('dragover', e => {
      const types = e.dataTransfer.types, files = types.includes('Files');
      if (busy || !(files || types.includes(DRAG_TYPE) || types.includes('text/plain'))) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = files ? 'copy' : 'move';
      const el = e.target.closest('.organizer-page') || (files ? grid.lastElementChild : null);
      if (el !== dropTile) clearDrop();
      if (!el) return;
      dropTile = el;
      el.dataset.drop = e.target.closest('.organizer-page') ? dropSide(el, e) : 'after';
    });
    grid.addEventListener('dragleave', e => { if (!grid.contains(e.relatedTarget)) clearDrop(); });
    grid.addEventListener('drop', e => {
      e.preventDefault();
      const el = dropTile, side = el?.dataset.drop;
      clearDrop();
      delete grid.dataset.dragging;
      if (!el || busy) return;
      const at = index.get(el.dataset.key) + (side === 'after' ? 1 : 0);
      if (e.dataTransfer.files.length) {
        const files = [...e.dataTransfer.files];
        perform(async () => addFiles(await Promise.all(files.map(async f => ({name: f.name, bytes: await f.arrayBuffer()}))), {at}))();
        return;
      }
      if (e.dataTransfer.getData('text/plain') !== 'folio-pages' || selected.has(el.dataset.key)) return;
      change(() => moveSelection(at));
    });

    // Marquee selection from empty grid space.
    const marqueeBox = document.createElement('div');
    marqueeBox.className = 'organizer-marquee';
    marqueeBox.hidden = true;
    d.append(marqueeBox);
    let marquee = null, frame = 0;
    grid.addEventListener('pointerdown', e => {
      if (e.target.closest('.organizer-page') || busy || e.button !== 0) return;
      const origin = grid.getBoundingClientRect();
      // Tile rectangles in grid-content coordinates; stable while the pointer is down.
      const rects = order.map(o => {
        const el = tiles.get(o.key).el;
        return [o.key, el.offsetLeft, el.offsetTop, el.offsetLeft + el.offsetWidth, el.offsetTop + el.offsetHeight];
      });
      marquee = {x: e.clientX - origin.left + grid.scrollLeft, y: e.clientY - origin.top + grid.scrollTop, origin, rects,
        base: e.ctrlKey || e.metaKey ? new Set(selected) : new Set(), point: null};
      grid.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    grid.addEventListener('pointermove', e => {
      if (!marquee) return;
      marquee.point = [e.clientX, e.clientY];
      frame ||= requestAnimationFrame(updateMarquee);
    });
    function updateMarquee() {
      frame = 0;
      if (!marquee?.point) return;
      const {origin, rects} = marquee, [cx, cy] = marquee.point;
      // Scroll while dragging near the top or bottom edge.
      if (cy < origin.top + 24) grid.scrollTop -= 18; else if (cy > origin.bottom - 24) grid.scrollTop += 18;
      const x = cx - origin.left + grid.scrollLeft, y = cy - origin.top + grid.scrollTop;
      const left = Math.min(x, marquee.x), right = Math.max(x, marquee.x), top = Math.min(y, marquee.y), bottom = Math.max(y, marquee.y);
      Object.assign(marqueeBox.style, {
        left: origin.left + left - grid.scrollLeft + 'px', top: origin.top + top - grid.scrollTop + 'px',
        width: right - left + 'px', height: bottom - top + 'px',
      });
      marqueeBox.hidden = false;
      selected = new Set(marquee.base);
      for (const [key, l, t, r, b] of rects) if (l < right && r > left && t < bottom && b > top) selected.add(key);
      refreshSelection();
      if (cy < origin.top + 24 || cy > origin.bottom - 24) frame = requestAnimationFrame(updateMarquee);
    }
    const endMarquee = () => { marquee = null; marqueeBox.hidden = true; cancelAnimationFrame(frame); frame = 0; };
    grid.addEventListener('pointerup', endMarquee);
    grid.addEventListener('pointercancel', endMarquee);

    // Thumbnail size: slider or Ctrl+wheel.
    const zoom = q('[data-zoom]');
    zoom.oninput = () => grid.style.setProperty('--thumb', zoom.value + 'px');
    grid.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom.value = Math.max(+zoom.min, Math.min(+zoom.max, +zoom.value - Math.sign(e.deltaY) * 20));
      zoom.oninput();
    }, {passive: false});

    // ---- quick look ---------------------------------------------------------------------
    const peekLayer = q('.organizer-peek');
    let peekAt = -1, peekToken = 0;
    async function peek(i) {
      const item = order[i];
      if (!item) return;
      peekAt = i;
      const token = ++peekToken;
      peekLayer.hidden = false;
      peekLayer.querySelector('figcaption').textContent = `第 ${i + 1} / ${order.length} 页`;
      const canvas = peekLayer.querySelector('canvas'), box = peekLayer.getBoundingClientRect();
      const size = Math.round(Math.min(box.width - 96, box.height - 96) * dpr);
      try {
        let source = null;
        if (!item.blank) {
          // Render at viewing size rather than reusing the small thumbnail bitmap.
          const page = await pageOf(item), original = page.getViewport({scale: 1, rotation: 0});
          const viewport = page.getViewport({scale: size / Math.max(original.width, original.height), rotation: 0});
          const c = document.createElement('canvas');
          c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
          const task = page.render({canvasContext: c.getContext('2d'), viewport, background: 'rgba(0,0,0,0)'});
          renderTasks.add(task);
          try { await task.promise; } finally { renderTasks.delete(task); }
          source = {bitmap: c, page};
        }
        if (token !== peekToken || peekLayer.hidden) return;
        compose(canvas, item, await geometryOf(item, source?.page), source, size, marks(), i + 1);
        canvas.style.width = canvas.width / dpr + 'px';
        canvas.style.height = canvas.height / dpr + 'px';
      } catch (e) {
        if (e.name !== 'RenderingCancelledException') setStatus(e.message);
      }
    }
    function closePeek() {
      peekLayer.hidden = true;
      peekToken++;
      if (peekAt >= 0) focusTile(peekAt);
      peekAt = -1;
    }
    peekLayer.addEventListener('click', e => { if (!e.target.closest('canvas')) closePeek(); });

    // ---- dialog lifecycle ---------------------------------------------------------------
    function dispose() {
      closed = true;
      endMarquee();
      peekToken++;
      observer.disconnect();
      for (const t of renderTasks) t.cancel();
      for (const value of bitmaps.values()) value.close?.();
      bitmaps.clear();
      for (const id of owned) docs.get(id)?.destroy();
      d.close();
      d.remove();
    }
    const close = () => { if (!busy) dispose(); };
    q('[data-close]').onclick = close;
    d.oncancel = e => {
      e.preventDefault();
      if (!peekLayer.hidden) { closePeek(); return; }
      const open = popovers.find(p => p.open);
      if (open) { open.open = false; return; }
      close();
    };
    d.addEventListener('keydown', e => {
      if (!peekLayer.hidden) {
        if (e.key === ' ' || e.key === 'Escape') { e.preventDefault(); closePeek(); }
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          e.preventDefault();
          const next = Math.max(0, Math.min(order.length - 1, peekAt + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1)));
          choose(next);
          peek(next);
        }
        return;
      }
      if (e.target.matches('input,select,textarea')) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); q('[data-org=delete]').click(); }
      else if (mod && k === 'a') { e.preventDefault(); selectWhere(() => true); }
      else if (mod && k === 'd') { e.preventDefault(); q('[data-org=copy]').click(); }
      else if (mod && k === 'z') { e.preventDefault(); q(e.shiftKey ? '[data-org=redo]' : '[data-org=undo]').click(); }
      else if (mod && k === 'y') { e.preventDefault(); q('[data-org=redo]').click(); }
      else if (mod && (e.key === ']' || e.key === '[')) { e.preventDefault(); rotate(e.key === ']' ? 90 : 270); }
    });

    // ---- start --------------------------------------------------------------------------
    await perform(async () => {
      if (typeof S.pdf.getPage === 'function') docs.set('current', S.pdf);
      else {
        const bytes = await exportPDF();
        try { session.assert(capture); await loadDocument('current', bytes); }
        finally { if (bytes !== S.bytes) await releaseSource(bytes); }
      }
      paint();
      tiles.get(focusKey)?.el.scrollIntoView({block: 'center'});
    })();
    if (initialAction === 'blank' && !closed && docs.has('current')) await q('[data-org=blank]').onclick();
  }
}

function template() {
  const button = (id, i, label, extra = '') => `<button type="button" data-org="${id}" title="${label}"${extra}>${icon(i)}<span>${label}</span></button>`;
  const iconButton = (id, i, label, keys) => `<button type="button" class="icon-only" data-org="${id}" title="${label}${keys ? ' ' + keys : ''}" aria-label="${label}">${icon(i)}<span>${label}</span></button>`;
  return `<header>
  <div class="organizer-title"><h2>组织页面</h2><span data-count></span></div>
  <div class="organizer-actions" role="toolbar" aria-label="页面组织">
    <div class="organizer-group">${button('insert', 'insert-page', '插入')}${button('blank', 'new-page', '空白页')}${button('replace', 'replace-page', '替换')}${button('extract', 'extract-page', '提取')}${button('copy', 'copy', '复制')}</div>
    <div class="organizer-group">${iconButton('rotate-left', 'rotate-left', '逆时针', 'Ctrl+[')}${iconButton('rotate', 'rotate', '顺时针', 'Ctrl+]')}${iconButton('rotate-half', 'rotate-half', '180°')}${button('reverse', 'reverse', '逆序')}</div>
    <div class="organizer-group">${button('delete', 'trash', '删除', ' class="danger"')}</div>
    <div class="organizer-group">${iconButton('undo', 'undo', '撤销', 'Ctrl+Z')}${iconButton('redo', 'redo', '重做', 'Ctrl+Y')}</div>
  </div>
  <button type="button" data-close aria-label="关闭">${icon('close')}</button>
</header>
<div class="organizer-controls">
  <div class="organizer-select" role="group" aria-label="选择页面">
    <span>选择</span>
    <div class="organizer-segment"><button type="button" data-select-mode="all">全部</button><button type="button" data-select-mode="odd">奇数</button><button type="button" data-select-mode="even">偶数</button><button type="button" data-select-mode="none">无</button></div>
    <input data-range aria-label="按页码选择" placeholder="页码，如 1-5, 8"><button type="button" data-range-select>选择</button>
  </div>
  <label class="organizer-position"><select data-insert-position aria-label="插入位置"><option value="after">插入到选中页之后</option><option value="before">插入到选中页之前</option></select></label>
  <div class="organizer-popovers">
    <details class="organizer-options"><summary>页面设置</summary><div>
      <p>应用到选中页面</p>
      <label>预设<select data-size-preset><option value="">自定义</option><option value="595.276,841.89">A4</option><option value="841.89,1190.551">A3</option><option value="419.528,595.276">A5</option><option value="612,792">Letter</option></select></label>
      <div class="form-grid"><label>宽度 pt<input data-width type="number" value="595.28" min="1"></label><label>高度 pt<input data-height type="number" value="841.89" min="1"></label></div>
      <label><input data-size-aspect type="checkbox">保持内容纵横比，居中</label>
      <label><input data-size-canvas type="checkbox">仅调整纸张，不缩放内容</label>
      <button type="button" data-resize>缩放到此尺寸</button>
      <hr>
      <label>裁剪边距 pt（左、上、右、下）<input data-crop value="0,0,0,0"></label>
      <button type="button" data-crop-apply>应用裁剪</button>
    </div></details>
    <details class="organizer-options"><summary>页面标记</summary><div>
      <label>类型<select data-mark-kind><option value="footer">页脚 / 页码</option><option value="header">页眉</option><option value="watermark">水印</option><option value="background">背景色</option></select></label>
      <label>文字（{page} / {pages}）<input data-mark-text value="{page} / {pages}"></label>
      <div class="form-grid"><label>字号<input data-mark-size type="number" value="12" min="1"></label><label>颜色<input data-mark-color type="color" value="#667085"></label></div>
      <label><input data-marks type="checkbox">输出时应用到选中页面</label>
    </div></details>
    <details class="organizer-options"><summary>拆分</summary><div>
      <label>每份页数<input data-split-size type="number" min="1" value="1"></label>
      <button type="button" data-split>按当前顺序拆分保存…</button>
    </div></details>
    <details class="organizer-options"><summary>替换选项</summary><div>
      <label>来源页码（留空全部）<input data-source-range placeholder="1-5,8"></label>
      <label><input data-replace-keep type="checkbox">保留目标页批注 / 表单</label>
      <label><input data-replace-annots type="checkbox" checked>复制来源批注</label>
      <label><input data-replace-forms type="checkbox" checked>复制来源表单</label>
      <label><input data-replace-fit type="checkbox">匹配目标页面尺寸</label>
      <label><input data-replace-pair type="checkbox">逐页配对替换（页数须相同）</label>
    </div></details>
  </div>
  <label class="organizer-zoom" title="缩略图大小 · Ctrl+滚轮">${icon('thumbs')}<input data-zoom aria-label="缩略图大小" type="range" min="100" max="${THUMB_MAX}" step="10" value="160"></label>
</div>
<div class="organizer-body">
  <div class="organizer-grid" role="listbox" aria-label="页面缩略图" aria-multiselectable="true" tabindex="-1" data-file-drop></div>
  <figure class="organizer-peek" hidden><canvas></canvas><figcaption></figcaption></figure>
</div>
<footer>
  <p data-status role="status"></p>
  <span class="organizer-hint">可从资源管理器拖入 PDF 或图片插入</span>
  <button type="button" data-save>另存为新 PDF…</button>
  <button type="button" class="primary" data-apply title="把当前页面顺序、旋转、插入与删除应用到正在编辑的文档（保存前可继续修改；撤销历史将重置）">应用到当前文档</button>
</footer>`;
}

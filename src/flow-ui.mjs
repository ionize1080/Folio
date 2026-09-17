import { fontLabel } from "./font-label.mjs";
import { joinModels, splitModel, unionFrames } from "./flow-structure.mjs";
import { editStyles, rangeStyle } from "./flow-style.mjs";
import { icons } from "./icons.mjs";
import {
  pageCandidates,
  flowConflicts,
  growthLimit,
  horizontalLimit,
  suggestGrowth,
  frameBounds,
  hitOffset,
  caretRect,
} from "./flow-page-model.mjs";

const previewFontCache = new Map();
let fontCatalogPromise = null;
let fontPreviewQueue = Promise.resolve();

// The hidden native input owns IME / clipboard. MuPDF's vector page owns every
// visible glyph, line break, caret and selection. No popup editor / HTML reflow.
export function installFlowUI(ctx) {
  const { S, surface, commit, refreshNative, guarded, toast, clone } = ctx;
  let session = null,
    opening = false,
    openingEpoch = 0;
  const $ = (s) => document.querySelector(s);
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const imageURL = (svg) => "data:image/svg+xml;base64," + b64(svg);
  const call = (command, options = {}) =>
    window.desktop.native({ command, ...(!command.startsWith("font-") ? { bytes: S.bytes } : {}), ...options });
  async function start() {
    if (session) {
      const samePage = session.page === S.page;
      await session.finish(true);
      if (samePage) return;
    }
    if (opening || !S.pdf) return;
    if (!window.desktop?.flowLayout) throw Error("页面编辑需要完整桌面运行包");
    const page = S.page,
      info = S.info.pages[page - 1];
    if (
      surface.rotation(page) % 360 ||
      info.userUnit !== 1 ||
      info.box.x !== 0 ||
      info.box.y !== 0
    )
      throw Error("此页旋转或坐标单位暂不支持页面编辑，请使用未旋转原页");
    opening = true;
    toast("正在识别当前页的文字与版面…");
    const source = S.bytes,
      request = ++openingEpoch;
    try {
      const result = await call("inspect", { page });
      const ai = { regions: [], pending: true };
      if (source !== S.bytes || page !== S.page || request !== openingEpoch) {
        toast("页面已切换，请在当前页重新进入编辑");
        return;
      }
      const [w, h] = result.size;
      session = createSession({ page, w, h, result, ai, source });
      S.flowEdit = session;
      await session.mount();
      const active = session;
      call("layout", { page })
        .then((r) => active.updateAI(r))
        .catch((e) => active.updateAI({ regions: [], error: e.message }));
      if (S.pendingFlowDraft?.page === page) {
        const saved = S.pendingFlowDraft;
        S.pendingFlowDraft = null;
        await session.restoreDraft(saved);
      }
    } catch (e) {
      session?.destroy();
      session = null;
      S.flowEdit = null;
      toast("未能打开页面编辑：" + e.message);
      throw e;
    } finally {
      opening = false;
    }
  }
  function createSession({ page, w, h, result, ai, source }) {
    let model = null,
      id = null,
      initial = null,
      preview = null,
      revision = 0,
      validRevision = -1;
    let running = null,
      timer = null,
      composing = false,
      closed = false,
      busy = false,
      background = null,
      backgroundTask = null,
      backgroundSerial = 0,
      backgroundTimer = null,
      pointerAnchor = 0;
    let pendingHistory = false,
      history = [],
      future = [],
      candidates = pageCandidates(
        result.objects,
        w,
        h,
        ai.regions,
        result.tables || [],
      ),
      newMode = false,
      linkMode = false;
    const bar = document.createElement("div");
    bar.className = "page-edit-bar";
    bar.innerHTML = `<div class="pe-primary"><strong>页面编辑</strong><button id="pe-font" title="选择字体">原文样式</button><label>字号 <input id="pe-size" type="number" min="4" max="150" step="0.5" value="12"></label><button id="pe-bold" title="粗体">B</button><button id="pe-italic" title="斜体"><i>I</i></button><input id="pe-color" type="color" value="#202020" aria-label="文字颜色"><select id="pe-align" aria-label="对齐"><option value="left">左对齐</option><option value="justify">两端对齐</option><option value="center">居中</option><option value="right">右对齐</option></select><button id="pe-more" aria-expanded="false"><i data-icon="sliders"></i>格式</button></div><div class="pe-actions"><button id="pe-cancel">取消本段</button><button id="pe-done" class="primary">完成编辑</button></div><aside class="pe-properties" hidden><div class="pe-panel-heading"><strong>文字与布局</strong><button id="pe-close-properties" aria-label="关闭格式面板">×</button></div><div class="pe-properties-grid"><label>排版方式<select id="pe-layout-mode"><option value="preserve">优先保留原字位</option><option value="reflow">重新排版整段</option></select></label><label>字距（pt）<input id="pe-spacing" type="number" min="-2" max="10" step="0.1" value="0"></label><label>行距（倍）<input id="pe-leading" type="number" min="1" max="3" step="0.1" value="1.4"></label><label>分栏<select id="pe-columns"><option value="1">单栏</option><option value="2">双栏续排</option><option value="3">三栏续排</option></select></label><label>首行缩进（pt）<input id="pe-indent" type="number" min="0" step="0.5" value="0"></label><label>段前距（pt）<input id="pe-before" type="number" min="0" max="100" value="0"></label><label>段后距（pt）<input id="pe-after" type="number" min="0" max="100" value="0"></label><label>扩展方向<select id="pe-growth"><option value="auto">自动预选</option><option value="down">向下</option><option value="right">向右</option><option value="fixed">固定文本框</option></select></label></div><p id="pe-growth-reason"></p><details class="pe-position"><summary>位置与尺寸</summary><div class="pe-properties-grid"><label>X（pt）<input data-frame="x" type="number" step="1"></label><label>Y（pt）<input data-frame="y" type="number" step="1"></label><label>宽度（pt）<input data-frame="width" type="number" min="10"></label><label>高度（pt）<input data-frame="height" type="number" min="10"></label></div></details><button id="pe-recommend">重新评估方向</button><div class="pe-object-tools"><button id="pe-tables"><i data-icon="table"></i>表格单元格</button><button id="pe-link">接续段落</button><button id="pe-new">添加文字</button><button id="pe-compare">本段原文对照</button><button id="pe-full-diff">全页输出对照</button><label>格式刷范围<select id="pe-style-scope"><option value="all">字符与段落</option><option value="character">仅字符</option><option value="paragraph">仅段落</option></select></label><button id="pe-copy-style">吸取样式</button><button id="pe-paste-style" disabled>应用样式</button><button id="pe-problems">查看遮挡</button><button id="pe-default-style">设为新增默认</button><label>新增样式<select id="pe-new-style"><option value="nearby">沿用附近文字</option><option value="default">使用默认样式</option></select></label></div><details class="pe-layers"><summary>叠放与选择</summary><label>相对原页面<select id="pe-page-layer"><option value="above">位于原页面上方</option><option value="below">位于原页面下方</option></select></label><div class="pe-object-tools"><button data-order="up">上移一层</button><button data-order="down">下移一层</button><button data-order="top">置于顶层</button><button data-order="bottom">置于底层</button></div><select id="pe-overlap-select" aria-label="选择重叠段落"><option value="">选择重叠段落…</option></select></details><p class="pe-scope">修改范围：当前段落。接续后仅影响所选段落。</p></aside><aside class="pe-font-panel" hidden><div class="pe-panel-heading"><strong>选择字体</strong><button id="pe-close-font" aria-label="关闭字体选择">×</button></div><button id="pe-font-match">按原文字形推荐</button><p id="pe-font-evidence">缺字自动优先匹配原字体轮廓与字宽。</p><input id="pe-font-search" type="search" placeholder="搜索字体名称…" aria-label="搜索字体"><label>应用于<select id="pe-font-script"><option value="all">全部文字</option><option value="latin">英文字母与数字</option><option value="cjk">中文等非拉丁文字</option></select></label><div id="pe-font-list"></div><p>有选区时应用于选区；没有选区时用于后续输入。换行效果直接显示在原页。</p></aside><div class="pe-notice" hidden><span id="pe-warning"></span><button id="pe-accept">保留重叠</button><button id="pe-overflow">显示溢出并保留</button><label class="pe-session-warning"><input id="pe-warning-only" type="checkbox">本次仅标记</label></div><div class="pe-status-row"><span id="pe-status" role="status" aria-live="polite"></span><button id="pe-fallback" hidden>字体替代详情</button></div><aside id="pe-fallback-panel" class="pe-font-panel" hidden></aside>`;
    let fontCatalog = null,
      styleClipboard = null,
      lastConflicts = [],
      acceptedConflicts = "",
      ignoreConflicts = false;
    const input = document.createElement("textarea");
    input.className = "page-edit-input";
    input.setAttribute("aria-label", "当前页面段落文字");
    input.spellcheck = false;
    input.wrap = "off";
    const layer = document.createElement("div");
    layer.className = "page-edit-layer";
    const base = document.createElement("canvas");
    base.className = "page-edit-background";
    base.alt = "";
    base.draggable = false;
    base.hidden = true;
    const ink = document.createElement("img");
    ink.className = "page-edit-ink";
    ink.alt = "";
    ink.draggable = false;
    ink.hidden = true;
    const marks = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    marks.classList.add("page-edit-marks");
    marks.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const hits = document.createElement("div");
    hits.className = "page-edit-hits";
    const frame = document.createElement("div");
    frame.className = "page-edit-frame";
    frame.hidden = true;
    const resize = document.createElement("button");
    resize.className = "page-edit-resize";
    resize.title = "拖动调整段落宽度与高度";
    frame.append(resize);
    const move = document.createElement("button");
    move.className = "page-edit-move";
    move.title = "拖动移动文本框";
    move.setAttribute("aria-label", "移动文本框");
    move.innerHTML = '<i data-icon="cursor"></i>';
    icons(move);
    frame.append(move);
    const composition = document.createElement("span");
    composition.className = "page-edit-composition";
    composition.hidden = true;
    layer.append(base, ink, hits, marks, frame, input, composition);
    const collisionMarks = document.createElementNS(marks.namespaceURI, "svg");
    collisionMarks.classList.add("page-edit-collisions");
    collisionMarks.setAttribute("viewBox", `0 0 ${w} ${h}`);
    layer.append(collisionMarks);
    const signal = new AbortController(),
      listen = (el, type, fn, opts = {}) =>
        el.addEventListener(type, fn, { ...opts, signal: signal.signal });
    document.querySelectorAll("[data-flow-target]").forEach(button=>button.addEventListener("click",()=>bar.querySelector("#"+button.dataset.flowTarget)?.click(),{signal:signal.signal}));
    const status = (text, bad = false) => {
      bar.querySelector("#pe-status").textContent = text;
      bar.querySelector("#pe-status").classList.toggle("error", bad);
    };
    const structure = document.createElement("details");
    structure.className = "pe-structure";
    structure.innerHTML = `<summary>结构与文本链</summary><div class="pe-properties-grid"><label>区域类型<select id="pe-region-kind"><option value="text">正文</option><option value="title">标题</option><option value="caption">图注</option></select></label><label>所属栏<input id="pe-region-column" type="number" min="1" value="1"></label><label>阅读顺序<input id="pe-region-order" type="number" min="1" value="1"></label><label class="check"><input id="pe-region-lock" type="checkbox" checked>锁定人工结构</label></div><div class="pe-object-tools"><button id="pe-merge">合并段落</button><button id="pe-split">在光标处拆分</button><button id="pe-structure-save">保存结构纠正</button><button id="pe-structure-reset">恢复自动结构</button></div><ol id="pe-chain-list"></ol><p class="hint">拆分会先显示两个结果；确认后整批提交，可撤销。结构随工程与恢复草稿保存。</p>`;
    bar.querySelector(".pe-properties").append(structure);
    const chainList = () => {
      const list = bar.querySelector("#pe-chain-list");
      list.replaceChildren();
      (model?.frames || []).forEach((f, i) => {
        const li = document.createElement("li");
        li.textContent = `框 ${i + 1} · ${Math.round(f.x)}, ${Math.round(f.y)} · ${Math.round(f.width)} × ${Math.round(f.height)} `;
        for (const [label, delta] of [
          ["上移", -1],
          ["下移", 1],
        ]) {
          const b = document.createElement("button");
          b.textContent = label;
          b.disabled = i + delta < 0 || i + delta >= model.frames.length;
          b.onclick = () => {
            remember();
            [model.frames[i], model.frames[i + delta]] = [
              model.frames[i + delta],
              model.frames[i],
            ];
            chainList();
            queue();
          };
          li.append(b);
        }
        if (i) {
          const b = document.createElement("button");
          b.textContent = "在此断开";
          b.onclick = () =>
            guarded(async () => {
              await reflow();
              const g = preview.glyphs.find(
                (g) =>
                  g.x >= f.x - 1 &&
                  g.x < f.x + f.width &&
                  g.y >= f.y - 1 &&
                  g.y < f.y + f.height,
              );
              if (!g) throw Error("此框没有文字，请先调整文本链");
              await splitCurrent(g.start);
            });
          li.append(b);
        }
        list.append(li);
      });
    };
    async function splitCurrent(at) {
      if (!model) return;
      await reflow();
      const parts = splitModel(model, at, preview?.glyphs || []),
        layouts = [];
      for (const part of parts) {
        const r = await window.desktop.flowLayout(part);
        if (r.overflow || !r.mappingComplete)
          throw Error(
            "拆分后的文本框容不下全部文字，请先扩大范围或换一个拆分位置",
          );
        layouts.push(r);
      }
      const dlg = document.createElement("dialog");
      dlg.className = "split-flow-preview";
      const title = document.createElement("h2");
      title.textContent = "确认拆分为两个独立段落";
      dlg.append(title);
      parts.forEach((p, i) => {
        const text = document.createElement("p");
        text.textContent = `${i + 1}. ${p.text}`;
        dlg.append(text);
      });
      const cancel = document.createElement("button");
      cancel.textContent = "取消";
      cancel.onclick = () => {
        dlg.close();
        dlg.remove();
      };
      dlg.append(cancel);
      const ok = document.createElement("button");
      ok.className = "primary";
      ok.textContent = "确认拆分";
      ok.onclick = () =>
        guarded(async () => {
          ok.disabled = true;
          try {
            const edits = clone(S.nativeEdits || []).filter((e) => e.id !== id);
            parts.forEach((part, i) =>
              edits.push({
                id: i ? crypto.randomUUID() : id,
                page,
                type: "flow",
                index: null,
                sources: clone(part.sources),
                model: part,
                fragment: layouts[i].fragment,
                ink: layouts[i].glyphs,
              }),
            );
            await refreshNative(edits, S.ocr || [], S.ocrReference);
            commit(clone(S.nodes), { nativeEdits: edits });
            cancelDraft();
            dlg.close();
            dlg.remove();
            mount();
          } finally {
            ok.disabled = false;
          }
        });
      dlg.append(ok);
      document.body.append(dlg);
      dlg.addEventListener("cancel", () => dlg.remove());
      dlg.showModal();
    }
    listen(bar.querySelector("#pe-merge"), "click", () => {
      if (!model) {
        status("先选择第一段");
        return;
      }
      linkMode = "merge";
      hits.style.pointerEvents = "auto";
      status("点击要合并的另一段：保留字符样式，合并为一个范围");
    });
    listen(bar.querySelector("#pe-split"), "click", () =>
      guarded(() => splitCurrent(input.selectionStart)),
    );
    listen(bar.querySelector("#pe-structure-save"), "click", () =>
      guarded(async () => {
        if (!model) return;
        const corrections = clone(S.structures || []),
          sources = clone(model.sources);
        const key =
          sources.map((s) => s.index + ":" + s.signature).join("|") || id;
        const entry = {
          page,
          key,
          sources,
          model: clone(model),
          kind: bar.querySelector("#pe-region-kind").value,
          column: +bar.querySelector("#pe-region-column").value,
          order: +bar.querySelector("#pe-region-order").value,
          locked: bar.querySelector("#pe-region-lock").checked,
        };
        if (
          !Number.isInteger(entry.column) ||
          entry.column < 1 ||
          !Number.isInteger(entry.order) ||
          entry.order < 1
        )
          throw Error("栏与顺序须为正整数");
        entry.model.structureLocked = entry.locked;
        if (S.flowDraftDirty) await finish(false);
        commit(clone(S.nodes), {
          structures: [
            ...corrections.filter((c) => c.page !== page || c.key !== key),
            entry,
          ],
        });
        status("结构纠正已保存；重新识别时保留锁定范围");
      }),
    );
    listen(bar.querySelector("#pe-structure-reset"), "click", () => {
      if (!model) return;
      const ids = new Set(model.sources.map((s) => s.index));
      commit(clone(S.nodes), {
        structures: (S.structures || []).filter(
          (c) => c.page !== page || !c.sources.some((s) => ids.has(s.index)),
        ),
      });
      status("已恢复自动结构；退出本段后重新选择");
    });
    function scale() {
      return layer.getBoundingClientRect().width / w || 1;
    }
    function mount() {
      if (closed) return;
      if (S.bytes !== source) {
        destroy();
        return;
      }
      const shell = surface.entries.get(page)?.shell;
      if (shell && layer.parentElement !== shell) {
        shell.append(layer);
        if (model && !busy && document.activeElement === document.body)
          input.focus({ preventScroll: true });
      }
      if (!bar.isConnected)
        surface.host.parentElement.insertBefore(bar, surface.host);
      document.body.classList.add("page-edit-mode");
      document
        .querySelector('[data-action="flow-edit"]')
        ?.setAttribute("aria-pressed", "true");
      positionFrame();
    }
    const observer = new MutationObserver(() => {
      if (!closed && layer.parentElement !== surface.entries.get(page)?.shell)
        mount();
    });
    observer.observe(surface.host, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(() => {
      positionFrame();
      selection();
      clearTimeout(backgroundTimer);
      backgroundTimer = setTimeout(() => guarded(paintBackground), 100);
    });
    resizeObserver.observe(surface.host);
    function positionFrame() {
      if (!model) return;
      const f = model.frame;
      frame.style.cssText = `left:${(100 * f.x) / w}%;top:${(100 * f.y) / h}%;width:${(100 * f.width) / w}%;height:${(100 * f.height) / h}%`;
    }
    function tableRows(extra = model) {
      const rows = new Map();
      for (const e of [
        ...(S.nativeEdits || []).filter((e) => e.page === page && e.id !== id),
        ...(extra ? [{ model: extra }] : []),
      ]) {
        const g = e.model?.tableGrowth;
        if (!g) continue;
        const key = g.tableId + ":" + g.y;
        if (g.delta > (rows.get(key)?.delta || 0)) rows.set(key, g);
      }
      return [...rows.values()];
    }
    function positioned(m, rows = tableRows()) {
      m = clone(m);
      if (!m.cell) return m;
      m.tableBaseFrame ||= clone(m.frame);
      m.tableBaseCell ||= clone(m.cell.bounds);
      const b = m.tableBaseCell,
        f = m.tableBaseFrame,
        gs = rows.filter((g) => g.tableId === m.cell.tableId);
      const shift = gs
          .filter((g) => g.y <= b[1] + 0.5)
          .reduce((v, g) => v + g.delta, 0),
        extra = gs
          .filter((g) => g.y > b[1] + 0.5 && g.y <= b[3] + 0.5)
          .reduce((v, g) => v + g.delta, 0);
      m.frame = { ...f, y: f.y + shift, height: f.height + extra };
      m.cell.bounds = [b[0], b[1] + shift, b[2], b[3] + shift + extra];
      return m;
    }
    async function arrangedEdits(edits) {
      const gs = new Map();
      for (const e of edits) {
        const g = e.page === page && e.model?.tableGrowth;
        if (g) {
          const k = g.tableId + ":" + g.y;
          if (g.delta > (gs.get(k)?.delta || 0)) gs.set(k, g);
        }
      }
      for (const e of edits)
        if (e.page === page && e.model?.cell) {
          const m = positioned(e.model, [...gs.values()]);
          if (JSON.stringify(m.frame) !== JSON.stringify(e.model.frame)) {
            const r = await window.desktop.flowLayout(m);
            if (r.overflow)
              throw Error("表格行高调整后仍有文字溢出，请调整布局");
            e.model = m;
            e.fragment = r.fragment;
            e.ink = r.glyphs;
          }
        }
      return edits;
    }
    function tableObstacles(current) {
      const rows = tableRows(current);
      const move = (b) => {
        const gs = rows.filter(
          (g) =>
            b[0] >= g.bounds[0] - 2 &&
            b[2] <= g.bounds[2] + 2 &&
            b[1] >= g.bounds[1] - 2 &&
            b[3] <= g.bounds[3] + 2,
        );
        return [
          b[0],
          b[1] +
            gs
              .filter((g) => b[1] >= g.y - 0.5)
              .reduce((v, g) => v + g.delta, 0),
          b[2],
          b[3] +
            gs
              .filter((g) => b[3] >= g.y - 0.5)
              .reduce((v, g) => v + g.delta, 0),
        ];
      };
      const objects = result.objects.map((o) => {
        const b = move([
          o.bounds[0],
          h - o.bounds[3],
          o.bounds[2],
          h - o.bounds[1],
        ]);
        return { ...o, bounds: [b[0], h - b[3], b[2], h - b[1]] };
      });
      const edits = (S.nativeEdits || []).map((e) => {
        if (e.page !== page || !e.model?.cell) return e;
        const p = positioned(e.model, rows),
          dy = p.frame.y - e.model.frame.y;
        return {
          ...e,
          model: p,
          ink: e.ink?.map((g) => ({ ...g, y: g.y + dy })),
        };
      });
      return { objects, edits };
    }
    function candidateButtons() {
      hits.replaceChildren();
      const edits = (S.nativeEdits || []).filter((e) => e.page === page);
      const used = new Set(
        edits
          .filter((e) => e.type === "flow")
          .flatMap((e) => e.sources.map((s) => s.index)),
      );
      const add = (f, text, fn, disabled = false, cell = null) => {
        const el = document.createElement("button");
        el.className = "page-edit-hit";
        el.title = disabled || text;
        el.setAttribute("aria-label", text.slice(0, 100));
        el.style.cssText = `left:${(100 * f.x) / w}%;top:${(100 * f.y) / h}%;width:${(100 * f.width) / w}%;height:${(100 * f.height) / h}%`;
        if (disabled) el.classList.add("unavailable");
        if (cell) {
          el.classList.add("table-cell-hit");
          el.dataset.cellId = cell.id;
          el.title = `表格 · 第 ${cell.row + 1} 行，第 ${cell.column + 1} 列 · ${text || "空单元格"}`;
          el.setAttribute("aria-label", el.title);
        }
        el.onclick = (e) =>
          guarded(async () => {
            e.stopPropagation();
            if (disabled) {
              status(disabled, true);
              return;
            }
            await fn(e);
          });
        hits.append(el);
      };
      const corrections = (S.structures || []).filter(
        (c) =>
          c.page === page &&
          c.locked &&
          c.sources.every((s) =>
            result.objects.some(
              (o) => o.index === s.index && o.signature === s.signature,
            ),
          ),
      );
      const corrected = new Set(
        corrections.flatMap((c) => c.sources.map((s) => s.index)),
      );
      const automatic = corrected.size
        ? pageCandidates(
            result.objects.filter((o) => !corrected.has(o.index)),
            w,
            h,
            ai.regions || [],
            result.tables || [],
          )
        : candidates;
      [
        ...automatic.filter(
          (c) => !c.model.sources.some((s) => corrected.has(s.index)),
        ),
        ...corrections
          .sort((a, b) => a.order - b.order)
          .map((c) => ({ model: c.model, original: c.model.frame })),
      ]
        .filter(
          (c) =>
            !c.model.sources.some(
              (s) =>
                used.has(s.index) ||
                model?.sources.some((a) => a.index === s.index),
            ),
        )
        .forEach((c) => {
          const m = positioned(c.model);
          add(
            m.cell
              ? {
                  x: m.cell.bounds[0],
                  y: m.cell.bounds[1],
                  width: m.cell.bounds[2] - m.cell.bounds[0],
                  height: m.cell.bounds[3] - m.cell.bounds[1],
                }
              : c.original,
            m.text,
            (e) => activate(m, null, e),
            c.reason,
            m.cell,
          );
        });
      edits
        .filter(
          (e) => e.type === "flow" && !e.tableModel && e.model && e.id !== id,
        )
        .forEach((e) =>
          add(
            e.model.frame,
            e.model.text,
            (q) => activate(e.model, e.id, q),
            false,
            e.model.cell,
          ),
        );
    }
    function showFields() {
      if (!model) return;
      for (const [key, name] of [
        ["size", "size"],
        ["lineHeight", "leading"],
        ["charSpacing", "spacing"],
        ["color", "color"],
        ["align", "align"],
        ["columns", "columns"],
        ["firstIndent", "indent"],
        ["paragraphBefore", "before"],
        ["paragraphGap", "after"],
      ])
        bar.querySelector("#pe-" + name).value = [
          "size",
          "lineHeight",
          "charSpacing",
        ].includes(key)
          ? +(model[key] || 0).toFixed(2)
          : (model[key] ?? 0);
      for (const k of ["bold", "italic"])
        bar.querySelector("#pe-" + k).setAttribute("aria-pressed", !!model[k]);
      bar.querySelector("#pe-font").textContent =
        fontLabel(model.fontName) || "内置替代字体";
      bar.querySelector("#pe-font").title =
        (model.fontKey
          ? "已匹配原文嵌入字体："
          : "原字体不可复用，替代为内置字体：") +
        (model.fontName || "Noto Sans SC");
      bar.querySelector("strong").textContent = model.cell
        ? "表格编辑"
        : "页面编辑";
      bar.querySelector("#pe-layout-mode").value = model.layoutMode || "preserve";
      bar.querySelector("#pe-growth").value = model.growth || "auto";
      bar.querySelector("#pe-growth-reason").textContent =
        model.growth && model.growth !== "auto"
          ? {
              down: "手动：保持栏宽，向下增加高度",
              right: "手动：保持左侧位置，向右增加宽度",
              fixed: "手动：保留框尺寸，溢出由你决定",
            }[model.growth]
          : `自动预选 → ${{ down: "向下", right: "向右", fixed: "固定文本框" }[model.growthDirection || "down"]} · ${model.growthReason || ""}`;
      bar.querySelector("#pe-columns").disabled = !!model.cell;
      bar.querySelector("#pe-link").disabled = !!model.cell;
      bar.querySelector("#pe-page-layer").value = model.behindPage
        ? "below"
        : "above";
      bar.querySelector("#pe-page-layer").disabled = !!model.cell;
      bar.querySelectorAll("[data-frame]").forEach((e) => {
        e.value = +model.frame[e.dataset.frame].toFixed(1);
        e.disabled = !!model.cell || !!model.frames;
      });
      move.hidden = !!model.cell || !!model.frames;
      resize.hidden = !!model.frames;
      frame.hidden = false;
      chainList();
      positionFrame();
    }
    async function activate(m, flowId, e) {
      if (busy || composing) return;
      if (linkMode && model && !flowId) {
        if (m.cell || model.cell) {
          status("单元格独立编辑，Tab 可切换下一格");
          return;
        }
        remember();
        model = joinModels(model, m, linkMode === "chain");
        linkMode = false;
        bar.querySelector("#pe-link").setAttribute("aria-pressed", "false");
        input.value = model.text;
        await prepareBackground();
        showFields();
        queue();
        return;
      }
      await finish(false);
      model = positioned(m, tableRows(null));
      model.text = model.text.replace(/\r\n?/g, "\n");
      id = flowId || crypto.randomUUID();
      if (!model.growthDirection) {
        const suggested = suggestGrowth(
          model,
          result.objects,
          ai.regions || [],
          S.nativeEdits || [],
          page,
          id,
        );
        model.growthDirection = suggested.direction;
        model.growthReason = suggested.reason;
      }
      delete model.typingStyle;
      initial = JSON.stringify(model);
      history = [];
      future = [];
      preview = null;
      validRevision = -1;
      input.value = model.text;
      candidateButtons();
      await prepareBackground();
      showFields();
      await reflow();
      input.focus({ preventScroll: true });
      const r = layer.getBoundingClientRect(),
        q = scale();
      const offset = e
        ? hitOffset(
            preview?.glyphs || [],
            (e.clientX - r.left) / q,
            (e.clientY - r.top) / q,
          )
        : 0;
      input.setSelectionRange(offset, offset);
      selection();
    }
    async function prepareBackground(rendered = null, quiet = false) {
      const target = clone(model),
        targetId = id,
        targetRevision = revision;
      const stale = () =>
        closed || !model || id !== targetId || revision !== targetRevision;
      if (!quiet) {
        busy = true;
        status("准备原页编辑…");
        input.disabled = true;
      }
      try {
        const blank =
          rendered ||
          (await window.desktop.flowLayout({ ...target, text: "" }));
        const edits = clone(S.nativeEdits || []).filter(
          (e) => e.id !== targetId,
        );
        edits.push({
          id: targetId,
          page,
          type: "flow",
          index: null,
          sources: target.sources,
          model: target,
          fragment: blank.fragment,
        });
        await arrangedEdits(edits);
        const r = await call("flow-background", {
          page,
          edits,
          ocr: S.ocrReference ? [] : S.ocr,
          ocrReference: S.ocrReference,
        });
        if (stale()) return;
        const nextBackground = await surface.pdfjs.getDocument({
          data: Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0)),
          cMapUrl: new URL("./vendor/cmaps/", import.meta.url).href,
          cMapPacked: true,
          standardFontDataUrl: new URL(
            "./vendor/standard_fonts/",
            import.meta.url,
          ).href,
        }).promise;
        if (stale()) {
          await nextBackground.destroy();
          return;
        }
        backgroundTask?.cancel();
        await background?.destroy();
        background = nextBackground;
        await paintBackground();
        if (!stale()) base.hidden = false;
      } catch (e) {
        status(e.message, true);
        throw e;
      } finally {
        if (!quiet) {
          busy = false;
          input.disabled = false;
        }
      }
    }
    async function paintBackground() {
      if (!background || closed) return;
      const serial = ++backgroundSerial;
      backgroundTask?.cancel();
      const p = await background.getPage(1);
      if (closed || serial !== backgroundSerial) return;
      const z = scale() * Math.min(devicePixelRatio || 1, 3),
        v = p.getViewport({ scale: z });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(v.width);
      canvas.height = Math.ceil(v.height);
      backgroundTask = p.render({
        canvasContext: canvas.getContext("2d"),
        viewport: v,
      });
      try {
        await backgroundTask.promise;
      } catch (e) {
        if (e.name === "RenderingCancelledException") return;
        throw e;
      }
      if (closed || serial !== backgroundSerial) return;
      base.width = canvas.width;
      base.height = canvas.height;
      base.getContext("2d").drawImage(canvas, 0, 0);
    }
    function showCollisions(conflicts) {
      collisionMarks.replaceChildren();
      for (const c of conflicts.slice(0, 40)) {
        const [x, y, r, b] = c.bounds,
          box = document.createElementNS(marks.namespaceURI, "rect");
        for (const [k, v] of Object.entries({
          x,
          y,
          width: Math.max(1, r - x),
          height: Math.max(1, b - y),
        }))
          box.setAttribute(k, v);
        collisionMarks.append(box);
      }
    }
    function remember() {
      if (!model) return;
      history.push({
        model: clone(model),
        start: input.selectionStart,
        end: input.selectionEnd,
      });
      if (history.length > 100) history.shift();
      future = [];
    }
    function queue() {
      revision++;
      validRevision = -1;
      clearTimeout(timer);
      S.flowDraftDirty = JSON.stringify(model) !== initial;
      window.desktop?.setDirty?.(S.dirty || S.flowDraftDirty);
      ctx.scheduleRecovery?.();
      status("正在重排…");
      timer = setTimeout(() => guarded(reflow), 45);
    }
    async function reflow() {
      clearTimeout(timer);
      if (!model || closed || composing) return;
      if (running) {
        await running;
        if (validRevision !== revision) return reflow();
        return;
      }
      const rev = revision,
        m = clone(model);
      validRevision = -1;
      running = (async () => {
        try {
          let res = await window.desktop.flowLayout(m),
            expanded = false,
            tableChanged = false;
          const direction =
            m.growth && m.growth !== "auto"
              ? m.growth
              : m.growthDirection || "down";
          if (
            res.overflow &&
            !m.allowOverflow &&
            !m.cell &&
            !m.frames &&
            direction !== "fixed"
          ) {
            const growRight = direction === "right" && !m.preserveAlignmentWidth;
            const dimension = growRight ? "width" : "height";
            const limit =
              growRight
                ? horizontalLimit(
                    m,
                    result.objects,
                    S.nativeEdits || [],
                    page,
                    id,
                  )
                : growthLimit(m, result.objects, S.nativeEdits || [], page, id);
            const original = m.frame[dimension];
            if (limit > original + 0.5) {
              const trial = await window.desktop.flowLayout({
                ...m,
                frame: { ...m.frame, [dimension]: limit },
              });
              if (!trial.overflow) {
                let lo = original,
                  hi = limit;
                res = trial;
                for (let i = 0; i < 6 && hi - lo > 0.5; i++) {
                  const mid = (lo + hi) / 2,
                    test = await window.desktop.flowLayout({
                      ...m,
                      frame: { ...m.frame, [dimension]: mid },
                    });
                  if (test.overflow) lo = mid;
                  else {
                    hi = mid;
                    res = test;
                  }
                }
                m.frame[dimension] = hi;
                expanded = true;
              }
            }
          }
          if (
            res.overflow &&
            m.cell &&
            !m.allowOverflow &&
            direction !== "fixed"
          ) {
            const table = (result.tables || []).find(
              (t) => t.id === m.cell.tableId,
            );
            const old = m.frame.height,
              limit = Math.min(14400, Math.max(old, h - m.frame.y));
            if (table && limit > old + 0.5) {
              let trial = await window.desktop.flowLayout({
                ...m,
                frame: { ...m.frame, height: limit },
              });
              if (!trial.overflow) {
                let lo = old,
                  hi = limit;
                res = trial;
                for (let i = 0; i < 7 && hi - lo > 0.5; i++) {
                  const mid = (lo + hi) / 2,
                    r = await window.desktop.flowLayout({
                      ...m,
                      frame: { ...m.frame, height: mid },
                    });
                  if (r.overflow) lo = mid;
                  else {
                    hi = mid;
                    res = r;
                  }
                }
                const base = m.tableBaseFrame || m.frame,
                  bounds = m.tableBaseCell || m.cell.bounds;
                m.tableBaseFrame = clone(base);
                m.tableBaseCell = clone(bounds);
                m.tableGrowth = {
                  tableId: table.id,
                  bounds: clone(table.bounds),
                  y: bounds[3],
                  delta: hi - base.height,
                };
                m.frame.height = hi;
                expanded = true;
                tableChanged = true;
              }
            }
          }
          if (closed || rev !== revision) return;
          if (expanded) {
            model.frame = { ...m.frame };
            if (tableChanged) {
              model.tableGrowth = m.tableGrowth;
              model.tableBaseFrame = m.tableBaseFrame;
              model.tableBaseCell = m.tableBaseCell;
              await prepareBackground(null, true);
              candidateButtons();
            }
            positionFrame();
            if (!S.flowDraftDirty) initial = JSON.stringify(model);
          }
          preview = res;
          ink.src = imageURL(res.svg);
          await ink.decode();
          if (closed || rev !== revision) return;
          const composite =
            model.behindPage ||
            model.layerOrder != null ||
            (S.nativeEdits || []).some(
              (e) =>
                e.page === page &&
                (e.model?.behindPage || e.model?.layerOrder != null),
            );
          if (composite) {
            await prepareBackground(res, true);
            if (closed || rev !== revision) return;
          }
          const untouched = !S.flowDraftDirty && model.originalLayout?.text === model.text && res.layoutMode === "原始字位";
          base.hidden = untouched;
          ink.hidden = !!composite || untouched;
          selection();
          const obstacles = tableObstacles(m);
          const conflicts = flowConflicts(
            m,
            obstacles.objects,
            obstacles.edits,
            page,
            id,
            res.glyphs,
          );
          if (
            m.frame.x < 0 ||
            m.frame.y < 0 ||
            m.frame.x + m.frame.width > w ||
            m.frame.y + m.frame.height > h ||
            res.glyphs.some(
              (g) => g.x < 0 || g.y < 0 || g.x + g.w > w || g.y + g.h > h,
            )
          )
            conflicts.push({
              kind: "page",
              bounds: frameBounds(m.frame),
              message: "部分文字在页面可见范围外，保存保留文本并按页面裁切",
            });
          if (m.tableGrowth) {
            const g = m.tableGrowth,
              delta = tableRows(m)
                .filter((q) => q.tableId === g.tableId)
                .reduce((v, q) => v + q.delta, 0),
              expanded = [
                g.bounds[0],
                g.bounds[3],
                g.bounds[2],
                g.bounds[3] + delta,
              ];
            if (expanded[3] > h)
              conflicts.push({
                kind: "page",
                bounds: expanded,
                message: "表格后续行超出可见页面，可调整或保留裁切",
              });
            for (const o of result.objects) {
              const b = [
                o.bounds[0],
                h - o.bounds[3],
                o.bounds[2],
                h - o.bounds[1],
              ];
              if (
                ["text", "image", "form"].includes(o.type) &&
                b[1] >= g.bounds[3] &&
                b[0] < expanded[2] &&
                b[2] > expanded[0] &&
                b[1] < expanded[3]
              )
                conflicts.push({
                  kind: "table",
                  bounds: b,
                  message: "表格增高可能覆盖下方内容，可调整或保留",
                });
            }
          }
          lastConflicts = conflicts;
          showCollisions(conflicts);
          drawOverlapSelect();
          const signature = JSON.stringify(
            conflicts.map((c) => [c.kind, c.bounds]),
          );
          const warning = bar.querySelector(".pe-notice");
          warning.hidden = !(
            res.overflow ||
            (conflicts.length &&
              !ignoreConflicts &&
              signature !== acceptedConflicts)
          );
          bar.querySelector("#pe-warning").textContent = res.overflow
            ? "内容超出当前框，可换方向、调整尺寸，或显示溢出并保留。"
            : `${conflicts.length} 处可能遮挡 · 可以继续调整或保留效果`;
          bar.querySelector("#pe-accept").hidden = res.overflow;
          bar.querySelector("#pe-overflow").hidden = !res.overflow;
          bar.querySelector("#pe-fallback").hidden = !res.fallbackCount;
          bar.querySelector("#pe-fallback").textContent =
            `${res.fallbackCount || 0} 字替代 · 查看`;
          if (res.overflow) {
            status("草稿已保留，请选择如何显示完整内容");
            return;
          }
          if (!res.mappingComplete)
            throw Error("此段包含暂不能可靠定位的复杂字形，草稿已保留");
          if (conflicts.some((c) => c.kind === "source"))
            throw Error("同一源对象已有另一项修改，请先完成或撤销该修改");
          validRevision = rev;
          status(
            `${model.cell ? `表格 · 第 ${model.cell.row + 1} 行，第 ${model.cell.column + 1} 列 · Tab 下一格` : `第 ${page} 页`} · ${m.text.length} 字符 · ${{ down: "向下", right: "向右", fixed: "固定框" }[direction]} · ${expanded ? "已自动扩容 · " : ""}${res.layoutMode || "段落重排"}完成${conflicts.length ? " · 可保留重叠" : ""}${res.spacingLimited ? " · 此字体字距按默认度量" : ""}`,
          );
        } catch (e) {
          if (!closed && rev === revision) status(e.message, true);
        }
      })();
      try {
        await running;
      } finally {
        running = null;
      }
    }
    function selection() {
      if (!model || closed) return;
      const glyphs = preview?.glyphs || [],
        a = input.selectionStart,
        b = input.selectionEnd;
      if (document.activeElement === input) {
        const r = (model.runs || []).find(
          (r) => r.start <= Math.max(0, a - 1) && r.end > Math.max(0, a - 1),
        );
        if (r) {
          const names = new Set(
            (model.runs || [])
              .filter((r) => r.end > a && r.start < b)
              .map((r) => r.fontName || model.fontName),
          );
          bar.querySelector("#pe-font").textContent =
            names.size > 1
              ? "混合字体"
              : fontLabel(
                  model.typingStyle?.fontName ||
                    r.fontName ||
                    model.fontName ||
                    "内置替代字体",
                );
          for (const [key, id] of [
            ["size", "size"],
            ["charSpacing", "spacing"],
            ["color", "color"],
          ])
            if ((model.typingStyle?.[key] ?? r[key]) != null) {
              const v = model.typingStyle?.[key] ?? r[key];
              bar.querySelector("#pe-" + id).value =
                typeof v === "number" ? +v.toFixed(2) : v;
            }
          for (const key of ["bold", "italic"])
            bar
              .querySelector("#pe-" + key)
              .setAttribute(
                "aria-pressed",
                !!(model.typingStyle?.[key] ?? r[key] ?? model[key]),
              );
        }
      }
      marks.replaceChildren();
      const rect = (x, y, width, height, fill) => {
        const r = document.createElementNS(marks.namespaceURI, "rect");
        for (const [k, v] of Object.entries({ x, y, width, height, fill }))
          r.setAttribute(k, v);
        marks.append(r);
        return r;
      };
      if (a !== b)
        for (const g of glyphs)
          if (g.end > a && g.start < b)
            rect(g.x, g.y, Math.max(g.w, 1), g.h, "#537cec44");
      const cursor = input.selectionDirection === "backward" ? a : b;
      const c = preview?.anchors?.[cursor] || caretRect(glyphs, cursor, model),
        z = scale();
      if (a === b && !composing) {
        const r = rect(c.x, c.y, Math.max(0.6, 1.4 / z), c.h, "#234dba");
        r.classList.add("page-edit-caret");
      }
      input.style.left = c.x * z + "px";
      input.style.top = c.y * z + "px";
      input.style.height = Math.max(12, c.h * z) + "px";
      composition.style.left = c.x * z + "px";
      composition.style.top = c.y * z + "px";
      composition.style.fontSize = model.size * z + "px";
    }
    listen(input, "beforeinput", (e) => {
      if (!composing && !e.isComposing) {
        remember();
        pendingHistory = true;
      }
    });
    listen(input, "input", () => {
      if (!model) return;
      if (!pendingHistory && !composing) remember();
      pendingHistory = false;
      const old = model.text;
      model.runs = editStyles(model.runs || [], old, input.value, model);
      if (model.typingStyle) {
        let a = 0,
          b = 0;
        while (
          a < old.length &&
          a < input.value.length &&
          old[a] === input.value[a]
        )
          a++;
        while (
          b < old.length - a &&
          b < input.value.length - a &&
          old.at(-1 - b) === input.value.at(-1 - b)
        )
          b++;
        const draft = { ...model, text: input.value };
        rangeStyle(draft, a, input.value.length - b, model.typingStyle);
        model.runs = draft.runs;
      }
      model.text = input.value;
      S.flowDraftDirty = JSON.stringify(model) !== initial;
      window.desktop?.setDirty?.(S.dirty || S.flowDraftDirty);
      if (!composing) queue();
    });
    listen(input, "select", selection);
    listen(input, "keyup", selection);
    listen(input, "compositionstart", () => {
      remember();
      composing = true;
      composition.hidden = false;
      clearTimeout(timer);
    });
    listen(input, "compositionupdate", (e) => {
      composition.textContent = e.data;
      selection();
    });
    listen(input, "compositionend", () => {
      composing = false;
      composition.hidden = true;
      composition.textContent = "";
      const old = model.text;
      model.runs = editStyles(model.runs || [], old, input.value, model);
      if (model.typingStyle) {
        let a = 0,
          b = 0;
        while (
          a < old.length &&
          a < input.value.length &&
          old[a] === input.value[a]
        )
          a++;
        while (
          b < old.length - a &&
          b < input.value.length - a &&
          old.at(-1 - b) === input.value.at(-1 - b)
        )
          b++;
        const draft = { ...model, text: input.value };
        rangeStyle(draft, a, input.value.length - b, model.typingStyle);
        model.runs = draft.runs;
      }
      model.text = input.value;
      queue();
    });
    listen(input, "keydown", (e) => {
      if (e.isComposing || composing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelDraft();
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
        ].includes(e.key)
      )
        delete model.typingStyle;
      if (ctrl && ["z", "y"].includes(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
        const redo = e.key.toLowerCase() === "y" || e.shiftKey;
        const from = redo ? future : history,
          to = redo ? history : future,
          entry = from.pop();
        if (!entry) return;
        to.push({
          model: clone(model),
          start: input.selectionStart,
          end: input.selectionEnd,
        });
        model = entry.model;
        input.value = model.text;
        input.setSelectionRange(entry.start, entry.end);
        showFields();
        revision++;
        validRevision = -1;
        status("正在恢复布局…");
        guarded(async () => {
          await prepareBackground(null, true);
          queue();
        });
        return;
      }
      if (ctrl && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        guarded(() => finish(false));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        if (model.cell) guarded(() => nextCell(e.shiftKey ? -1 : 1));
        else bar.querySelector("#pe-size").focus();
        return;
      }
      if (!ctrl && ["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const gs = preview?.glyphs || [],
          offset =
            input.selectionDirection === "backward"
              ? input.selectionStart
              : input.selectionEnd;
        const c = caretRect(gs, offset, model),
          line = gs.filter((g) => g.line === c.line);
        let n = offset;
        if (e.key === "Home") n = line[0]?.start ?? 0;
        else if (e.key === "End") n = line.at(-1)?.end ?? model.text.length;
        else {
          const next = gs.filter(
            (g) => g.line === c.line + (e.key === "ArrowDown" ? 1 : -1),
          );
          if (next.length) n = hitOffset(next, c.x, next[0].y + next[0].h / 2);
        }
        if (e.shiftKey) {
          const anchor =
            input.selectionDirection === "backward"
              ? input.selectionEnd
              : input.selectionStart;
          input.setSelectionRange(
            Math.min(anchor, n),
            Math.max(anchor, n),
            n < anchor ? "backward" : "forward",
          );
        } else input.setSelectionRange(n, n);
        selection();
      }
      // Prevent page navigation / hand scrolling while the text input owns focus.
      if (!(ctrl && ["s", "o", "f"].includes(e.key.toLowerCase())))
        e.stopPropagation();
    });
    async function nextCell(direction = 1) {
      if (!model?.cell) return;
      const cells = candidates
        .filter((c) => c.model.cell?.tableId === model.cell.tableId)
        .sort(
          (a, b) =>
            a.model.cell.row - b.model.cell.row ||
            a.model.cell.column - b.model.cell.column,
        );
      const current = cells.findIndex((c) => c.model.cell.id === model.cell.id),
        next = cells[current + direction];
      if (!next) {
        status("已到表格边缘");
        return;
      }
      const existing = (S.nativeEdits || []).find(
        (e) => e.page === page && e.model?.cell?.id === next.model.cell.id,
      );
      await activate(existing?.model || next.model, existing?.id || null);
    }
    listen(layer, "pointerdown", (e) => {
      if (e.target === resize || e.target.closest("button")) return;
      if (newMode && !busy) {
        const r = layer.getBoundingClientRect(),
          z = scale(),
          x = Math.max(0, Math.min(w - 80, (e.clientX - r.left) / z)),
          y = Math.max(0, Math.min(h - 40, (e.clientY - r.top) / z));
        newMode = false;
        bar.querySelector("#pe-new").setAttribute("aria-pressed", "false");
        const nearest = [...candidates]
          .filter((c) => !c.reason)
          .sort(
            (a, b) =>
              Math.hypot(a.original.x - x, a.original.y - y) -
              Math.hypot(b.original.x - x, b.original.y - y),
          )[0]?.model;
        const saved =
          bar.querySelector("#pe-new-style").value === "nearby" && nearest
            ? nearest
            : JSON.parse(localStorage.getItem("folio-new-text-style") || "{}");
        const defaults = Object.fromEntries(
          [
            "fontKey",
            "fontName",
            "size",
            "lineHeight",
            "color",
            "charSpacing",
            "wordSpacing",
            "bold",
            "italic",
            "align",
            "latinFontKey",
            "latinFontName",
            "cjkFontKey",
            "cjkFontName",
          ]
            .filter((k) => saved[k] != null)
            .map((k) => [k, saved[k]]),
        );
        guarded(() =>
          activate(
            {
              pageWidth: w,
              pageHeight: h,
              text: "",
              sources: [],
              frame: {
                x,
                y,
                width: Math.min(280, w - x),
                height: Math.min(100, h - y),
              },
              size: 12,
              lineHeight: 1.4,
              columns: 1,
              gap: 18,
              align: "left",
              color: "#202020",
              font: "sans",
              ...defaults,
            },
            null,
          ),
        );
        return;
      }
      if (!model || busy || composing) return;
      const r = layer.getBoundingClientRect(),
        z = scale(),
        x = (e.clientX - r.left) / z,
        y = (e.clientY - r.top) / z;
      const f = model.frame;
      if (x < f.x || x > f.x + f.width || y < f.y || y > f.y + f.height) return;
      e.preventDefault();
      e.stopPropagation();
      input.focus({ preventScroll: true });
      const blank = Object.entries(preview?.anchors || {}).find(
        ([, a]) => y >= a.y && y <= a.y + a.h,
      );
      const end = blank ? +blank[0] : hitOffset(preview?.glyphs || [], x, y);
      delete model.typingStyle;
      pointerAnchor = e.shiftKey ? input.selectionStart : end;
      input.setSelectionRange(
        Math.min(pointerAnchor, end),
        Math.max(pointerAnchor, end),
        end < pointerAnchor ? "backward" : "forward",
      );
      selection();
      layer.setPointerCapture(e.pointerId);
      layer.dataset.selecting = "true";
    });
    listen(layer, "pointermove", (e) => {
      if (layer.dataset.selecting !== "true" || !model) return;
      const r = layer.getBoundingClientRect(),
        z = scale(),
        end = hitOffset(
          preview?.glyphs || [],
          (e.clientX - r.left) / z,
          (e.clientY - r.top) / z,
        );
      input.setSelectionRange(
        Math.min(pointerAnchor, end),
        Math.max(pointerAnchor, end),
        end < pointerAnchor ? "backward" : "forward",
      );
      selection();
    });
    listen(layer, "pointerup", () => delete layer.dataset.selecting);
    listen(layer, "pointercancel", () => delete layer.dataset.selecting);
    listen(layer, "dblclick", (e) => {
      if (!model || busy || e.target.closest("button")) return;
      const n = input.selectionStart,
        seg = new Intl.Segmenter("zh", { granularity: "word" });
      const word = [...seg.segment(model.text)].find(
        (s) => n >= s.index && n < s.index + s.segment.length,
      );
      if (word) {
        input.setSelectionRange(word.index, word.index + word.segment.length);
        selection();
      }
    });
    listen(move, "pointerdown", (e) => {
      if (!model || model.cell || busy) return;
      e.preventDefault();
      e.stopPropagation();
      remember();
      move.setPointerCapture(e.pointerId);
      const x = e.clientX,
        y = e.clientY,
        f = { ...model.frame },
        z = scale();
      move.onpointermove = (q) => {
        model.frame.x = Math.max(
          -14400,
          Math.min(14400, f.x + (q.clientX - x) / z),
        );
        model.frame.y = Math.max(
          -14400,
          Math.min(14400, f.y + (q.clientY - y) / z),
        );
        model.growth = "fixed";
        positionFrame();
        queue();
      };
      move.onpointerup = move.onpointercancel = () => {
        move.onpointermove = null;
        showFields();
        input.focus({ preventScroll: true });
      };
    });
    listen(resize, "pointerdown", (e) => {
      if (!model || busy) return;
      e.preventDefault();
      e.stopPropagation();
      remember();
      resize.setPointerCapture(e.pointerId);
      const x = e.clientX,
        y = e.clientY,
        f = { ...model.frame },
        z = scale();
      resize.onpointermove = (q) => {
        model.frame.width = Math.max(
          model.size * 2,
          Math.min(14400, f.width + (q.clientX - x) / z),
        );
        model.frame.height = Math.max(
          10,
          Math.min(14400, f.height + (q.clientY - y) / z),
        );
        positionFrame();
        queue();
      };
      resize.onpointerup = resize.onpointercancel = () => {
        resize.onpointermove = null;
        input.focus({ preventScroll: true });
      };
    });
    for (const [name, key] of [
      ["size", "size"],
      ["leading", "lineHeight"],
      ["spacing", "charSpacing"],
      ["color", "color"],
      ["align", "align"],
      ["columns", "columns"],
      ["indent", "firstIndent"],
      ["before", "paragraphBefore"],
      ["after", "paragraphGap"],
    ])
      listen(bar.querySelector("#pe-" + name), "change", (e) => {
        if (!model) return;
        remember();
        const value = [
          "size",
          "lineHeight",
          "columns",
          "charSpacing",
          "firstIndent",
          "paragraphBefore",
          "paragraphGap",
        ].includes(key)
          ? +e.target.value
          : e.target.value;
        if (["size", "color", "charSpacing"].includes(key))
          rangeStyle(model, input.selectionStart, input.selectionEnd, {
            [key]: value,
          });
        else model[key] = value;
        if (key === "align") model.preserveAlignmentWidth = true;
        queue();
        input.focus({ preventScroll: true });
      });
    for (const k of ["bold", "italic"])
      listen(bar.querySelector("#pe-" + k), "click", () => {
        if (!model) return;
        remember();
        const r =
          (model.runs || []).find(
            (r) =>
              r.start <= input.selectionStart && r.end > input.selectionStart,
          ) || model;
        const v = !(model.typingStyle?.[k] ?? r[k] ?? model[k]);
        rangeStyle(model, input.selectionStart, input.selectionEnd, { [k]: v });
        bar.querySelector("#pe-" + k).setAttribute("aria-pressed", v);
        queue();
        input.focus({ preventScroll: true });
      });
    listen(bar.querySelector("#pe-page-layer"), "change", (e) => {
      if (!model) return;
      remember();
      model.behindPage = e.target.value === "below";
      queue();
      input.focus({ preventScroll: true });
    });
    for (const b of bar.querySelectorAll("[data-order]"))
      listen(b, "click", () => {
        if (!model) return;
        remember();
        const values = (S.nativeEdits || [])
          .filter(
            (e) =>
              e.page === page &&
              e.id !== id &&
              !!e.model?.behindPage === !!model.behindPage,
          )
          .map((e) => e.model?.layerOrder || 0);
        const current = model.layerOrder || 0;
        model.layerOrder =
          b.dataset.order === "top"
            ? Math.max(current, ...values) + 1
            : b.dataset.order === "bottom"
              ? Math.min(current, ...values) - 1
              : b.dataset.order === "up"
                ? Math.min(...values.filter((n) => n >= current), current + 1) +
                  0.5
                : Math.max(...values.filter((n) => n <= current), current - 1) -
                  0.5;
        queue();
      });
    for (const e of bar.querySelectorAll("[data-frame]"))
      listen(e, "change", () => {
        if (!model || model.cell || model.frames) return;
        const n = +e.value;
        if (!Number.isFinite(n)) return;
        remember();
        model.frame[e.dataset.frame] = n;
        model.growth = "fixed";
        model.allowOverflow = false;
        positionFrame();
        queue();
        input.focus({ preventScroll: true });
      });
    let overlapping = [];
    function drawOverlapSelect() {
      if (!model) return;
      const f = model.frame,
        intersects = (b) =>
          b.x < f.x + f.width &&
          b.x + b.width > f.x &&
          b.y < f.y + f.height &&
          b.y + b.height > f.y;
      const used = new Set(
        (S.nativeEdits || [])
          .filter((e) => e.page === page && e.type === "flow")
          .flatMap((e) => e.sources.map((s) => s.index)),
      );
      overlapping = [
        ...(S.nativeEdits || [])
          .filter(
            (e) =>
              e.page === page &&
              e.type === "flow" &&
              e.id !== id &&
              intersects(e.model.frame),
          )
          .map((e) => ({ model: e.model, id: e.id })),
        ...candidates
          .filter(
            (c) =>
              intersects(c.model.frame) &&
              !c.reason &&
              !c.model.sources.some(
                (s) =>
                  used.has(s.index) ||
                  model.sources.some((q) => q.index === s.index),
              ),
          )
          .map((c) => ({ model: c.model, id: null })),
      ];
      const select = bar.querySelector("#pe-overlap-select");
      select.replaceChildren(new Option("选择重叠段落…", ""));
      overlapping.forEach((e, i) =>
        select.add(
          new Option(e.model.text.slice(0, 35) || "空文本框", String(i)),
        ),
      );
      select.disabled = !overlapping.length;
    }
    listen(bar.querySelector("#pe-overlap-select"), "change", (e) => {
      if (e.target.value === "") return;
      const item = overlapping[+e.target.value];
      guarded(() => activate(item.model, item.id));
    });
    const togglePanel = (selector, visible) => {
      bar.querySelector(selector).hidden = !visible;
    };
    listen(bar.querySelector("#pe-more"), "click", () => {
      const open = bar.querySelector(".pe-properties").hidden;
      togglePanel(".pe-properties", open);
      bar.querySelector("#pe-more").setAttribute("aria-expanded", open);
      togglePanel(".pe-font-panel", false);
    });
    listen(bar.querySelector("#pe-close-properties"), "click", () => {
      togglePanel(".pe-properties", false);
      bar.querySelector("#pe-more").setAttribute("aria-expanded", "false");
    });
    listen(bar.querySelector("#pe-close-font"), "click", () =>
      togglePanel(".pe-font-panel", false),
    );
    listen(bar.querySelector("#pe-growth"), "change", (e) => {
      if (!model) return;
      remember();
      model.growth = e.target.value;
      delete model.preserveAlignmentWidth;
      model.allowOverflow = false;
      showFields();
      queue();
      input.focus({ preventScroll: true });
    });
    listen(bar.querySelector("#pe-layout-mode"), "change", () => {
      if (!model)return;remember();model.layoutMode=bar.querySelector("#pe-layout-mode").value;queue();
    });
    listen(bar.querySelector("#pe-recommend"), "click", () => {
      if (!model) return;
      remember();
      const q = suggestGrowth(
        model,
        result.objects,
        ai.regions || [],
        S.nativeEdits || [],
        page,
        id,
      );
      model.growth = "auto";
      delete model.preserveAlignmentWidth;
      model.growthDirection = q.direction;
      model.growthReason = q.reason;
      model.allowOverflow = false;
      showFields();
      queue();
    });
    listen(bar.querySelector("#pe-accept"), "click", () => {
      acceptedConflicts = JSON.stringify(
        lastConflicts.map((c) => [c.kind, c.bounds]),
      );
      bar.querySelector(".pe-notice").hidden = true;
      status("已保留重叠效果，可完成编辑或保存");
    });
    listen(bar.querySelector("#pe-warning-only"), "change", (e) => {
      ignoreConflicts = e.target.checked;
      if (ignoreConflicts) bar.querySelector(".pe-notice").hidden = true;
    });
    listen(bar.querySelector("#pe-overflow"), "click", () => {
      if (!model) return;
      remember();
      model.allowOverflow = true;
      queue();
      input.focus({ preventScroll: true });
    });
    listen(bar.querySelector("#pe-full-diff"), "click", () =>
      guarded(() => ctx.openPageDiff()),
    );
    listen(bar.querySelector("#pe-compare"), "click", () => {
      const on = !layer.classList.contains("compare-original");
      layer.classList.toggle("compare-original", on);
      bar.querySelector("#pe-compare").setAttribute("aria-pressed", on);
      bar.querySelector("#pe-compare").textContent = on
        ? "返回编辑效果"
        : "原文对照";
      input.disabled = on;
    });
    listen(bar.querySelector("#pe-default-style"), "click", () => {
      if (!model) return;
      const r =
        (model.runs || []).find(
          (r) =>
            r.start <= input.selectionStart && r.end > input.selectionStart,
        ) || model;
      localStorage.setItem(
        "folio-new-text-style",
        JSON.stringify({
          ...r,
          start: undefined,
          end: undefined,
          lineHeight: model.lineHeight,
          align: model.align,
        }),
      );
      status("已保存新增文字的默认样式");
    });
    listen(bar.querySelector("#pe-problems"), "click", () => {
      ignoreConflicts = false;
      acceptedConflicts = "";
      bar.querySelector("#pe-warning-only").checked = false;
      queue();
    });
    listen(bar.querySelector("#pe-copy-style"), "click", () => {
      if (!model) return;
      const r =
        (model.runs || []).find(
          (r) =>
            r.start <= input.selectionStart && r.end > input.selectionStart,
        ) || model;
      styleClipboard = Object.fromEntries(
        [
          "fontKey",
          "fontName",
          "size",
          "color",
          "charSpacing",
          "wordSpacing",
          "bold",
          "italic",
          "latinFontKey",
          "latinFontName",
          "cjkFontKey",
          "cjkFontName",
        ]
          .filter((k) => r[k] != null)
          .map((k) => [k, r[k]]),
      );
      styleClipboard = {
        character: styleClipboard,
        paragraph: Object.fromEntries(
          [
            "lineHeight",
            "paragraphGap",
            "paragraphBefore",
            "firstIndent",
            "align",
          ].map((k) => [
            k,
            model[k] ?? (k === "lineHeight" ? 1.4 : k === "align" ? "left" : 0),
          ]),
        ),
      };
      bar.querySelector("#pe-paste-style").disabled = false;
      status("样式已吸取，选择目标文字后应用");
    });
    listen(bar.querySelector("#pe-paste-style"), "click", () => {
      if (!model || !styleClipboard) return;
      remember();
      const scope = bar.querySelector("#pe-style-scope").value;
      if (scope !== "paragraph")
        rangeStyle(
          model,
          input.selectionStart,
          input.selectionEnd,
          styleClipboard.character,
        );
      if (scope !== "character") Object.assign(model, styleClipboard.paragraph);
      showFields();
      queue();
      input.focus({ preventScroll: true });
    });
    let fontRecommendations = [];
    let fontObserver = null;
    let fontSearchTimer = null;
    signal.signal.addEventListener("abort", () => { fontObserver?.disconnect(); clearTimeout(fontSearchTimer); }, { once: true });
    const drawFonts = () => {
      fontObserver?.disconnect();
      const previews = new WeakMap();
      fontObserver = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) {
          fontObserver.unobserve(entry.target);
          const show = previews.get(entry.target);
          fontPreviewQueue = fontPreviewQueue.then(show, show);
        }
      }, { root: bar.querySelector("#pe-font-list"), rootMargin: "36px" });
      const list = bar.querySelector("#pe-font-list"),
        query = bar.querySelector("#pe-font-search").value.toLowerCase();
      list.replaceChildren();
      const documentFonts = Object.values(result.fonts || {}).map((f) => ({
        ...f,
        source: "文档字体",
        name: f.fontName,
      }));
      const recent = JSON.parse(
        localStorage.getItem("folio-recent-fonts") || "[]",
      );
      const all = [
        ...fontRecommendations.map(f=>({...f,source:"字形推荐 · "+f.match+" · "+f.evidence+" 字证据"})),
        ...recent.map((f) => ({ ...f, source: "最近使用" })),
        ...documentFonts,
        ...(fontCatalog || []),
      ];
      let group = "";
      const seen = new Set();
      for (const f of all.filter((f) =>
        [
          fontLabel(f.name || f.fontName),
          f.name,
          f.fontName,
          f.family,
          f.postScriptName,
          ...(f.aliases || []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )) {
        const identity = f.id || f.fontKey || f.fontName;
        if (seen.has(identity)) continue;
        seen.add(identity);
        if (f.source !== group) {
          const h = document.createElement("h4");
          h.textContent = f.source;
          list.append(h);
          group = f.source;
        }
        const b = document.createElement("button");
        b.textContent = fontLabel(f.name || f.fontName);
        b.title = f.name || f.fontName;
        if (f.family)
          b.style.fontFamily = JSON.stringify(f.family) + ",sans-serif";
        b.dataset.fontFamily = f.family || f.fontName || "";
        // System faces are already installed: use their own family directly.
        // Only embedded faces need a small subset containing the displayed name.
        if (f.fontKey && !f.id) {
          const key = f.fontKey, label = b.textContent, cacheKey = key + ":" + label;
          const show = async () => {
            if (closed || !b.isConnected || bar.querySelector(".pe-font-panel").hidden) return;
            try {
              if (!previewFontCache.has(cacheKey)) previewFontCache.set(cacheKey, (async () => {
                const data = await call("font-data", { fontKey: key, previewText: label });
                const family = "FolioPreview_" + key;
                const face = new FontFace(family, Uint8Array.from(atob(data.base64), c => c.charCodeAt(0)));
                await face.load(); document.fonts.add(face);
                return {face, family};
              })());
              const data = await previewFontCache.get(cacheKey);
              if (!closed && b.isConnected) b.style.fontFamily = JSON.stringify(data.family) + ",sans-serif";
              while (previewFontCache.size > 64) {
                const old = previewFontCache.keys().next().value;
                previewFontCache.get(old).then(v => document.fonts.delete(v.face)).catch(() => {});
                previewFontCache.delete(old);
              }
            } catch {
              previewFontCache.delete(cacheKey);
              b.title += " · 名称预览使用系统字体";
            }
          };
          previews.set(b, show);
          fontObserver.observe(b);
        }

        b.title =
          b.textContent +
          (f.fontKey
            ? " · 可编辑（字符覆盖按原字体）"
            : f.id
              ? " · 本机字体"
              : " · 原字体不可复用");
        b.disabled = !f.fontKey && !f.id;
        b.onclick = () =>
          guarded(async () => {
            if (!model) return;
            const target = id;
            const chosen = f.id
              ? await call("font-select", { fontId: f.id })
              : f;
            if (closed || target !== id || !model) return;
            remember();
            const scope = bar.querySelector("#pe-font-script").value;
            const patch =
              scope === "latin"
                ? {
                    latinFontKey: chosen.fontKey,
                    latinFontName: chosen.fontName,
                  }
                : scope === "cjk"
                  ? { cjkFontKey: chosen.fontKey, cjkFontName: chosen.fontName }
                  : {
                      fontKey: chosen.fontKey,
                      fontName: chosen.fontName,
                      latinFontKey: null,
                      latinFontName: null,
                      cjkFontKey: null,
                      cjkFontName: null,
                    };
            rangeStyle(model, input.selectionStart, input.selectionEnd, patch);
            localStorage.setItem(
              "folio-recent-fonts",
              JSON.stringify(
                [
                  { ...f, ...chosen, name: chosen.fontName },
                  ...recent.filter(
                    (r) => (r.fontKey || r.id) !== (chosen.fontKey || f.id),
                  ),
                ].slice(0, 8),
              ),
            );
            togglePanel(".pe-font-panel", false);
            bar.querySelector("#pe-font").textContent = fontLabel(
              chosen.fontName,
            );
            queue();
            input.focus({ preventScroll: true });
          });
        list.append(b);
      }
    };
    listen(bar.querySelector("#pe-font"), "click", () =>
      guarded(async () => {
        togglePanel(".pe-properties", false);
        togglePanel(".pe-font-panel", true);
        drawFonts();
        bar.querySelector("#pe-font-search").focus();
        if (!fontCatalog) {
          status("正在读取本机字体…");
          if (!fontCatalogPromise) fontCatalogPromise = call("font-catalog").catch(e => { fontCatalogPromise = null; throw e; });
          const r = await fontCatalogPromise;
          if (closed) return;
          fontCatalog = r.fonts;
          drawFonts();
          status("选择字体，可在原页预览排版");
        }
      }),
    );
    listen(bar.querySelector("#pe-font-match"), "click", () => guarded(async () => {
      if (!model?.fontKey) { status("此段原字体不可提取，暂无法比较字形",true);return; }
      const target=id, key=model.fontKey, button=bar.querySelector("#pe-font-match");button.disabled=true;
      bar.querySelector("#pe-font-evidence").textContent="正在比较实际轮廓和字宽…";
      try {
        const r=await call("font-recommend",{fontKey:key,sample:model.text,missing:model.text});
        if (closed || target!==id || key!==model?.fontKey)return;
        fontRecommendations=r.fonts;drawFonts();
        bar.querySelector("#pe-font-evidence").textContent=r.fonts.length ? "按轮廓与字宽排序；样本一致不代表整套字体已被证明相同。" : "本机没有覆盖全文且具有足够字形证据的候选。";
      } finally { if (!closed) button.disabled=false; }
    }));
    listen(bar.querySelector("#pe-font-search"), "input", () => {
      clearTimeout(fontSearchTimer); fontSearchTimer = setTimeout(drawFonts, 100);
    });
    listen(bar.querySelector("#pe-fallback"), "click", () => {
      const p = bar.querySelector("#pe-fallback-panel");
      p.replaceChildren();
      p.hidden = false;
      const close = document.createElement("button");
      close.textContent = "关闭替代详情";
      close.onclick = () => (p.hidden = true);
      p.append(close);
      for (const f of preview?.fallbackDetails || []) {
        const b = document.createElement("button");
        b.textContent = `${f.text}：${f.original} → ${f.actual}${f.match ? ` · ${f.match}（${f.confidence}置信）` : ""}`;
        b.onclick = () => {
          input.setSelectionRange(f.start, f.end);
          input.focus({ preventScroll: true });
          selection();
        };
        p.append(b);
      }
    });
    listen(bar.querySelector("#pe-link"), "click", () => {
      if (!model) {
        status("先点击需要接续的第一段");
        return;
      }
      linkMode = linkMode === "chain" ? false : "chain";
      bar.querySelector("#pe-link").setAttribute("aria-pressed", linkMode);
      hits.style.pointerEvents = linkMode ? "auto" : "";
      status("点击下一个文本框：保留各框边界，按连接顺序续排");
    });
    listen(bar.querySelector("#pe-new"), "click", () =>
      guarded(async () => {
        await finish(false);
        newMode = true;
        bar.querySelector("#pe-new").setAttribute("aria-pressed", "true");
        status("点击页面空白处添加文字");
      }),
    );
    listen(bar.querySelector("#pe-cancel"), "click", cancelDraft);
    listen(bar.querySelector("#pe-tables"), "click", () => {
      const found = candidates.filter((c) => c.model.cell);
      layer.classList.toggle("show-table-cells");
      bar
        .querySelector("#pe-tables")
        .setAttribute(
          "aria-pressed",
          layer.classList.contains("show-table-cells"),
        );
      status(
        found.length
          ? `已识别 ${result.tables.length} 个表格，点击单元格直接编辑；Tab / Shift+Tab 切换`
          : "当前页未检测到可编辑的有线表格",
      );
    });
    listen(bar.querySelector("#pe-done"), "click", () =>
      guarded(() => finish(true)),
    );
    function cancelDraft() {
      revision++;
      clearTimeout(timer);
      model = null;
      preview = null;
      initial = null;
      id = null;
      S.flowDraftDirty = false;
      showCollisions([]);
      bar.querySelector("strong").textContent = "页面编辑";
      bar.querySelector(".pe-notice").hidden = true;
      bar.querySelector("#pe-fallback").hidden = true;
      layer.classList.remove("compare-original");
      input.disabled = false;
      bar.querySelector("#pe-compare").textContent = "原文对照";
      bar.querySelector("#pe-compare").setAttribute("aria-pressed", "false");
      ink.hidden = base.hidden = frame.hidden = true;
      marks.replaceChildren();
      input.blur();
      composition.hidden = true;
      window.desktop?.setDirty?.(S.dirty);
      candidateButtons();
      status("已取消本段，原 PDF 未改变。点击段落继续编辑。");
    }
    async function finish(exit = false) {
      if (busy) throw Error("正在准备页面，请稍候");
      if (composing) throw Error("请先完成当前输入法组词");
      if (model && S.flowDraftDirty) {
        await reflow();
        if (validRevision !== revision || !preview)
          throw Error(bar.querySelector("#pe-status").textContent);
        busy = true;
        input.disabled = true;
        try {
          const edits = clone(S.nativeEdits || []).filter((e) => e.id !== id);
          const entry = {
            id,
            page,
            type: "flow",
            index: null,
            sources: clone(model.sources),
            model: clone(model),
            fragment: preview.fragment,
            ink: clone(preview.glyphs),
          };
          const at = (S.nativeEdits || []).findIndex((e) => e.id === id);
          if (at < 0) edits.push(entry);
          else edits.splice(at, 0, entry);
          await arrangedEdits(edits);
          await refreshNative(edits, S.ocr || [], S.ocrReference);
          commit(clone(S.nodes), { nativeEdits: edits });
        } finally {
          busy = false;
          input.disabled = false;
        }
      }
      cancelDraft();
      if (exit) destroy();
      else mount();
    }
    function destroy() {
      closed = true;
      revision++;
      clearTimeout(timer);
      clearTimeout(backgroundTimer);
      backgroundSerial++;
      backgroundTask?.cancel();
      background?.destroy();
      signal.abort();
      observer.disconnect();
      resizeObserver.disconnect();
      layer.remove();
      bar.remove();
      document.body.classList.remove("page-edit-mode");
      document
        .querySelector('[data-action="flow-edit"]')
        ?.setAttribute("aria-pressed", "false");
      S.flowDraftDirty = false;
      S.flowEdit = null;
      session = null;
    }
    for (const [id, iconName, label] of [
      ["pe-link", "link", "连接文本框"],
      ["pe-new", "text", "添加文字"],
      ["pe-cancel", "undo", "取消"],
      ["pe-done", "check", "完成编辑"],
    ])
      bar.querySelector("#" + id).innerHTML =
        `<i data-icon="${iconName}"></i>${label}`;
    icons(bar);
    candidateButtons();
    status(candidates.length ? `第 ${page} 页 · 点击原页文字开始编辑 · 版式分析在后台进行` : `第 ${page} 页 · 没有可直接替换的文字，可在格式面板添加文字；版式分析在后台进行`);
    return {
      page,
      mount,
      finish,
      updateAI: (r) => {
        if (closed) return;
        ai = r;
        if (!model) {
          status(
            ai.error
              ? "版式分析暂不可用，当前使用几何布局"
              : `第 ${page} 页 · 已识别版面，可点击文字开始编辑`,
          );
          bar.querySelector("#pe-status").title = ai.error || "";
        }
        candidates = pageCandidates(
          result.objects,
          w,
          h,
          ai.regions || [],
          result.tables || [],
        );
        candidateButtons();
      },
      draft: () =>
        model && S.flowDraftDirty
          ? {
              page,
              id,
              model: clone(model),
              initial,
              start: input.selectionStart,
              end: input.selectionEnd,
            }
          : null,
      restoreDraft: async (d) => {
        await activate(d.model, d.id);
        initial = d.initial;
        input.setSelectionRange(d.start, d.end);
        queue();
      },
      flush: () => finish(false),
      destroy,
      get editing() {
        return !!model;
      },
    };
  }
  return start;
}

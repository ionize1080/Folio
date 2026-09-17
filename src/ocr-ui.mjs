import { readReview, writeReview } from "./ocr-review-store.mjs";
import { createOCRStream } from "./ocr-stream.mjs";
import { selectRegion } from "./region-select.mjs";
import { ocrPage } from "./ocr-data.mjs";
import { installPagePicker } from "./page-picker.mjs";
import { pageRange } from "./generation.mjs";
export async function ocrDialogV4(ctx) {
  const {
      S,
      surface,
      modal,
      closeModal,
      esc,
      commit,
      refreshNative,
      guarded,
      toast,
      setCleanup,
    } = ctx,
    $ = (s) => document.querySelector(s);
  if (!S.pdf) return;
  let closed = false,
    running = false,
    applying = false,
    cancelApply = false,
    nativeStarted = false,
    job = null,
    info = null,
    reviewPage = S.page,
    pageBlocks = [],
    selected = -1,
    renderTask,
    epoch = 0,
    pollTimer,
    dirtyPage = false,
    draftDirty = false,
    keepRunning = false,
    loadedRevision = -1,
    saveChain = Promise.resolve(),
    stream = null,
    composing = false;
  const reviewKey = "folio-ocr-review-" + (S.fingerprint || S.name);
  const checked = new Set(
    JSON.parse(localStorage.getItem(reviewKey + "-checked") || "[]"),
  );
  const markKey = (p, b) => JSON.stringify([p, b.quad, b.text]);
  const localCorrections = await readReview(reviewKey),
    states = new Map();
  const preferences = () => ({
    languages: [
      ...document.querySelectorAll('[name="ocr-language"]:checked'),
    ].map((e) => e.value),
    allowOther: $("#ocr-other-language").checked,
    outputScript: $("#ocr-output-script").value,
  });
  const donePages = () =>
    [...states.values()]
      .filter((s) => ["done", "skipped"].includes(s.state))
      .map((s) => s.page);
  function mergeInfo(next) {
    if (!next || (job && next.id !== job)) return false;
    if (next.states) {
      states.clear();
      for (const s of next.states) states.set(s.page, s);
    }
    for (const s of next.changes || []) states.set(s.page, s);
    info = { ...next, done: donePages() };
    stream?.setPages([...states.keys()]);
    if (next.changes?.length) stream?.refresh();
    return true;
  }
  const api = async (data) => {
    if (!window.desktop?.ocrJob) throw Error("请使用完整 0.5 桌面运行包");
    return window.desktop.ocrJob(data);
  };
  modal(
    "离线 OCR · 双层 PDF",
    `<details class="ocr-settings" open><summary>识别范围与设置</summary><label>处理页面<input id="ocr-range" value="${S.page}"></label><div class="form-grid three"><label>模型<select id="ocr-profile"><option value="v6">PP-OCRv6 small</option><option value="v5">PP-OCRv5 mobile</option></select></label><label>分辨率<select id="ocr-dpi"><option>180</option><option>240</option><option>300</option></select></label><label>资源模式<select id="ocr-mode"><option value="auto">自动 · 兼顾内存与响应</option><option value="low">低占用</option><option value="high">高性能</option><option value="custom">自定义</option></select></label></div><div class="form-grid three" id="ocr-custom" hidden><label>并行页数<input id="ocr-workers" type="number" min="1" max="16" value="2"></label><label>每进程线程<input id="ocr-threads" type="number" min="1" value="2"></label><label>文字行批量<input id="ocr-batch" type="number" min="1" max="32" value="6"></label></div><div class="menu-grid"><label class="check"><input id="ocr-skip" type="checkbox" checked>跳过已有文字的整页</label><select id="ocr-skip-mode" aria-label="跳过策略"><option value="coverage">智能：正文文字充足才跳过</option><option value="any">任意已有文字（旧版策略）</option></select><label class="check"><input id="ocr-resume" type="checkbox" checked>续做相同文档与设置的已完成页</label></div><details><summary>语言与输出文字</summary><div class="menu-grid"><label class="check"><input type="checkbox" name="ocr-language" value="zh-Hans" checked>简体中文</label><label class="check"><input type="checkbox" name="ocr-language" value="zh-Hant">繁体中文</label><label class="check"><input type="checkbox" name="ocr-language" value="en" checked>英文</label></div><label class="check"><input id="ocr-other-language" type="checkbox" checked>保留引擎识别出的其他文字</label><label>输出字形<select id="ocr-output-script"><option value="preserve">保留原始识别</option><option value="simplified">统一为简体</option><option value="traditional">统一为繁体</option></select></label><p>语言勾选用于校对提示；不扩展模型的语言能力。字形转换在识别后进行，原始文字保留，置信度仍是引擎原始分数。</p></details><details><summary>局部识别区域</summary><p>相对左上角百分比：左、上、宽、高。局部识别不会因页面其他区域有文字而跳过。</p><input id="ocr-region" placeholder="例如 0,10,100,80"><button id="ocr-region-pick">在左侧拖框选择区域</button><button id="ocr-region-clear">清除区域</button></details></details><div class="menu-grid"><button id="ocr-start" class="primary">开始识别</button><button id="ocr-stop" disabled>停止并保留结果</button><button id="ocr-cancel-apply" hidden>取消应用</button><label class="check"><input id="ocr-box-preview" type="checkbox" checked>识别框</label><label class="check"><input id="ocr-text-preview" type="checkbox">识别文字</label><label class="check"><input id="ocr-image-preview" type="checkbox" checked>原图</label></div><p id="ocr-status" class="callout">完全离线 · 原扫描图保留 · 识别结果逐页保存；关闭后可按相同设置续做。</p><details id="ocr-errors" class="callout" hidden><summary>失败详情</summary><pre id="ocr-error-detail" style="white-space:pre-wrap;max-height:180px;overflow:auto;user-select:text"></pre></details><div class="ocr-review-nav"><strong>正在校对</strong><select id="ocr-scroll-mode" aria-label="校对浏览方式"><option value="continuous">连续滚动</option><option value="single">单页</option></select><button id="ocr-prev">上一页</button><input id="ocr-review-page" type="number" min="1" max="${S.info.pageCount}" value="${S.page}" aria-label="校对 PDF 页"><span>/ ${S.info.pageCount}</span><button id="ocr-next">下一页</button><button id="ocr-low">下一处待复核</button><button id="ocr-reviewed" title="Ctrl+Enter">确认并下一处</button><button id="ocr-defer">暂缓</button><span id="ocr-review-lock"></span><label>页状态<select id="ocr-page-filter"><option value="all">全部</option><option value="done">已识别</option><option value="low">需校对</option><option value="failed">失败</option><option value="skipped">跳过</option></select></label><select id="ocr-page-list" aria-label="识别页状态"></select></div><div class="native-workspace"><div class="native-preview"><canvas id="ocr-canvas"></canvas><div id="ocr-boxes"></div></div><div class="native-properties"><label>本页识别结果<select id="ocr-results" size="7"></select></label><p id="ocr-confidence"></p><label>校对文字<textarea id="ocr-correction" rows="3"></textarea></label><details><summary>调整四角 PDF 坐标</summary><textarea id="ocr-quad" rows="3"></textarea></details><label class="check"><input id="ocr-exclude" type="checkbox">不写入此条</label><button id="ocr-correct">保存此条校对</button><small>切换条目、翻页和应用前会自动保存。关闭窗口前也会保存。</small><div id="ocr-font-issues" class="callout" hidden></div></div></div>`,
    [
      {
        text: "收起并继续",
        run: async () => {
          if (applying) return;
          await savePage();
          keepRunning = true;
          closeModal();
        },
      },
      {
        text: "关闭",
        run: async () => {
          if (applying) return;
          await savePage();
          closeModal();
        },
      },
      {
        text: "应用 OCR 文字层",
        id: "ocr-apply",
        primary: true,
        run: () => applyResults(false),
      },
    ],
  );
  $("#modal").classList.add("native-dialog", "ocr-dialog");
  try {
    const pref = JSON.parse(
      localStorage.getItem("folio-ocr-language") || "null",
    );
    if (pref) {
      for (const el of document.querySelectorAll('[name="ocr-language"]'))
        el.checked = pref.languages.includes(el.value);
      $("#ocr-other-language").checked = pref.allowOther;
      $("#ocr-output-script").value = pref.outputScript;
    }
  } catch {}
  const closeButton = $("#modal-close"),
    previousClose = closeButton.onclick;
  const saveAndClose = () =>
    guarded(async () => {
      if (!applying) {
        await savePage();
        closeModal();
      }
    });
  closeButton.onclick = saveAndClose;
  const cancelDialog = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    saveAndClose();
  };
  $("#modal").addEventListener("cancel", cancelDialog, true);
  $("#ocr-cancel-apply").onclick = () => {
    cancelApply = true;
    if (nativeStarted) window.desktop?.cancelNative?.();
  };
  const disposePicker = installPagePicker($("#ocr-range"), { S, surface });
  $("#ocr-mode").onchange = () =>
    ($("#ocr-custom").hidden = $("#ocr-mode").value !== "custom");
  function captureDraft() {
    if (!draftDirty || selected < 0) return;
    let q;
    try {
      q = JSON.parse($("#ocr-quad").value);
    } catch {
      throw Error("四角坐标须为四组有限数值");
    }
    if (
      !Array.isArray(q) ||
      q.length !== 4 ||
      q.some(
        (p) =>
          !Array.isArray(p) ||
          p.length !== 2 ||
          p.some((x) => !Number.isFinite(x)),
      )
    )
      throw Error("四角坐标须为四组有限数值");
    const old = pageBlocks[selected];
    pageBlocks[selected] = {
      ...old,
      originalText: old.originalText ?? old.rawText ?? old.text,
      text: $("#ocr-correction").value,
      rawText: $("#ocr-correction").value,
      quad: q,
      excluded: $("#ocr-exclude").checked,
      corrected: true,
    };
    draftDirty = false;
    dirtyPage = true;
    const option = $("#ocr-results").querySelector(
      `option[value="${selected}"]`,
    );
    if (option)
      option.textContent = `${pageBlocks[selected].excluded ? "× " : ""}${Math.round(old.confidence * 100)}% · ${pageBlocks[selected].text.slice(0, 65)}`;
  }
  async function savePage() {
    captureDraft();
    if (!dirtyPage) return saveChain;
    const p = reviewPage,
      blocks = structuredClone(pageBlocks);
    dirtyPage = false;
    const write = async () => {
      try {
        if (job && donePages().includes(p))
          await api({ action: "correct", id: job, page: p, blocks });
        else {
          await writeReview(reviewKey, p, blocks);
          localCorrections.set(p, blocks);
        }
      } catch (e) {
        if (p === reviewPage) dirtyPage = true;
        throw e;
      }
    };
    saveChain = saveChain.then(write, write);
    return saveChain;
  }
  async function applyResults(excludeUnsupported) {
    if (running || applying) return;
    applying = true;
    cancelApply = false;
    nativeStarted = false;
    $("#ocr-apply").disabled = true;
    $("#ocr-cancel-apply").hidden = false;
    const locked = [
      ...document.querySelectorAll(
        "#modal-body input, #modal-body textarea, #modal-body select, #modal-body button:not(#ocr-cancel-apply), #modal-footer button",
      ),
    ].map((el) => [el, el.disabled]);
    for (const [el] of locked) el.disabled = true;
    const unsubscribe = window.desktop?.onNativeProgress?.((p) => {
      if (!closed)
        $("#ocr-status").textContent =
          p.stage === "cache"
            ? "复用已构建内容，请稍候…"
            : `正在写入第 ${p.page} 页；完成后可撤销，请稍候…`;
    });
    try {
      await savePage();
      let base = S.ocr || [];
      for (const [p, bs] of localCorrections)
        base = base.filter((b) => b.page !== p).concat(bs);
      $("#ocr-status").textContent = "正在检查字体并准备文字层…";
      const r = await api({
        action: "collect",
        id: job || undefined,
        base,
        preferences: preferences(),
        excludeUnsupported,
      });
      if (cancelApply) throw Error("应用已取消，识别结果仍保留");
      if (!r.reference) {
        const host = $("#ocr-font-issues");
        host.hidden = false;
        host.innerHTML = `<strong>${r.count} 条文字含当前字体不支持的字符</strong><p>请先校对，或明确排除这些条目后应用其余结果。原 PDF 尚未改变。</p><div style="max-height:160px;overflow:auto">${r.issues.map((i) => `<p>第 ${i.page} 页 · ${esc(i.characters.join("、"))} · ${esc(i.text.slice(0, 80))}</p>`).join("")}</div><button id="ocr-exclude-unsupported">排除上述缺字条目并应用</button>`;
        host.scrollIntoView({ block: "nearest" });
        $("#ocr-exclude-unsupported").onclick = () =>
          guarded(() => applyResults(true));
        $("#ocr-status").textContent = "字体检查发现问题，请在右侧处理后重试。";
        return;
      }
      nativeStarted = true;
      await refreshNative(S.nativeEdits || [], r.blocks, r.reference);
      commit(structuredClone(S.nodes), {
        ocr: r.blocks,
        ocrReference: r.reference,
      });
      closeModal();
      toast(
        `已应用 ${r.blocks.filter((b) => !b.excluded).length} 条文字，可撤销；请保存 PDF${r.count ? `（已排除 ${r.count} 条缺字结果）` : ""}`,
      );
    } finally {
      unsubscribe?.();
      applying = false;
      for (const [el, disabled] of locked) el.disabled = disabled;
      if (!closed) $("#ocr-cancel-apply").hidden = true;
      if (!closed) $("#ocr-apply").disabled = false;
    }
  }
  let stopRegion;
  function boxes(view) {
    if (closed) return;
    if (view) boxes.view = view;
    view = boxes.view;
    if (!view) return;
    const host = $("#ocr-boxes");
    host.replaceChildren();
    const showBox = $("#ocr-box-preview").checked,
      showText = $("#ocr-text-preview").checked;
    $("#ocr-canvas").style.visibility = $("#ocr-image-preview").checked
      ? "visible"
      : "hidden";
    if (!showBox && !showText) return;
    pageBlocks.forEach((b, i) => {
      const q = b.quad.map((q) => view.convertToViewportPoint(...q)),
        xs = q.map((p) => p[0]),
        ys = q.map((p) => p[1]),
        el = document.createElement("button");
      el.className =
        "ocr-hit" +
        (showText ? " show-text" : "") +
        (i === selected ? " selected" : "") +
        (b.excluded ? " excluded" : "");
      el.title = b.text;
      el.textContent = showText ? b.text : "";
      el.style.cssText = `left:${Math.min(...xs)}px;top:${Math.min(...ys)}px;width:${Math.max(...xs) - Math.min(...xs)}px;height:${Math.max(...ys) - Math.min(...ys)}px;font-size:${(Math.max(...ys) - Math.min(...ys)) * 0.8}px;${showBox ? "" : "border-color:transparent;"}`;
      el.onclick = (e) => {
        e.stopPropagation();
        guarded(() => select(i, false));
      };
      el.dataset.index = i;
      host.append(el);
    });
  }
  function list() {
    if (closed) return;
    $("#ocr-results").innerHTML = pageBlocks
      .map(
        (b, i) =>
          `<option value="${i}">${b.excluded ? "× " : ""}${Math.round(b.confidence * 100)}% · ${esc(b.text.slice(0, 65))}</option>`,
      )
      .join("");
    $("#ocr-confidence").textContent =
      `第 ${reviewPage} 页 · ${pageBlocks.length} 条文字`;
    selected = -1;
    $("#ocr-correction").value = "";
    $("#ocr-quad").value = "";
    boxes();
  }
  function select(i, reveal = true) {
    if (closed) return;
    captureDraft();
    const b = pageBlocks[i];
    if (!b) return;
    const prior = selected;
    selected = i;
    stream?.pin();
    $("#ocr-results").value = i;
    $("#ocr-correction").value = b.text;
    $("#ocr-quad").value = JSON.stringify(b.quad);
    $("#ocr-exclude").checked = !!b.excluded;
    $("#ocr-confidence").textContent =
      `第 ${reviewPage} 页 · 置信度 ${(b.confidence * 100).toFixed(1)}%${b.confidence < 0.85 ? " · 建议核对" : ""}`;
    $("#ocr-confidence").textContent += b.normalized
      ? " · 已转换字形"
      : b.scriptIssue
        ? " · 字形与语言偏好不一致"
        : "";
    $("#ocr-correction").title =
      `原始文字：${b.originalText ?? b.rawText ?? b.text}`;
    $("#ocr-boxes")
      .querySelector(`[data-index="${prior}"]`)
      ?.classList.remove("selected");
    $("#ocr-boxes")
      .querySelector(`[data-index="${i}"]`)
      ?.classList.add("selected");
    const list = $("#ocr-results"),
      option = list.options[i];
    if (option) {
      const height =
        option.getBoundingClientRect().height || list.clientHeight / 7;
      const top = i * height;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (top + height > list.scrollTop + list.clientHeight)
        list.scrollTop = top + height - list.clientHeight;
    }
    if (reveal && boxes.view) {
      const host = $("#ocr-canvas").closest(".native-preview");
      const q = b.quad.map((p) => boxes.view.convertToViewportPoint(...p));
      const canvas = $("#ocr-canvas"),
        cr = canvas.getBoundingClientRect(),
        hr = host.getBoundingClientRect();
      const x = cr.left - hr.left + host.scrollLeft - host.clientLeft;
      const y = cr.top - hr.top + host.scrollTop - host.clientTop;
      const revealAxis = (lo, hi, scroll, size) =>
        lo < scroll + 20
          ? Math.max(0, lo - 20)
          : hi > scroll + size - 20
            ? Math.max(0, Math.min(lo - 20, hi - size + 20))
            : scroll;
      host.scrollLeft = revealAxis(
        x + Math.min(...q.map((p) => p[0])),
        x + Math.max(...q.map((p) => p[0])),
        host.scrollLeft,
        host.clientWidth,
      );
      host.scrollTop = revealAxis(
        y + Math.min(...q.map((p) => p[1])),
        y + Math.max(...q.map((p) => p[1])),
        host.scrollTop,
        host.clientHeight,
      );
    }
  }
  async function loadPage(p, render = true, reveal = true) {
    if (composing) return;
    if (closed) return;
    if (!Number.isInteger(p) || p < 1 || p > S.info.pageCount)
      throw Error("校对页码超出范围");
    const rev = ++epoch;
    await savePage();
    if (closed || rev !== epoch) return;
    renderTask?.cancel();
    const blocks =
      job && donePages().includes(p)
        ? (
            await api({
              action: "page",
              id: job,
              page: p,
              preferences: preferences(),
            })
          ).blocks
        : structuredClone(localCorrections.get(p) || ocrPage(S.ocr, p));
    if (closed || rev !== epoch) return;
    reviewPage = p;
    stream?.move(p, reveal);
    localStorage.setItem(reviewKey, JSON.stringify({ page: p }));
    pageBlocks = blocks;
    selected = -1;
    draftDirty = false;
    loadedRevision = states.get(p)?.revision ?? info?.revision ?? 0;
    $("#ocr-review-page").value = p;
    $("#ocr-page-list").value = p;
    list();
    if (!render) return;
    const page = await S.pdf.getPage(p);
    if (closed || rev !== epoch) return;
    const base = page.getViewport({ scale: 1, rotation: surface.rotation(p) }),
      view = page.getViewport({
        scale: Math.min(
          680 / base.width,
          Math.max(
            100,
            $("#ocr-canvas").closest(".native-preview").clientWidth - 34,
          ) / base.width,
          1.2,
        ),
        rotation: surface.rotation(p),
      }),
      ratio = Math.min(devicePixelRatio || 1, 2),
      off = document.createElement("canvas");
    off.width = Math.ceil(view.width * ratio);
    off.height = Math.ceil(view.height * ratio);
    renderTask = page.render({
      canvasContext: off.getContext("2d"),
      viewport: view,
      transform: [ratio, 0, 0, ratio, 0, 0],
    });
    try {
      await renderTask.promise;
    } catch (e) {
      if (e.name === "RenderingCancelledException") return;
      throw e;
    }
    if (closed || rev !== epoch) return;
    const c = $("#ocr-canvas");
    c.width = off.width;
    c.height = off.height;
    c.style.width = view.width + "px";
    c.style.height = view.height + "px";
    stream?.resize();
    c.getContext("2d").drawImage(off, 0, 0);
    off.width = off.height = 0;
    boxes.nativeView = page.getViewport({ scale: 1 });
    boxes(view);
  }
  $("#ocr-results").onchange = () =>
    guarded(() => select(+$("#ocr-results").value));
  for (const id of ["ocr-correction", "ocr-quad", "ocr-exclude"])
    $("#" + id).oninput = () => {
      draftDirty = true;
    };
  for (const id of ["ocr-box-preview", "ocr-text-preview", "ocr-image-preview"])
    $("#" + id).onchange = () => boxes();
  $("#ocr-prev").onclick = () =>
    guarded(() => loadPage(Math.max(1, reviewPage - 1)));
  $("#ocr-next").onclick = () =>
    guarded(() => loadPage(Math.min(S.info.pageCount, reviewPage + 1)));
  $("#ocr-review-page").onchange = () =>
    guarded(() => loadPage(+$("#ocr-review-page").value));
  $("#ocr-correct").onclick = () =>
    guarded(async () => {
      await savePage();
      boxes();
      toast("本页校对已保存");
    });
  function pageList() {
    const kind = $("#ocr-page-filter").value;
    $("#ocr-page-list").innerHTML = [...states.values()]
      .filter(
        (s) =>
          kind === "all" || (kind === "low" ? s.low > 0 : s.state === kind),
      )
      .map(
        (s) =>
          `<option value="${s.page}">第 ${s.page} 页 · ${{ pending: "等待", running: "识别中", done: "已识别", skipped: "已跳过", failed: "失败" }[s.state]}${s.low ? ` · ${s.low} 条待校对` : ""}</option>`,
      )
      .join("");
    $("#ocr-page-list").value = reviewPage;
  }
  $("#ocr-page-filter").onchange = pageList;
  $("#ocr-page-list").onchange = () =>
    guarded(() => loadPage(+$("#ocr-page-list").value));
  for (const el of document.querySelectorAll(
    '[name="ocr-language"], #ocr-other-language, #ocr-output-script',
  ))
    el.onchange = () =>
      guarded(() => {
        localStorage.setItem(
          "folio-ocr-language",
          JSON.stringify(preferences()),
        );
        return loadPage(reviewPage, false);
      });
  $("#ocr-low").onclick = () =>
    guarded(async () => {
      await savePage();
      const local = pageBlocks.findIndex(
        (b, i) =>
          i > selected &&
          !b.excluded &&
          b.confidence < 0.85 &&
          !checked.has(markKey(reviewPage, b)),
      );
      if (local >= 0) {
        select(local);
        return;
      }
      const pages = info?.done || [
        ...new Set((S.ocr || []).map((b) => b.page)),
      ];
      for (const p of [
        ...pages.filter((p) => p > reviewPage),
        ...pages.filter((p) => p <= reviewPage),
      ]) {
        const bs = job
          ? (
              await api({
                action: "page",
                id: job,
                page: p,
                preferences: preferences(),
              })
            ).blocks
          : localCorrections.get(p) || ocrPage(S.ocr, p);
        const i = bs.findIndex(
          (b) =>
            !b.excluded && b.confidence < 0.85 && !checked.has(markKey(p, b)),
        );
        if (i >= 0) {
          await loadPage(p);
          select(i);
          return;
        }
      }
      toast("已完成页中没有更多低置信度结果");
    });
  async function poll() {
    if (closed) return;
    const next = await api({ action: "status", since: info?.revision });
    if (closed || !mergeInfo(next)) return;
    running = info.running;
    const completed = info.counts.done + info.counts.skipped;
    $("#ocr-status").textContent =
      `${running ? "后台识别" : info.stopped ? "已停止" : "已完成"} ${completed}/${info.total} 页 · 活动页 ${info.active.join(", ") || "—"} · 近期 ${info.rate.toFixed(1)} 页/分 · 实际 ${info.actualWorkers} / 目标 ${info.targetWorkers} 个进程 × ${info.plan.threads} 线程${info.reason ? `（${info.reason}）` : ""} · 续用 ${info.restored} 页 · 失败 ${info.failed.length}`;
    $("#ocr-start").disabled = running;
    $("#ocr-stop").disabled = !running;
    $("#ocr-apply").disabled = running || applying;
    $("#ocr-status").title = info.failed
      .map((f) => `第 ${f.page} 页：${f.error}`)
      .join("\n");
    const errors = $("#ocr-errors"),
      detail = $("#ocr-error-detail");
    errors.hidden = !info.failed.length;
    if (info.failed.length && !errors.dataset.shown) {
      errors.open = true;
      errors.dataset.shown = "true";
    }
    detail.textContent =
      info.failed
        .slice(0, 30)
        .map((f) => `第 ${f.page} 页：${f.error}`)
        .join("\n\n") +
      (info.failed.length > 30
        ? `\n\n另有 ${info.failed.length - 30} 页失败。`
        : "");
    if (next.states || next.changes?.length) pageList();
    if (
      info.done.includes(reviewPage) &&
      loadedRevision < (states.get(reviewPage)?.revision ?? 0) &&
      !dirtyPage &&
      !draftDirty
    )
      await loadPage(reviewPage, false);
    if (running) pollTimer = setTimeout(() => guarded(poll), 500);
  }
  $("#ocr-stop").onclick = () =>
    guarded(async () => {
      await api({ action: "stop" });
      await poll();
    });
  $("#ocr-start").onclick = () =>
    guarded(async () => {
      if (running) return;
      await savePage();
      const pages = pageRange($("#ocr-range").value, S.info.pageCount);
      if (!pages.length) throw Error("请至少选择一页");
      running = true;
      $("#ocr-start").disabled = true;
      $("#ocr-apply").disabled = true;
      try {
        const started = await api({
          action: "start",
          bytes: await S.pdf.getData(),
          pages,
          profile: $("#ocr-profile").value,
          dpi: +$("#ocr-dpi").value,
          skipText: $("#ocr-skip").checked,
          skipMode: $("#ocr-skip-mode").value,
          region: $("#ocr-region").value.trim()
            ? $("#ocr-region")
                .value.split(",")
                .map((x) => Number(x) / 100)
            : null,
          mode: $("#ocr-mode").value,
          workers: +$("#ocr-workers").value,
          threads: +$("#ocr-threads").value,
          batch: +$("#ocr-batch").value,
          resume: $("#ocr-resume").checked,
          ...preferences(),
        });
        job = started.id;
        mergeInfo(started);
        S.ocrTask = { id: job, bytes: S.bytes };
        for (const p of pages) {
          localCorrections.delete(p);
          await writeReview(reviewKey, p, null);
        }
        $("#modal .ocr-settings").open = false;
        await loadPage(pages[0]);
        await poll();
      } catch (e) {
        running = false;
        $("#ocr-start").disabled = false;
        $("#ocr-apply").disabled = false;
        throw e;
      }
    });
  $("#ocr-region-pick").onclick = () => {
    if (!boxes.view) return;
    stopRegion?.();
    stopRegion = selectRegion($("#ocr-canvas"), (r) => {
      const native = boxes.nativeView || boxes.view;
      const pts = [
        [r[0], r[1]],
        [r[2], r[1]],
        [r[2], r[3]],
        [r[0], r[3]],
      ].map((q) =>
        native.convertToViewportPoint(...boxes.view.convertToPdfPoint(...q)),
      );
      const x = Math.min(...pts.map((p) => p[0])),
        y = Math.min(...pts.map((p) => p[1]));
      $("#ocr-region").value = [
        (x / native.width) * 100,
        (y / native.height) * 100,
        ((Math.max(...pts.map((p) => p[0])) - x) / native.width) * 100,
        ((Math.max(...pts.map((p) => p[1])) - y) / native.height) * 100,
      ]
        .map((n) => n.toFixed(2))
        .join(",");
    });
  };
  $("#ocr-region-clear").onclick = () => {
    stopRegion?.();
    $("#ocr-region").value = "";
  };
  setCleanup(() => {
    stream?.destroy();
    stopRegion?.();
    closed = true;
    epoch++;
    clearTimeout(pollTimer);
    renderTask?.cancel();
    disposePicker();
    closeButton.onclick = previousClose;
    $("#modal").removeEventListener("cancel", cancelDialog, true);
    if (running && !keepRunning) api({ action: "stop" }).catch(() => {});
    $("#modal").classList.remove("native-dialog", "ocr-dialog");
  });
  if (S.ocrTask?.bytes === S.bytes) {
    const existing = await api({ action: "status" });
    if (existing?.id === S.ocrTask.id) {
      job = existing.id;
      mergeInfo(existing);
      running = existing.running;
    }
  }
  if (!states.size) {
    for (const p of [
      ...new Set([...S.ocr.map((b) => b.page), ...localCorrections.keys()]),
    ]) {
      const bs = localCorrections.get(p) || ocrPage(S.ocr, p);
      states.set(p, {
        page: p,
        state: "done",
        low: bs.filter(
          (b) =>
            !b.excluded && b.confidence < 0.85 && !checked.has(markKey(p, b)),
        ).length,
        revision: 0,
      });
    }
  }
  pageList();
  const host = $("#ocr-canvas").closest(".native-preview");
  stream = createOCRStream({
    host,
    canvas: $("#ocr-canvas"),
    boxes: $("#ocr-boxes"),
    pdf: S.pdf,
    rotation: (p) => surface.rotation(p),
    toast,
    getBlocks: async (p) =>
      job && donePages().includes(p)
        ? (
            await api({
              action: "page",
              id: job,
              page: p,
              preferences: preferences(),
            })
          ).blocks
        : structuredClone(localCorrections.get(p) || ocrPage(S.ocr, p)),
    isLocked: () =>
      composing ||
      draftDirty ||
      document.activeElement === $("#ocr-correction"),
    onPage: async (p, index, reveal) => {
      if (p !== reviewPage) await loadPage(p, true, reveal && index === null);
      if (index !== null) select(index);
    },
  });
  const scope = states.size
    ? [...states.keys()]
    : S.ocr.length
      ? [...new Set(S.ocr.map((b) => b.page))]
      : [S.page];
  stream.setPages(scope);
  const mode = localStorage.getItem("folio-ocr-scroll-mode") || "continuous";
  $("#ocr-scroll-mode").value = mode;
  stream.setMode(mode === "continuous");
  $("#ocr-scroll-mode").onchange = () => {
    const v = $("#ocr-scroll-mode").value;
    localStorage.setItem("folio-ocr-scroll-mode", v);
    stream.setMode(v === "continuous");
  };
  $("#ocr-correction").addEventListener(
    "compositionstart",
    () => (composing = true),
  );
  $("#ocr-correction").addEventListener(
    "compositionend",
    () => (composing = false),
  );
  $("#ocr-correction").addEventListener(
    "focus",
    () => ($("#ocr-review-lock").textContent = `正在编辑第 ${reviewPage} 页`),
  );
  $("#ocr-correction").addEventListener(
    "blur",
    () => ($("#ocr-review-lock").textContent = ""),
  );
  $("#ocr-reviewed").onclick = () =>
    guarded(async () => {
      if (composing) return;
      await savePage();
      if (pageBlocks[selected]) {
        checked.add(markKey(reviewPage, pageBlocks[selected]));
        localStorage.setItem(
          reviewKey + "-checked",
          JSON.stringify([...checked]),
        );
      }
      $("#ocr-low").click();
    });
  $("#ocr-defer").onclick = () => {
    if (!composing) $("#ocr-low").click();
  };
  $("#ocr-correction").addEventListener("keydown", (e) => {
    if (e.isComposing || composing) return;
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      $("#ocr-reviewed").click();
    }
    if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      $("#ocr-low").click();
    }
  });
  let remembered;
  try {
    remembered = JSON.parse(localStorage.getItem(reviewKey) || "null");
  } catch {}
  await loadPage(scope.includes(remembered?.page) ? remembered.page : scope[0]);
  if (remembered?.offset) host.scrollTop += remembered.offset;
  let scrollTimer;
  host.addEventListener(
    "scroll",
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        if (closed) return;
        const shell = host.querySelector(`[data-page="${reviewPage}"]`);
        if (shell)
          localStorage.setItem(
            reviewKey,
            JSON.stringify({
              page: reviewPage,
              offset: host.scrollTop - shell.offsetTop,
            }),
          );
      }, 300);
    },
    { passive: true },
  );
  if (S.ocr.length || job) $("#modal .ocr-settings").open = false;
  if (job) await poll();
}

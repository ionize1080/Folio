import { extractTocPage } from "./smart-toc-extract.mjs";
import {
  recognizeTocPages,
  entriesToNodes,
  calibrationLines,
} from "./smart-toc.mjs";
import { parsePageLabel } from "./page-labels.mjs";
import { extractLines } from "./text-lines.mjs";
import { pageRange } from "./generation.mjs";
import { nativeRequest, releaseSource } from "./native-source.mjs";
import { t as localize } from "./i18n.mjs";
const t = (s, args) => localize(s, args, "zh-Hans");

export function smartTocDialog({
  S,
  surface,
  modal,
  closeModal,
  esc,
  commit,
  toast,
  setCleanup,
}) {
  if (!S.pdf) return;
  const $ = (s) => document.querySelector(s),
    pdf = S.pdf,
    base = S.nodes,
    session = S.sessionId,
    ocr = S.ocr,
    rotation = JSON.stringify(S.rotation);
  let closed = false,
    rev = 0,
    busy = false,
    nativeStarted = false,
    sourceBytes,
    worker,
    settle,
    renderTask,
    previewReturn,
    draw = 0,
    found = [],
    entries = [],
    group = 0;
  const cache = new Map(),
    extra = [];
  const stale = () =>
    S.pdf !== pdf ||
    S.nodes !== base ||
    S.sessionId !== session ||
    S.ocr !== ocr ||
    JSON.stringify(S.rotation) !== rotation;
  const alive = (r) => !closed && r === rev && !stale();
  const options = () => ({
    direction: $("#st-direction").value,
    alphabetic: $("#st-alpha").checked,
  });
  const status = (s) => {
    if (!closed) $("#st-status").textContent = s;
  };
  const ready = (e) =>
    e.target &&
    e.title.trim() &&
    Number.isInteger(e.level) &&
    e.level >= 1 &&
    e.level <= 8;
  const visibleEntries = () =>
    entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => {
        const filter = $("#st-filter")?.value || "all",
          query = $("#st-search")?.value.trim().toLocaleLowerCase() || "";
        return (
          (!query || e.title.toLocaleLowerCase().includes(query)) &&
          (filter === "all" ||
            (filter === "review" && e.status !== "high") ||
            (filter === "selected" && e.selected) ||
            (filter === "unresolved" && !e.target))
        );
      });
  function stop() {
    rev++;
    worker?.terminate();
    worker = null;
    settle?.();
    settle = null;
    if (nativeStarted) {
      window.desktop?.cancelNative?.();
      nativeStarted = false;
    }
    busy = false;
    if (!closed) buttons();
  }
  function buttons() {
    for (const id of [
      "st-start",
      "st-detect",
      "st-extract",
      "st-resolve",
      "st-add",
      "st-all",
      "st-none",
      "st-best",
    ])
      $("#" + id).disabled = busy || stale();
    $("#st-stop").disabled = !busy;
    $("#st-apply").disabled =
      busy ||
      stale() ||
      !entries.some((e) => e.selected) ||
      entries.some((e) => e.selected && !ready(e));
    $("#st-count").textContent = t("条目 {0} · 已选 {1}", {
      0: entries.length,
      1: entries.filter((e) => e.selected).length,
    });
    const visible = visibleEntries(),
      eligible = visible.filter(({ e }) => ready(e));
    $("#st-all").checked =
      eligible.length > 0 && eligible.every(({ e }) => e.selected);
    $("#st-all").indeterminate =
      eligible.some(({ e }) => e.selected) && !$("#st-all").checked;
    $("#st-all").disabled ||= !eligible.length;
    $("#st-best").disabled ||= !visible.some(
      ({ e }) => !e.target && e.candidates?.length,
    );
    $("#st-paging").textContent = t("第 {0} / {1} 组 · 当前筛选 {2} 项", {
      0: group + 1,
      1: Math.max(1, Math.ceil(visible.length / 30)),
      2: visible.length,
    });
    $("#st-summary").textContent = t(
      "已定位 {0} 项 · 待定位 {1} 项 · 待复核 {2} 项",
      {
        0: entries.filter((e) => e.target).length,
        1: entries.filter((e) => !e.target).length,
        2: entries.filter((e) => e.status !== "high").length,
      },
    );
    $("#st-prev").disabled = group === 0;
    $("#st-next").disabled = (group + 1) * 30 >= visible.length;
    for (const input of $("#st-rows").querySelectorAll("input,select,button"))
      input.disabled = busy || stale();
  }
  async function task(fn) {
    stop();
    const r = rev;
    busy = true;
    buttons();
    try {
      await fn(r);
    } catch (e) {
      if (alive(r)) status(e.message);
    } finally {
      if (!closed && r === rev) {
        busy = false;
        buttons();
      }
    }
  }
  modal(
    t("智能目录识别"),
    `
    <p>${esc(t("一键识别目录并定位正文，高置信度条目自动勾选；只需复核剩余条目，再生成书签。"))}</p>
    <div class="pc-toolbar"><button id="st-start" class="primary"><i data-icon="scan"></i>${esc(t("一键识别并定位"))}</button><button id="st-stop">${esc(t("停止"))}</button><span id="st-summary" role="status"></span></div>
    <details id="st-settings"><summary>${esc(t("目录范围与高级设置"))}</summary>
    <div class="form-grid three"><label>${esc(t("目录检测范围"))}<input id="st-range" value="1-${Math.min(50, S.info.pageCount)}"></label><label>${esc(t("阅读方向"))}<select id="st-direction"><option value="auto">${esc(t("自动方向"))}</option><option value="horizontal">${esc(t("横排"))}</option><option value="vertical">${esc(t("竖排（从上到下）"))}</option></select></label><label class="check"><input id="st-alpha" type="checkbox">${esc(t("字母页码（a、b、c；优先于罗马数字）"))}</label></div>
    <label class="check"><input id="st-ocr" type="checkbox">${esc(t("本地 AI 辅助识别无文字页（离线 OCR）"))}</label>
    <p class="hint">${esc(t("默认检查前 50 页，可改为全书范围。复杂艺术字、低清扫描和混合方向需核对；OCR 语言能力取决于内置模型。"))}</p>
    <div class="menu-grid"><button id="st-detect">${esc(t("检测目录页"))}</button></div>
    <div id="st-pages" class="st-pages"></div>
    <div class="form-grid"><label>${esc(t("确认目录页（可人工增删）"))}<input id="st-pages-input" placeholder="2-4,8"></label><label>${esc(t("正文搜索页面"))}<input id="st-body" value="1-${S.info.pageCount}"></label></div>
    <div class="menu-grid"><button id="st-extract">${esc(t("提取目录条目"))}</button></div></details>
    <p id="st-status" role="status" class="callout">${esc(t("点击一键识别即可开始；也可展开高级设置，指定目录范围。"))}</p>
    <canvas id="st-preview" hidden style="max-width:100%;max-height:360px"></canvas>
    <button id="st-hide-preview" hidden>${esc(t("关闭预览并返回条目"))}</button>
    <div class="st-controls"><label class="check"><input id="st-all" type="checkbox">${esc(t("全选可生成项"))}</label><button id="st-none">${esc(t("取消全选"))}</button><select id="st-filter" aria-label="${esc(t("筛选条目"))}"><option value="all">${esc(t("全部条目"))}</option><option value="review">${esc(t("待复核"))}</option><option value="unresolved">${esc(t("未定位"))}</option><option value="selected">${esc(t("已选条目"))}</option></select><input id="st-search" placeholder="${esc(t("搜索目录标题"))}" aria-label="${esc(t("搜索目录标题"))}"><span id="st-count"></span></div>
    <p class="hint">${esc(t("全选作用于当前筛选的所有分页；尚无目标页的条目需先校准。"))}</p>
    <div class="pc-toolbar"><button id="st-best">${esc(t("待定位项采用首选候选"))}</button><button id="st-resolve">${esc(t("定位实际页码"))}</button><button id="st-add">${esc(t("添加条目"))}</button></div>
    <div class="st-column-head"><span></span><span>${esc(t("标题"))}</span><span>${esc(t("层级"))}</span><span>${esc(t("目录原始页码"))}</span><span>${esc(t("手动目标页"))}</span><span>${esc(t("匹配位置"))}</span></div>
    <div id="st-rows"></div>
    <div class="pc-toolbar"><button id="st-prev">${esc(t("上一组"))}</button><span id="st-paging"></span><button id="st-next">${esc(t("下一组"))}</button></div>
    <label>${esc(t("合并方式"))}<select id="st-merge"><option value="append">${esc(t("追加到现有书签末尾"))}</option><option value="replace">${esc(t("替换全部现有书签（可撤销）"))}</option></select></label>`,
    [
      { text: t("关闭"), run: closeModal },
      {
        text: t("生成已选书签"),
        id: "st-apply",
        primary: true,
        run: () => {
          if (busy || stale())
            throw Error(t("文档已改变，请重新打开校准预览。"));
          const nodes = entriesToNodes(entries, S.info.pageCount);
          if (!nodes.length) return;
          commit(
            $("#st-merge").value === "replace" ? nodes : [...base, ...nodes],
          );
          closeModal();
          toast(t("已生成 {0} 项书签，可整批撤销", { 0: nodes.length }));
        },
      },
    ],
  );
  $("#modal").classList.add("native-dialog");
  $("#modal").classList.add("smart-toc-dialog");
  // Keep the append/replace choice beside Create, visible even on long lists.
  $("#modal-footer").prepend($("#st-merge").closest("label"));
  async function read(p, r) {
    if (cache.has(p)) return cache.get(p);
    status(
      t("正在分析 PDF 第 {0} 页（{1} / {2}）", {
        0: p,
        1: p,
        2: S.info.pageCount,
      }),
    );
    let data = await extractTocPage(pdf, p, surface.rotation(p), ocr);
    if (!alive(r)) return null;
    if (
      $("#st-ocr").checked &&
      data.fragments.map((f) => f.text).join("").length < 25
    ) {
      if (!window.desktop?.native) throw Error(t("此功能需要完整桌面运行包"));
      sourceBytes ||= await pdf.getData();
      if (!alive(r)) return null;
      nativeStarted = true;
      let result;
      try {
        result = await nativeRequest({
          command: "ocr",
          bytes: sourceBytes,
          page: p,
          dpi: 180,
          profile: "v6",
          skipText: false,
          threads: 2,
          batch: 4,
        });
      } finally {
        if (r === rev) nativeStarted = false;
      }
      if (!alive(r)) return null;
      extra.push(...result.blocks);
      data = await extractTocPage(pdf, p, surface.rotation(p), [
        ...ocr,
        ...extra,
      ]);
    }
    if (alive(r)) cache.set(p, data);
    return data;
  }
  async function detect(r) {
    found = [];
    entries = [];
    renderRows();
    const numbers = pageRange($("#st-range").value, S.info.pageCount),
      dataPages = [];
    for (const p of numbers) {
      const data = await read(p, r);
      if (!alive(r)) return;
      dataPages.push(data);
      await new Promise((x) => setTimeout(x, 0));
    }
    found = recognizeTocPages(dataPages, options());
    $("#st-pages-input").value = found
      .filter((f) => f.selected)
      .map((f) => f.page)
      .join(",");
    $("#st-pages").innerHTML = found
      .filter((f) => f.score >= 35)
      .map(
        (f) =>
          `<button data-page="${f.page}">${f.page} · ${f.entries.length} ${f.auxiliary ? esc(t("附加索引")) : ""}</button>`,
      )
      .join("");
    status(
      t("已检测 {0} 页，候选目录 {1} 页；请预览并校准目录范围。", {
        0: found.length,
        1: found.filter((f) => f.selected).length,
      }),
    );
  }
  async function extract(r) {
    const numbers = pageRange($("#st-pages-input").value, S.info.pageCount);
    const next = [];
    for (const p of numbers) {
      const data = await read(p, r);
      if (!alive(r)) return;
      next.push(data);
    }
    entries = recognizeTocPages(next, options()).flatMap((p) =>
      p.entries.map((e) => ({
        ...e,
        selected: false,
        target: null,
        candidates: [],
        status: "unmatched",
      })),
    );
    $("#st-filter").value = "all";
    $("#st-search").value = "";
    group = 0;
    renderRows();
    status(t("请校对标题、原始页码和层级，然后定位实际页码。"));
  }
  async function resolve(r) {
    if (!entries.length) throw Error(t("请先提取目录条目。"));
    if (entries.length > 5000) throw Error(t("条目过多，请分批处理。"));
    const excluded = pageRange($("#st-pages-input").value, S.info.pageCount),
      numbers = pageRange($("#st-body").value, S.info.pageCount).filter(
        (p) => !excluded.includes(p),
      ),
      pages = {};
    let count = 0;
    for (const p of numbers) {
      status(
        t("正在分析 PDF 第 {0} 页（{1} / {2}）", {
          0: p,
          1: p,
          2: S.info.pageCount,
        }),
      );
      if ($("#st-ocr").checked) await read(p, r);
      if (!alive(r)) return;
      pages[p] = calibrationLines(
        await extractLines(pdf, p, surface.rotation(p), {
          ocr: [...ocr, ...extra],
        }),
      );
      count += pages[p].length;
      if (count > 250000)
        throw Error(t("文字行超过分析预算，请缩小正文搜索范围。"));
      await new Promise((x) => setTimeout(x, 0));
    }
    const labels = (await pdf.getPageLabels()) || [];
    if (!alive(r)) return;
    status(t("正在逐条比较标题候选…"));
    const output = await new Promise((resolve, reject) => {
      const w = new Worker(new URL("./smart-toc-worker.mjs", import.meta.url), {
        type: "module",
      });
      worker = w;
      const finish = (value, error) => {
        clearTimeout(timer);
        w.terminate();
        worker = null;
        settle = null;
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(
        () => finish(null, Error(t("分析超时，请缩小范围或分批选择书签。"))),
        120000,
      );
      settle = () => finish(null);
      w.onmessage = (e) =>
        finish(e.data.entries, e.data.error ? Error(e.data.error) : null);
      w.onerror = (e) => finish(null, Error(e.message));
      w.postMessage({
        entries,
        pages,
        pageCount: S.info.pageCount,
        pageLabels: labels,
        excludedPages: excluded,
      });
    });
    if (!alive(r) || !output) return;
    entries = output;
    renderRows();
    status(t("定位完成。高置信度项已勾选，其余项请选择候选或输入实际页码。"));
  }
  $("#st-detect").onclick = () => task(detect);
  $("#st-extract").onclick = () => task(extract);
  $("#st-resolve").onclick = () => task(resolve);
  $("#st-start").onclick = () =>
    task(async (r) => {
      if (!$("#st-pages-input").value.trim()) await detect(r);
      if (!alive(r)) return;
      if (!$("#st-pages-input").value.trim()) {
        $("#st-settings").open = true;
        throw Error(t("未找到可靠目录页，请填写目录页范围后重试。"));
      }
      await extract(r);
      if (alive(r)) await resolve(r);
    });
  async function preview(p, bounds) {
    previewReturn = document.activeElement;
    const id = ++draw;
    renderTask?.cancel();
    const page = await pdf.getPage(p);
    if (closed || id !== draw) return;
    const vp = page.getViewport({ scale: 1, rotation: surface.rotation(p) }),
      scale = Math.min(1, 680 / vp.width),
      v = page.getViewport({ scale, rotation: surface.rotation(p) }),
      c = $("#st-preview");
    c.hidden = false;
    $("#st-hide-preview").hidden = false;
    c.width = v.width;
    c.height = v.height;
    renderTask = page.render({
      canvasContext: c.getContext("2d"),
      viewport: v,
    });
    try {
      await renderTask.promise;
      if (!closed && id === draw) c.scrollIntoView({ block: "nearest" });
      if (bounds && id === draw) {
        const ctx = c.getContext("2d");
        ctx.strokeStyle = "#e27800";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          bounds[0] * scale,
          bounds[1] * scale,
          (bounds[2] - bounds[0]) * scale,
          (bounds[3] - bounds[1]) * scale,
        );
      }
    } catch (e) {
      if (e.name !== "RenderingCancelledException") status(e.message);
    }
  }
  $("#st-hide-preview").onclick = () => {
    draw++;
    renderTask?.cancel();
    $("#st-preview").hidden = true;
    $("#st-hide-preview").hidden = true;
    if (previewReturn?.isConnected) {
      previewReturn.focus();
      previewReturn.scrollIntoView({ block: "nearest" });
    }
  };
  function renderRows() {
    const visible = visibleEntries();
    group = Math.min(group, Math.max(0, Math.ceil(visible.length / 30) - 1));
    $("#st-rows").innerHTML = visible
      .slice(group * 30, (group + 1) * 30)
      .map(({ e, i }) => {
        const label = t(
          e.status === "high"
            ? "高置信度"
            : e.status === "manual"
              ? "手动指定，未自动验证"
              : "需核对",
        );
        return `<article class="st-row" data-entry="${i}">
          <div class="st-row-main"><input aria-label="${esc(t("生成此项"))}" data-field="selected" type="checkbox" ${e.selected ? "checked" : ""}>
          <input aria-label="${esc(t("标题"))}" data-field="title" value="${esc(e.title)}" translate="no" style="padding-left:${10 + (e.level - 1) * 12}px">
          <input aria-label="${esc(t("层级"))}" data-field="level" type="number" min="1" max="8" value="${e.level}">
          <input aria-label="${esc(t("目录原始页码"))}" data-field="printedLabel" value="${esc(e.printedLabel)}" translate="no">
          <input aria-label="${esc(t("手动目标页"))}" data-field="page" type="number" min="1" max="${S.info.pageCount}" value="${e.target?.page || ""}">
          <span class="st-state" data-status="${e.status}">${esc(label)}</span></div>
          <details class="st-detail" ${e.expanded ? "open" : ""}><summary>${esc(t("校准与预览"))}</summary>
          <div class="st-detail-body"><label>${esc(t("匹配位置"))}<select data-field="candidate"><option value="">${esc(t("请选择候选或手动输入"))}</option>${(e.candidates || []).map((c, k) => `<option value="${k}" translate="no">PDF ${c.page} · ${c.score}/100 · ${esc(c.text || t(c.reason === "verified-link" ? "目录链接与正文一致" : c.reason === "pdf-link" ? "目录原有链接（待核对）" : c.reason))}</option>`).join("")}</select></label>
          <div class="pc-toolbar"><button data-source="${i}">${esc(t("查看目录原文"))}</button><button data-target="${i}">${esc(t("查看候选位置"))}</button><button aria-label="${esc(t("上移"))}" data-up="${i}">↑</button><button aria-label="${esc(t("下移"))}" data-down="${i}">↓</button><button data-remove="${i}">${esc(t("删除"))}</button></div></div></details></article>`;
      })
      .join("");
    for (const detail of $("#st-rows").querySelectorAll("details"))
      detail.ontoggle = () => {
        if (!detail.isConnected || closed) return;
        entries[+detail.closest("[data-entry]").dataset.entry].expanded =
          detail.open;
      };
    buttons();
  }
  $("#st-rows").onchange = (e) => {
    if (busy) return;
    const row = e.target.closest("[data-entry]");
    if (!row) return;
    const item = entries[+row.dataset.entry],
      field = e.target.dataset.field,
      value = e.target.value;
    if (field === "selected") item.selected = e.target.checked;
    else if (field === "level") item.level = Number(value);
    else if (field === "title" || field === "printedLabel") {
      item[field] = value;
      item.label = parsePageLabel(item.printedLabel, options());
      item.target = null;
      item.selected = false;
      item.candidates = [];
      item.status = "unmatched";
      renderRows();
    } else if (field === "page") {
      const p = Number(value);
      item.target =
        Number.isInteger(p) && p >= 1 && p <= S.info.pageCount
          ? { kind: "dest", page: p, mode: "Fit", args: [] }
          : null;
      item.selected = !!item.target;
      item.status = "manual";
      buttons();
    } else if (field === "candidate") {
      const c = item.candidates[Number(value)];
      if (value !== "" && c) {
        item.target = structuredClone(c.target);
        item.selected = true;
        item.status = "review";
        renderRows();
      }
    }
    buttons();
  };
  $("#st-rows").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.source !== undefined) {
      const item = entries[+b.dataset.source];
      preview(item.sourcePage, item.bounds);
    }
    if (b.dataset.target !== undefined) {
      const item = entries[+b.dataset.target];
      if (item.target) preview(item.target.page);
    }
    if (busy) return;
    for (const [key, delta] of [
      ["up", -1],
      ["down", 1],
    ])
      if (b.dataset[key] !== undefined) {
        const i = +b.dataset[key],
          j = i + delta;
        if (j >= 0 && j < entries.length) {
          [entries[i], entries[j]] = [entries[j], entries[i]];
          renderRows();
        }
      }
    if (b.dataset.remove !== undefined) {
      entries.splice(+b.dataset.remove, 1);
      group = Math.min(group, Math.max(0, Math.ceil(entries.length / 30) - 1));
      renderRows();
    }
  };
  $("#st-pages").onclick = (e) => {
    const p = +e.target.dataset.page;
    if (p) preview(p);
  };
  $("#st-all").onchange = () => {
    if (busy || stale()) return;
    const checked = $("#st-all").checked;
    visibleEntries().forEach(({ e }) => {
      if (ready(e)) e.selected = checked;
    });
    renderRows();
  };
  $("#st-none").onclick = () => {
    if (busy || stale()) return;
    visibleEntries().forEach(({ e }) => (e.selected = false));
    renderRows();
  };
  $("#st-best").onclick = () => {
    if (busy || stale()) return;
    visibleEntries().forEach(({ e }) => {
      if (!e.target && e.candidates?.length) {
        e.target = structuredClone(e.candidates[0].target);
        e.selected = true;
        e.status = "review";
      }
    });
    renderRows();
    status(t("已采用首选候选，仍标记为待复核；可预览或修改目标页后生成。"));
  };
  for (const id of ["st-filter", "st-search"])
    $("#" + id).oninput = () => {
      group = 0;
      renderRows();
    };
  $("#st-add").onclick = () => {
    $("#st-filter").value = "all";
    $("#st-search").value = "";
    entries.push({
      title: "",
      printedLabel: "",
      sourcePage: S.page,
      level: 1,
      selected: false,
      target: null,
      candidates: [],
      status: "manual",
    });
    group = Math.floor((entries.length - 1) / 30);
    renderRows();
  };
  $("#st-prev").onclick = () => {
    group--;
    renderRows();
  };
  $("#st-next").onclick = () => {
    group++;
    renderRows();
  };
  $("#st-stop").onclick = () => {
    stop();
    status(t("分析已停止，未应用任何校准。"));
  };
  for (const id of [
    "st-range",
    "st-pages-input",
    "st-body",
    "st-direction",
    "st-alpha",
    "st-ocr",
  ])
    $("#" + id).onchange = () => {
      stop();
      entries = [];
      group = 0;
      renderRows();
      if (id === "st-ocr") cache.clear();
      status(t("设置已更改，请重新分析。"));
    };
  setCleanup(() => {
    closed = true;
    $("#modal").classList.remove("smart-toc-dialog");
    stop();
    draw++;
    renderTask?.cancel();
    cache.clear();
    if (sourceBytes) releaseSource(sourceBytes);
  });
  buttons();
}

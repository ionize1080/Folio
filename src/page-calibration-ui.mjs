import { t as localized, onLanguageChange } from "./i18n.mjs";
// Retain source messages for the app's live localization observer. Options
// containing document text are localized explicitly and protected from it.
const t = (source, args) => localized(source, args, "zh-Hans");
import { clone, descendants } from "./model.mjs";
import { pageRange } from "./generation.mjs";
import { extractLines } from "./text-lines.mjs";
import { calibrationLines, applyPageCalibration } from "./page-calibration.mjs";

const evidenceText = {
  exact: "完整标题匹配",
  contains: "正文包含标题",
  fuzzy: "近似文字匹配",
  "page-label": "PDF 页面标签一致",
  "printed-label": "印刷页码一致",
  ocr: "OCR 文字证据",
  "joined-lines": "跨行标题",
};
const warningText = {
  "short-title": "标题过短",
  "toc-like": "可能是目录条目",
  "page-margin": "位于页边区域",
  "repeated-header": "可能是重复页眉",
  "label-differs": "PDF 页面标签不同",
};
const statusText = {
  high: "高置信度",
  review: "需核对",
  ambiguous: "多个候选接近",
  unmatched: "未找到候选",
};

export function installPageCalibrationUI({
  S,
  surface,
  modal,
  closeModal,
  esc,
  commit,
  guarded,
  toast,
  setCleanup,
}) {
  const $ = (s) => document.querySelector(s);
  return function pageCalibrationDialog(options = {}) {
    if (!S.pdf) return;
    const pdf = S.pdf,
      base = S.nodes,
      ocr = S.ocr,
      rotation = JSON.stringify(S.rotation),
      session = S.sessionId;
    const input = clone(options.nodes || base),
      pending = !!options.nodes;
    let closed = false,
      revision = 0,
      worker,
      settleWorker,
      renderTask,
      drawRevision = 0,
      results = [],
      choices = new Map(),
      pageIndex = 0,
      ready = false,
      busy = false;
    const stale = () =>
      S.pdf !== pdf ||
      S.nodes !== base ||
      S.ocr !== ocr ||
      S.sessionId !== session ||
      JSON.stringify(S.rotation) !== rotation;
    const alive = (rev) => !closed && revision === rev && !stale();
    const countSelected = () =>
      results.filter((r) => choices.has(r.id) && choices.get(r.id) !== -1)
        .length;
    function stop() {
      revision++;
      worker?.terminate();
      worker = null;
      settleWorker?.(null);
      settleWorker = null;
      busy = false;
    }
    function invalidate() {
      stop();
      ready = false;
      results = [];
      choices.clear();
      drawRevision++;
      renderTask?.cancel();
      if (closed) return;
      $("#pc-results").replaceChildren();
      $("#pc-preview").hidden = true;
      $("#pc-status").textContent = t("设置已更改，请重新分析。");
      updateButtons();
    }
    function updateButtons() {
      $("#pc-run").disabled = busy;
      $("#pc-stop").disabled = !busy;
      $("#pc-high").disabled = !ready || busy;
      $("#pc-clear").disabled = !ready || busy;
      $("#pc-apply").disabled = !ready || busy || !countSelected() || stale();
      $("#pc-selected").textContent = t("已选 {0} / {1} 项", {
        0: countSelected(),
        1: results.length,
      });
      $("#pc-prev").disabled = pageIndex === 0;
      $("#pc-next").disabled = (pageIndex + 1) * 50 >= results.length;
      $("#pc-page").textContent = t("预览 {0} / {1}", {
        0: pageIndex + 1,
        1: Math.max(1, Math.ceil(results.length / 50)),
      });
    }
    modal(
      t("逐条校准目录页码"),
      `
      <p>${esc(t("每条标题独立搜索目标页，允许每条偏移不同、同页多标题和页序回退。"))}</p>
      <p class="hint">${esc(t("本功能校准书签跳转，不改写目录页上的印刷数字或 PDF 页面标签。"))}</p>
      <div class="form-grid three">
        <label>${esc(t("书签范围"))}<select id="pc-scope"><option value="all">${esc(t(pending ? "本次生成的目录" : "全部书签"))}</option>${pending ? "" : `<option value="selected">${esc(t("所选书签"))}</option><option value="subtree">${esc(t("所选及后代"))}</option>`}</select></label>
        <label>${esc(t("正文搜索页面"))}<input id="pc-range" value="1-${S.info.pageCount}" placeholder="1-50,60-100"></label>
        <label>${esc(t("排除目录及索引页"))}<input id="pc-exclude" placeholder="1-5,12"></label>
      </div>
      <div class="form-grid"><label>${esc(t("标题上方留白（pt）"))}<input id="pc-offset" type="number" min="-1000" max="1000" step="1" value="14"></label>
      <label class="check"><input id="pc-convert" type="checkbox">${esc(t("允许转换原始本地动作／命名目标为独立直接目标"))}</label></div>
      <p class="callout">${esc(t("置信度是规则证据评分，不是统计正确率。原页码和相邻条目的偏移不决定候选；短标题、正文提及和重名项需核对。"))}</p>
      <p id="pc-status" role="status">${esc(t("选择正文范围并排除目录页，然后开始分析。扫描件需已有文字层或已应用的 OCR 结果。"))}</p>
      <div class="menu-grid"><button id="pc-high">${esc(t("选择高置信度建议"))}</button><button id="pc-clear">${esc(t("全部保留原目标"))}</button></div>
      <div class="pc-preview-box"><p id="pc-preview-label" role="status"></p><canvas id="pc-preview" hidden></canvas></div>
      <div class="pc-toolbar"><button id="pc-prev">${esc(t("上一组"))}</button><span id="pc-page"></span><button id="pc-next">${esc(t("下一组"))}</button><span id="pc-selected" role="status"></span></div>
      <div id="pc-results" class="preview-list"></div>`,
      [
        { text: t("关闭"), run: closeModal },
        {
          text: t("停止分析"),
          id: "pc-stop",
          run: () => {
            stop();
            ready = false;
            $("#pc-status").textContent = t("分析已停止，未应用任何校准。");
            updateButtons();
          },
        },
        { text: t("开始分析"), id: "pc-run", run: scan },
        {
          text: t(pending ? "应用校准后的书签" : "应用所选校准"),
          id: "pc-apply",
          primary: true,
          run: () => {
            if (!ready || busy || stale())
              throw Error(t("文档已改变，请重新打开校准预览。"));
            const applied = applyPageCalibration(
              input,
              results,
              choices,
              S.info.pageCount,
            );
            if (!applied.count) return;
            if (options.onApply) options.onApply(applied.nodes);
            else commit(applied.nodes);
            closeModal();
            toast(t("已校准 {0} 项，可整批撤销", { 0: applied.count }));
          },
        },
      ],
    );
    if (!pending && S.selected.size) $("#pc-scope").value = "selected";
    async function scan() {
      stop();
      const rev = revision;
      ready = false;
      busy = true;
      results = [];
      choices.clear();
      pageIndex = 0;
      $("#pc-results").replaceChildren();
      $("#pc-preview").hidden = true;
      drawRevision++;
      renderTask?.cancel();
      updateButtons();
      try {
        if (stale()) throw Error(t("文档已改变，请重新打开校准预览。"));
        const scope = $("#pc-scope").value,
          ids =
            scope === "all"
              ? new Set(input.map((n) => n.id))
              : scope === "subtree"
                ? descendants(input, S.selected)
                : new Set(S.selected);
        const convert = $("#pc-convert").checked;
        const nodes = input.filter(
          (n) =>
            ids.has(n.id) &&
            Number.isInteger(n.target?.page) &&
            (n.target.kind === "dest" || convert),
        );
        if (!nodes.length) throw Error(t("没有可校准的本地书签。"));
        if (nodes.length > 10000)
          throw Error(t("请每次选择不超过 10,000 条书签。"));
        const excluded = $("#pc-exclude").value.trim()
          ? pageRange($("#pc-exclude").value, S.info.pageCount)
          : [];
        const excludedSet = new Set(excluded),
          numbers = pageRange($("#pc-range").value, S.info.pageCount).filter(
            (p) => !excludedSet.has(p),
          );
        const offset = Number($("#pc-offset").value);
        if (
          !numbers.length ||
          !Number.isFinite(offset) ||
          Math.abs(offset) > 1000
        )
          throw Error(t("搜索范围或留白无效。"));
        const pages = {};
        let lineCount = 0,
          empty = 0,
          labels = [];
        try {
          labels = (await pdf.getPageLabels()) || [];
        } catch {
          /* labels are optional evidence */
        }
        for (let i = 0; i < numbers.length; i++) {
          if (!alive(rev)) return;
          const p = numbers[i];
          $("#pc-status").textContent = t(
            "正在分析 PDF 第 {0} 页（{1} / {2}）",
            { 0: p, 1: i + 1, 2: numbers.length },
          );
          const lines = await extractLines(pdf, p, surface.rotation(p), {
            ocr,
          });
          if (!alive(rev)) return;
          if (!lines.length) empty++;
          pages[p] = calibrationLines(lines);
          lineCount += pages[p].length;
          if (lineCount > 250000)
            throw Error(t("文字行超过分析预算，请缩小正文搜索范围。"));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (!alive(rev)) return;
        $("#pc-status").textContent = t("正在逐条比较标题候选…");
        const found = await new Promise((resolve, reject) => {
          const current = new Worker(
            new URL("./page-calibration-worker.mjs", import.meta.url),
            { type: "module" },
          );
          worker = current;
          const finish = (value, error) => {
            clearTimeout(timeout);
            current.terminate();
            if (worker === current) {
              worker = null;
              settleWorker = null;
            }
            error ? reject(error) : resolve(value);
          };
          const timeout = setTimeout(
            () =>
              finish(null, Error(t("分析超时，请缩小范围或分批选择书签。"))),
            30000,
          );
          settleWorker = (value) => finish(value);
          current.onmessage = (e) =>
            e.data.error
              ? finish(null, Error(e.data.error))
              : finish(e.data.results);
          current.onerror = (e) => finish(null, Error(e.message));
          current.postMessage({
            nodes,
            pages,
            pageLabels: labels,
            pageCount: S.info.pageCount,
            excludedPages: excluded,
            offset,
          });
        });
        if (!alive(rev) || !found) return;
        results = found;
        ready = true;
        for (const r of results) choices.set(r.id, -1);
        $("#pc-status").textContent = t(
          "完成：{0} 项，高置信度 {1} 项，待核对 {2} 项，未匹配 {3} 项；{4} 页无可用文字，{5} 项未授权或不支持。",
          {
            0: results.length,
            1: results.filter((r) => r.status === "high").length,
            2: results.filter((r) => ["review", "ambiguous"].includes(r.status))
              .length,
            3: results.filter((r) => r.status === "unmatched").length,
            4: empty,
            5: ids.size - nodes.length,
          },
        );
        renderRows();
      } catch (e) {
        if (!closed && rev === revision) {
          ready = false;
          $("#pc-status").textContent = e.message;
        }
      } finally {
        if (!closed && rev === revision) {
          busy = false;
          if (stale()) {
            $("#pc-status").textContent = t("文档已改变，请重新打开校准预览。");
            ready = false;
          }
          updateButtons();
        }
      }
    }
    function renderRows() {
      $("#pc-results").innerHTML = results
        .slice(pageIndex * 50, (pageIndex + 1) * 50)
        .map((r) => {
          const choice = choices.get(r.id),
            manual = typeof choice === "object",
            c = !manual && choice >= 0 ? r.candidates[choice] : r.candidates[0];
          const before = r.before?.page || "?",
            best = manual ? choice.page : c?.page,
            delta =
              best !== undefined && Number.isInteger(r.before?.page)
                ? best - r.before.page
                : null;
          const details =
            !manual && c
              ? [
                  ...c.evidence.map((k) => t(evidenceText[k] || k)),
                  ...c.warnings.map((k) => t(warningText[k] || k)),
                ].join(" · ")
              : "";
          return `<article class="change-card pc-row" data-row="${esc(r.id)}"><strong translate="no">${esc(r.title)}</strong>
          <p><span class="pc-confidence" data-status="${manual ? "manual" : r.status}">${manual ? esc(t("手动指定，未自动验证")) : `<span>${esc(t(statusText[r.status]))}</span> · ${r.confidence}/100`}</span></p>
          <p>${esc(t("原目标 PDF 第 {0} 页；建议第 {1} 页；本条偏移 {2}", { 0: before, 1: best ?? "—", 2: delta === null ? "—" : delta > 0 ? `+${delta}` : delta }))}</p>
          ${r.printedLabel ? `<p>${esc(t("目录原始页码"))}：<span translate="no">${esc(r.printedLabel)}</span></p>` : ""}
          <label>${esc(t("匹配位置"))}<select data-choice="${esc(r.id)}"><option value="-1">${esc(t("保留原目标 / 暂不校准"))}</option>${r.candidates.map((c, i) => `<option translate="no" value="${i}">${esc(localized("PDF 第 {0} 页 · 证据评分 {1} · {2}", { 0: c.page, 1: c.score, 2: c.text.slice(0, 140) }))}</option>`).join("")}${manual ? `<option value="manual">${esc(t("手动指定 PDF 第 {0} 页", { 0: choice.page }))}</option>` : ""}</select></label>
          <p class="hint">${esc(details)}</p><div class="pc-actions"><button data-before="${esc(r.id)}">${esc(t("查看原位置"))}</button><button data-after="${esc(r.id)}">${esc(t("查看候选位置"))}</button><label>${esc(t("手动目标页"))}<input data-manual="${esc(r.id)}" type="number" min="1" max="${S.info.pageCount}" value="${manual ? choice.page : ""}"></label><button data-use-manual="${esc(r.id)}">${esc(t("采用手动页码"))}</button></div></article>`;
        })
        .join("");
      for (const el of $("#pc-results").querySelectorAll("[data-choice]")) {
        const c = choices.get(el.dataset.choice);
        el.value = typeof c === "object" ? "manual" : String(c ?? -1);
      }
      updateButtons();
    }
    async function draw(id, after) {
      if (!ready || stale()) return;
      const r = results.find((r) => r.id === id);
      if (!r) return;
      const choice = choices.get(id),
        candidate =
          r.candidates[Number.isInteger(choice) && choice >= 0 ? choice : 0];
      const target = after
        ? typeof choice === "object"
          ? choice
          : candidate?.target
        : r.before;
      if (!target?.page) return;
      const rev = ++drawRevision;
      renderTask?.cancel();
      const p = await pdf.getPage(target.page);
      if (closed || rev !== drawRevision) return;
      const vp = p.getViewport({
          scale: 1,
          rotation: surface.rotation(target.page),
        }),
        scale = Math.min(1.1, 760 / vp.width),
        view = p.getViewport({
          scale,
          rotation: surface.rotation(target.page),
        });
      const c = document.createElement("canvas");
      c.width = Math.ceil(view.width);
      c.height = Math.ceil(view.height);
      renderTask = p.render({
        canvasContext: c.getContext("2d"),
        viewport: view,
      });
      try {
        await renderTask.promise;
      } catch (e) {
        if (e.name === "RenderingCancelledException") return;
        throw e;
      }
      if (closed || rev !== drawRevision || stale()) return;
      const v = $("#pc-preview");
      v.width = c.width;
      v.height = c.height;
      v.hidden = false;
      const g = v.getContext("2d");
      g.drawImage(c, 0, 0);
      if (target.mode === "XYZ" && target.args[1] !== null) {
        const [x, y] = view.convertToViewportPoint(
          target.args[0] ?? p.view[0],
          target.args[1],
        );
        g.strokeStyle = "#5368db";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(Math.max(0, x - 6), y);
        g.lineTo(view.width, y);
        g.stroke();
      }
      $("#pc-preview-label").textContent = t(
        after ? "候选预览：PDF 第 {0} 页" : "原位置预览：PDF 第 {0} 页",
        { 0: target.page },
      );
    }
    $("#pc-results").onchange = (e) => {
      if (!e.target.dataset.choice || !ready) return;
      const id = e.target.dataset.choice;
      if (e.target.value !== "manual") choices.set(id, Number(e.target.value));
      renderRows();
      guarded(() => draw(id, true));
    };
    $("#pc-results").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.before) guarded(() => draw(b.dataset.before, false));
      if (b.dataset.after) guarded(() => draw(b.dataset.after, true));
      if (b.dataset.useManual)
        guarded(() => {
          const id = b.dataset.useManual,
            field = b.closest("[data-row]").querySelector("[data-manual]"),
            p = Number(field.value);
          if (!Number.isInteger(p) || p < 1 || p > S.info.pageCount)
            throw Error(t("手动页码超出范围。"));
          choices.set(id, { kind: "dest", page: p, mode: "Fit", args: [] });
          renderRows();
          return draw(id, true);
        });
    };
    $("#pc-high").onclick = () => {
      for (const r of results) if (r.recommended === 0) choices.set(r.id, 0);
      renderRows();
    };
    $("#pc-clear").onclick = () => {
      for (const r of results) choices.set(r.id, -1);
      renderRows();
    };
    $("#pc-prev").onclick = () => {
      pageIndex = Math.max(0, pageIndex - 1);
      renderRows();
    };
    $("#pc-next").onclick = () => {
      pageIndex++;
      renderRows();
    };
    for (const id of [
      "pc-scope",
      "pc-range",
      "pc-exclude",
      "pc-offset",
      "pc-convert",
    ])
      $("#" + id).oninput = invalidate;
    const stopLanguage = onLanguageChange(() => {
      if (closed) return;
      const drafts = new Map(
        [...$("#pc-results").querySelectorAll("[data-manual]")].map((el) => [
          el.dataset.manual,
          el.value,
        ]),
      );
      renderRows();
      for (const el of $("#pc-results").querySelectorAll("[data-manual]"))
        if (drafts.has(el.dataset.manual))
          el.value = drafts.get(el.dataset.manual);
    });
    setCleanup(() => {
      stopLanguage();
      closed = true;
      stop();
      drawRevision++;
      renderTask?.cancel();
      results = [];
      choices.clear();
    });
    updateButtons();
  };
}

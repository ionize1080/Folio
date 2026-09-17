import { bindUnit } from "./units.mjs";
import { appendLine } from "./line-geometry.mjs";
import { duplicatePlan } from "./bookmark-tools.mjs";
import { extractLines } from "./text-lines.mjs";
import { clone, descendants } from "./model.mjs";
export function installBookmarkUI({
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
  const scopeIds = (value) =>
    value === "all"
      ? new Set(S.nodes.map((n) => n.id))
      : value === "subtree"
        ? descendants(S.nodes, S.selected)
        : new Set(S.selected);
  function dedupeDialog() {
    if (!S.pdf) return;
    let preview,
      keep = {};
    modal(
      "查找重复书签",
      `<div class="form-grid"><label>判断方式<select id="du-mode"><option value="page">同页同标题（忽略坐标和缩放）</option><option value="near">同页位置容差</option><option value="exact">完整目标完全一致</option></select></label><label>比较范围<select id="du-scope"><option value="siblings">同一父项</option><option value="selected">所选书签</option><option value="subtree">所选子树</option><option value="all">整棵树</option></select></label><label>坐标容差（pt）<input id="du-tolerance" type="number" value="3" min="0" step="0.5"></label><label class="check"><input id="du-loose" type="checkbox" checked>忽略空白和全半角差异</label></div><p class="callout" id="du-summary"></p><p>每组选择保留项；被移除书签的子项合并至保留项。祖先与后代不互相合并，整批可撤销。</p><div id="du-groups" class="preview-list"></div>`,
      [
        { text: "关闭", run: closeModal },
        {
          text: "应用去重",
          id: "du-apply",
          primary: true,
          run: () => {
            if (!preview?.removed.length) return;
            commit(preview.nodes);
            toast(`已移除 ${preview.removed.length} 项，子项已保留`);
            closeModal();
          },
        },
      ],
    );
    function update(reset = false) {
      if (reset) keep = {};
      try {
        const scope = $("#du-scope").value;
        preview = duplicatePlan(S.nodes, {
          mode: $("#du-mode").value,
          scope: scope === "siblings" ? "siblings" : "all",
          ids: ["selected", "subtree"].includes(scope) ? scopeIds(scope) : null,
          tolerance: +$("#du-tolerance").value,
          loose: $("#du-loose").checked,
          keep,
        });
        $("#du-summary").textContent =
          `发现 ${preview.groups.length} 组 · 将移除 ${preview.removed.length} 项（展示前 500 组）`;
        $("#du-tolerance").disabled = $("#du-mode").value !== "near";
        $("#du-groups").innerHTML = preview.groups
          .slice(0, 500)
          .map(
            (g, i) =>
              `<div class="change-card"><strong>${esc(g.members[0].title)}</strong><label>保留<select data-group="${i}">${g.members.map((m) => `<option value="${esc(m.id)}" ${m.id === g.keep ? "selected" : ""}>PDF 第 ${m.page || "?"} 页 · ${esc(JSON.stringify(m.args))} · ${esc(m.id.slice(0, 8))}</option>`).join("")}</select></label><small>${g.members.length} 项；其余项目的子项将合并</small></div>`,
          )
          .join("");
        $("#du-apply").disabled = !preview.removed.length;
      } catch (e) {
        preview = null;
        $("#du-summary").textContent = e.message;
        $("#du-apply").disabled = true;
      }
    }
    $("#du-groups").onchange = (e) => {
      const g = preview.groups[+e.target.dataset.group];
      keep[g.members[0].id] = e.target.value;
      update();
    };
    for (const id of ["du-mode", "du-scope", "du-tolerance", "du-loose"])
      $("#" + id).oninput = () => update(true);
    update();
  }
  function calibrateDialog() {
    if (!S.pdf) return;
    let results = [],
      choices = new Map(),
      closed = false,
      worker,
      revision = 0,
      renderTask,
      cache = new Map(),
      timer;
    modal(
      "按标题校准书签目标",
      `<div class="form-grid three"><label>书签范围<select id="cal-scope"><option value="selected">所选书签</option><option value="subtree">所选及后代</option><option value="all">全部书签</option></select></label><label>标题上方留白<input id="cal-offset" type="number" value="5" step="0.5"></label><label>单位<select id="cal-unit"><option>mm</option><option>pt</option></select></label></div><details><summary>匹配设置</summary><label class="check"><input id="cal-loose" type="checkbox" checked>忽略空白、换行和全半角差异</label><label>从书签标题去掉的正则（可空）<input id="cal-strip" placeholder="例如：^\\d+[.、]\\s*"></label><div class="form-grid three"><label>排除页眉（pt）<input id="cal-header" type="number" value="0" min="0"></label><label>排除页脚（pt）<input id="cal-footer" type="number" value="0" min="0"></label><label>允许前后跨页数<input id="cal-radius" type="number" min="0" max="20" value="0"></label></div><label class="check"><input id="cal-convert" type="checkbox">允许转换原始本地动作／命名目标为独立直接目标</label></details><p id="cal-status" class="callout">在原目标页优先寻找独立标题，结合边界与位置推荐匹配；找不到时保留原目标。修改设置后自动刷新。</p><div class="menu-grid"><button id="cal-before">查看原位置</button><button id="cal-after">查看新位置</button></div><canvas id="cal-preview" hidden></canvas><div id="cal-results" class="preview-list"></div>`,
      [
        { text: "关闭", run: closeModal },
        { text: "重新匹配", run: () => guarded(scan) },
        {
          text: "应用校准",
          id: "cal-apply",
          primary: true,
          run: () => {
            const out = clone(S.nodes),
              map = new Map(out.map((n) => [n.id, n]));
            let count = 0;
            for (const r of results) {
              const c = r.candidates[choices.get(r.id) ?? -1];
              if (c) {
                map.get(r.id).target = c.target;
                count++;
              }
            }
            commit(out);
            closeModal();
            toast(`已校准 ${count} 项，可整批撤销`);
          },
        },
      ],
    );
    bindUnit($("#cal-unit"), [$("#cal-offset")], "mm");
    $("#cal-scope").value = S.selected.size ? "selected" : "all";
    $("#cal-apply").disabled = true;
    let activeId = null;
    async function scan() {
      const rev = ++revision;
      worker?.terminate();
      $("#cal-apply").disabled = true;
      const ids = scopeIds($("#cal-scope").value),
        nodes = S.nodes.filter(
          (n) =>
            ids.has(n.id) &&
            n.target.page &&
            (n.target.kind === "dest" || $("#cal-convert").checked),
        );
      const radius = +$("#cal-radius").value;
      if (!Number.isInteger(radius) || radius < 0 || radius > 20)
        throw Error("跨页数应为 0–20");
      const pages = {};
      for (const n of nodes)
        for (
          let p = Math.max(1, n.target.page - radius);
          p <= Math.min(S.info.pageCount, n.target.page + radius);
          p++
        )
          pages[p] = null;
      for (const p of Object.keys(pages)) {
        if (closed || rev !== revision) return;
        $("#cal-status").textContent = `正在提取第 ${p} 页文字…`;
        if (!cache.has(+p))
          cache.set(+p, [
            ...(await extractLines(S.pdf, +p, surface.rotation(+p), {
              ocr: S.ocr,
            })),
            ...(await extractLines(S.pdf, +p, surface.rotation(+p), {
              ocr: S.ocr,
              visualRows: true,
            })),
          ]);
        const lines = cache.get(+p);
        pages[p] = [];
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          pages[p].push(l);
          let joined = l,
            bottom = l.bottom;
          for (let j = 1; j <= 2 && i + j < lines.length; j++) {
            const next = lines[i + j];
            if (
              Math.abs(next.left - l.left) > 15 ||
              next.top - bottom > 20 ||
              next.top < l.top
            )
              break;
            joined = appendLine(joined, next);
            bottom = next.bottom;
            pages[p].push(joined);
          }
        }
      }
      if (closed || rev !== revision) return;
      const args = {
        nodes,
        pages,
        loose: $("#cal-loose").checked,
        strip: $("#cal-strip").value,
        header: +$("#cal-header").value,
        footer: +$("#cal-footer").value,
        offset: +$("#cal-offset").value,
        unit: $("#cal-unit").value,
        radius,
      };
      const r = await new Promise((resolve, reject) => {
        worker = new Worker(
          new URL("./calibrate-worker.mjs", import.meta.url),
          { type: "module" },
        );
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(Error("匹配超时，请简化标题预处理正则"));
        }, 6000);
        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          e.data.error ? reject(Error(e.data.error)) : resolve(e.data.results);
        };
        worker.onerror = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(Error(e.message));
        };
        worker.postMessage(args);
      });
      if (closed || rev !== revision) return;
      const previous = new Map(
        results.map((r) => [
          r.id,
          choices.get(r.id) === -1
            ? "skip"
            : r.candidates[choices.get(r.id) ?? -1],
        ]),
      );
      results = r;
      for (const row of r) {
        const old = previous.get(row.id);
        const match =
          old && old !== "skip"
            ? row.candidates.findIndex(
                (c) => c.page === old.page && c.text === old.text,
              )
            : -1;
        choices.set(
          row.id,
          old === "skip"
            ? -1
            : match >= 0
              ? match
              : row.candidates[0]?.score >= 25 &&
                  (!row.candidates[1] ||
                    row.candidates[0].score - row.candidates[1].score >= 10)
                ? 0
                : -1,
        );
      }
      activeId = results.find((r) => r.candidates.length)?.id;
      $("#cal-status").textContent =
        `选择 ${ids.size} 项 · 匹配 ${r.filter((r) => r.candidates.length).length} 项 · 未匹配 ${r.filter((r) => !r.candidates.length).length} 项 · 不支持或未授权转换 ${ids.size - nodes.length} 项（显示前 500 项）`;
      $("#cal-results").innerHTML = r
        .slice(0, 500)
        .map(
          (r) =>
            `<div class="change-card" data-cal="${esc(r.id)}"><strong>${esc(r.title)}</strong><p>原目标：p.${r.before?.page || "?"} ${esc(JSON.stringify(r.before?.args))}</p>${
              r.candidates.length
                ? `<select aria-label="匹配位置" data-choice="${esc(r.id)}"><option value="-1">保留原目标 / 暂不校准</option>${r.candidates
                    .map(
                      (c, i) =>
                        `<option value="${i}">p.${c.page} · ${esc(c.evidence)} · ${esc(c.text.slice(0, 100))} · ${esc(
                          c.target.args
                            .slice(0, 2)
                            .map((x) => x.toFixed(1))
                            .join(", "),
                        )}</option>`,
                    )
                    .join("")}</select>`
                : `<p>${esc(r.reason)}</p>`
            }</div>`,
        )
        .join("");
      $("#cal-results")
        .querySelectorAll("[data-choice]")
        .forEach(
          (el) => (el.value = String(choices.get(el.dataset.choice) ?? -1)),
        );
      $("#cal-apply").disabled = !r.some((r) => (choices.get(r.id) ?? -1) >= 0);
    }
    async function draw(after) {
      const r = results.find((r) => r.id === activeId);
      if (!r) return;
      const t = after
        ? r.candidates[choices.get(r.id) ?? -1]?.target
        : r.before;
      if (!t?.page) return;
      renderTask?.cancel();
      const rev = revision,
        p = await S.pdf.getPage(t.page),
        vp = p.getViewport({ scale: 1.2, rotation: surface.rotation(t.page) }),
        pt = vp.convertToViewportPoint(
          t.mode === "XYZ" ? (t.args[0] ?? p.view[0]) : p.view[0],
          t.mode === "XYZ" ? (t.args[1] ?? p.view[3]) : p.view[3],
        ),
        off = Math.max(0, pt[1] - 35),
        c = document.createElement("canvas");
      c.width = Math.min(900, vp.width);
      c.height = 220;
      renderTask = p.render({
        canvasContext: c.getContext("2d"),
        viewport: vp,
        transform: [1, 0, 0, 1, 0, -off],
      });
      try {
        await renderTask.promise;
      } catch (e) {
        if (e.name === "RenderingCancelledException") return;
        throw e;
      }
      if (closed || rev !== revision) return;
      const v = $("#cal-preview");
      v.hidden = false;
      v.width = c.width;
      v.height = c.height;
      const g = v.getContext("2d");
      g.drawImage(c, 0, 0);
      g.strokeStyle = after ? "#5267db" : "#d68d32";
      g.beginPath();
      g.moveTo(0, pt[1] - off);
      g.lineTo(v.width, pt[1] - off);
      g.stroke();
      if (after) {
        g.strokeStyle = "#5267db";
        g.fillStyle = "#5267db22";
        for (const s of r.candidates[choices.get(r.id) ?? -1]?.segments || []) {
          const [x, y] = vp.convertToViewportPoint(...s.point);
          const width = (s.right - s.left) * 1.2,
            height = (s.bottom - s.top) * 1.2;
          g.fillRect(x, y - off, width, height);
          g.strokeRect(x, y - off, width, height);
        }
      }
    }
    $("#cal-results").onclick = (e) => {
      const el = e.target.closest("[data-cal]");
      if (el) {
        activeId = el.dataset.cal;
        guarded(() => draw(true));
      }
    };
    $("#cal-results").onchange = (e) => {
      if (e.target.dataset.choice) {
        choices.set(e.target.dataset.choice, +e.target.value);
        $("#cal-apply").disabled = !results.some(
          (r) => (choices.get(r.id) ?? -1) >= 0,
        );
        activeId = e.target.dataset.choice;
        guarded(() => draw(true));
      }
    };
    $("#cal-before").onclick = () => guarded(() => draw(false));
    $("#cal-after").onclick = () => guarded(() => draw(true));
    const changed = (e) => {
      if (e.target.closest("#cal-results")) return;
      clearTimeout(timer);
      revision++;
      worker?.terminate();
      $("#cal-apply").disabled = true;
      timer = setTimeout(() => guarded(scan), 300);
    };
    $("#modal-body").addEventListener("input", changed);
    setCleanup(() => {
      closed = true;
      revision++;
      clearTimeout(timer);
      worker?.terminate();
      renderTask?.cancel();
      cache.clear();
      $("#modal-body").removeEventListener("input", changed);
    });
    guarded(scan);
  }
  return { dedupeDialog, calibrateDialog };
}

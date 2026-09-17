import { nativeRequest, releaseSource } from "./native-source.mjs";
import { pageCandidates, topBounds } from "./flow-page-model.mjs";
import { gridOperation, cellFrames, validateGrid } from "./table-model.mjs";
import { editStyles } from "./flow-style.mjs";
export async function tableDialog(ctx) {
  const {
    S,
    modal,
    closeModal,
    commit,
    refreshNative,
    esc,
    guarded,
    setCleanup,
    toast,
    writeFile,
  } = ctx;
  if (!S.pdf) return;
  await S.flowEdit?.finish?.(true);
  const page = S.page,
    source = S.bytes,
    result = await nativeRequest({
      command: "inspect",
      bytes: source,
      page,
    });
  if (!result.tables.length) throw Error("当前页没有可靠的有线表格");
  let closed = false,
    table,
    original,
    preview = null,
    revision = 0,
    timer,
    history = [],
    future = [];
  const candidates = pageCandidates(
    result.objects,
    ...result.size,
    [],
    result.tables,
  );
  modal(
    "表格结构编辑",
    `<p class="callout">选择可靠的矩形有线表格。新增行列在原表格范围内分配空间；不会移动表格外内容。应用前检查实际排版预览。</p><label>表格<select id="table-select">${result.tables.map((t, i) => `<option value="${i}">表格 ${i + 1} · ${t.rows} 行 × ${t.columns} 列</option>`).join("")}</select></label><div class="table-tools"><label>行<input id="table-row" type="number" min="1" value="1"></label><label>列<input id="table-col" type="number" min="1" value="1"></label><label>至行<input id="table-end-row" type="number" min="1" value="1"></label><label>至列<input id="table-end-col" type="number" min="1" value="1"></label><button data-grid-op="insert-row">上方插入行</button><button data-grid-op="delete-row">删除行</button><button data-grid-op="insert-column">左侧插入列</button><button data-grid-op="delete-column">删除列</button><button data-grid-op="merge">合并矩形</button><button data-grid-op="split">拆开单元格</button><label>所选列宽（pt）<input id="table-width" type="number" min="12" step="1"></label><button data-grid-op="width">调整列宽</button><button id="table-undo">撤销结构操作</button><button id="table-redo">重做</button></div><div class="table-tools"><button data-table-export="csv">导出 CSV</button><button data-table-export="xlsx">导出 XLSX</button><span class="hint">XLSX 保留合并单元格、前导零和原始文本</span></div><p id="table-status" role="status"></p><div class="table-grid-wrap"><div id="table-columns"></div><div id="table-grid"></div></div><details open><summary>实际输出预览</summary><img id="table-output" alt="表格实际排版预览"></details>`,
    [
      { text: "取消", run: closeModal },
      {
        text: "应用表格修改",
        id: "table-apply",
        primary: true,
        run: async () => {
          if (!preview || source !== S.bytes) throw Error("请等待有效预览");
          const textSources = candidates
              .filter((c) => c.model.cell?.tableId === original.id)
              .flatMap((c) => c.model.sources),
            indices = new Set(textSources.map((s) => s.index));
          const paths = result.objects.filter(
            (o) =>
              o.type === "path" &&
              inside(topBounds(o, result.size[1]), original.bounds),
          );
          const pathIds = new Set(paths.map((o) => o.index));
          let edits = structuredClone(S.nativeEdits || []).filter(
            (e) =>
              e.page !== page ||
              !(
                e.tableModel?.id === original.id ||
                e.model?.cell?.tableId === original.id ||
                indices.has(e.index) ||
                pathIds.has(e.index) ||
                e.sources?.some((s) => indices.has(s.index))
              ),
          );
          edits.push(
            ...paths.map((o) => ({
              page,
              type: "path",
              index: o.index,
              signature: o.signature,
              delete: true,
            })),
          );
          const model = structuredClone(table.cells[0].model);
          model.sources = textSources;
          model.frame = {
            x: original.bounds[0],
            y: original.bounds[1],
            width: original.bounds[2] - original.bounds[0],
            height: original.bounds[3] - original.bounds[1],
          };
          model.text = table.cells.map((c) => c.model.text).join("\n");
          delete model.cell;
          delete model.tableGrowth;
          edits.push({
            id: crypto.randomUUID(),
            page,
            type: "flow",
            index: null,
            sources: textSources,
            model,
            tableModel: structuredClone(table),
            fragment: preview.fragment,
            ink: preview.glyphs,
          });
          await refreshNative(edits, S.ocr || [], S.ocrReference);
          commit(structuredClone(S.nodes), { nativeEdits: edits });
          closeModal();
          toast("表格结构已应用，可整批撤销");
        },
      },
    ],
  );
  document.querySelector("#modal").classList.add("table-dialog");
  setCleanup(() => {
    closed = true;
    revision++;
    clearTimeout(timer);
    document.querySelector("#modal").classList.remove("table-dialog");
  });
  const $ = (q) => document.querySelector(q);
  document.querySelectorAll("[data-table-export]").forEach(
    (button) =>
      (button.onclick = () =>
        guarded(async () => {
          const format = button.dataset.tableExport,
            captured = structuredClone(table);
          const r = await nativeRequest({
            command: "table-export",
            table: captured,
            format,
          });
          if (closed || source !== S.bytes) return;
          const saved = await writeFile(
            S.name.replace(/\.pdf$/i, "") + `-p${page}-table.${format}`,
            Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0)),
            format,
          );
          if (saved) toast("表格已导出");
        })),
  );
  function inside(b, t) {
    return (
      b[0] >= t[0] - 1 &&
      b[1] >= t[1] - 1 &&
      b[2] <= t[2] + 1 &&
      b[3] <= t[3] + 1
    );
  }
  function setup(index) {
    original = result.tables[index];
    if (original.structureSupported === false)
      throw Error("此表格边框样式复杂，请使用单元格文字编辑");
    const bounds = original.bounds;
    const overlap = (b, t) =>
      b[2] > t[0] + 1 && b[0] < t[2] - 1 && b[3] > t[1] + 1 && b[1] < t[3] - 1;
    for (const o of result.objects) {
      const b = topBounds(o, result.size[1]);
      if (!overlap(b, bounds)) continue;
      if (!inside(b, bounds))
        throw Error("表格与外部对象共用边界或内容，暂不能安全重建");
      if (
        (o.type === "text" && !o.flowEditable) ||
        (o.type === "path" && !o.editable) ||
        !["text", "path"].includes(o.type)
      )
        throw Error(
          "表格含图片、复杂路径或不可独立替换的文字，请使用单元格编辑",
        );
    }
    const xs = [
        ...new Set(original.cells.flatMap((c) => [c.bounds[0], c.bounds[2]])),
      ].sort((a, b) => a - b),
      ys = [
        ...new Set(original.cells.flatMap((c) => [c.bounds[1], c.bounds[3]])),
      ].sort((a, b) => a - b);
    if (xs.length !== original.columns + 1 || ys.length !== original.rows + 1)
      throw Error("行列边界不足以可靠重建");
    const prior = S.nativeEdits.find(
      (e) => e.page === page && e.tableModel?.id === original.id,
    );
    table = prior
      ? structuredClone(prior.tableModel)
      : {
          ...structuredClone(original),
          pageWidth: result.size[0],
          pageHeight: result.size[1],
          widths: xs.slice(1).map((x, i) => x - xs[i]),
          heights: ys.slice(1).map((y, i) => y - ys[i]),
          cells: original.cells.map((c) => {
            const candidate = candidates.find((q) => q.model.cell?.id === c.id);
            if (!candidate) throw Error("缺少可编辑单元格");
            const edit = S.nativeEdits.find(
              (e) => e.page === page && e.model?.cell?.id === c.id,
            );
            return {
              ...c,
              model: structuredClone(edit?.model || candidate.model),
              rowSpan: ys.indexOf(c.bounds[3]) - ys.indexOf(c.bounds[1]),
              colSpan: xs.indexOf(c.bounds[2]) - xs.indexOf(c.bounds[0]),
            };
          }),
        };
    validateGrid(table);
    history = [];
    future = [];
    draw();
    queue();
  }
  function draw() {
    const header = $("#table-columns");
    header.replaceChildren();
    header.style.gridTemplateColumns = table.widths
      .map((w) => `${w}fr`)
      .join(" ");
    table.widths.forEach((width, i) => {
      const el = document.createElement("div");
      el.textContent = `列 ${i + 1}`;
      if (i < table.columns - 1) {
        const handle = document.createElement("button");
        handle.className = "table-col-resize";
        handle.title = "拖动调整列宽";
        handle.setAttribute("aria-label", `调整第 ${i + 1} 列宽`);
        handle.onpointerdown = (e) => {
          e.preventDefault();
          const x = e.clientX,
            total = table.widths.reduce((a, b) => a + b, 0),
            px = header.clientWidth;
          handle.setPointerCapture(e.pointerId);
          handle.onpointermove = (q) => {
            $("#table-width").value = Math.max(
              12,
              Math.round(width + ((q.clientX - x) * total) / px),
            );
          };
          handle.onpointerup = (q) =>
            guarded(() => {
              const next = gridOperation(table, "width", {
                column: i,
                width: Math.max(
                  12,
                  Math.round(width + ((q.clientX - x) * total) / px),
                ),
              });
              history.push(table);
              future = [];
              table = next;
              draw();
              queue();
            });
        };
        el.append(handle);
      }
      header.append(el);
    });
    const grid = $("#table-grid");
    grid.style.gridTemplateColumns = table.widths
      .map((w) => `${w}fr`)
      .join(" ");
    grid.replaceChildren();
    for (const c of table.cells) {
      const box = document.createElement("label");
      box.style.gridArea = `${c.row + 1}/${c.column + 1}/span ${c.rowSpan || 1}/span ${c.colSpan || 1}`;
      const caption = document.createElement("span");
      caption.textContent = `${c.row + 1}, ${c.column + 1}`;
      const input = document.createElement("textarea");
      input.value = c.model.text;
      input.rows = 2;
      input.onfocus = () => {
        $("#table-row").value = c.row + 1;
        $("#table-col").value = c.column + 1;
        $("#table-end-row").value = c.row + (c.rowSpan || 1);
        $("#table-end-col").value = c.column + (c.colSpan || 1);
        $("#table-width").value = +table.widths[c.column].toFixed(2);
      };
      input.onchange = () => {
        history.push(structuredClone(table));
        future = [];
        c.model.runs = editStyles(
          c.model.runs || [],
          c.model.text,
          input.value,
          c.model,
        );
        c.model.text = input.value;
        queue();
      };
      box.append(caption, input);
      grid.append(box);
    }
    $("#table-width").value =
      +table.widths[
        Math.min(+$("#table-col").value - 1, table.columns - 1)
      ].toFixed(2);
  }
  function queue() {
    preview = null;
    $("#table-apply").disabled = true;
    clearTimeout(timer);
    const rev = ++revision;
    $("#table-status").textContent = "正在校验文字与边界…";
    timer = setTimeout(async () => {
      try {
        const r = await nativeRequest({
          command: "table-render",
          bytes: source,
          table,
        });
        if (closed || rev !== revision) return;
        preview = r;
        $("#table-output").src =
          "data:image/svg+xml;base64," +
          btoa(unescape(encodeURIComponent(r.svg)));
        $("#table-status").textContent =
          `${table.rows} 行 × ${table.columns} 列 · 排版检查通过${r.fallbackCount ? " · " + r.fallbackCount + " 字使用替代字体" : ""}`;
        $("#table-apply").disabled = false;
      } catch (e) {
        if (!closed && rev === revision)
          $("#table-status").textContent = e.message;
      }
    }, 200);
  }
  document.querySelectorAll("[data-grid-op]").forEach(
    (b) =>
      (b.onclick = () =>
        guarded(() => {
          const next = gridOperation(table, b.dataset.gridOp, {
            row: +$("#table-row").value - 1,
            column: +$("#table-col").value - 1,
            endRow: +$("#table-end-row").value - 1,
            endColumn: +$("#table-end-col").value - 1,
            width: +$("#table-width").value,
          });
          history.push(table);
          future = [];
          table = next;
          draw();
          queue();
        })),
  );
  $("#table-undo").onclick = () => {
    if (history.length) {
      future.push(table);
      table = history.pop();
      draw();
      queue();
    }
  };
  $("#table-redo").onclick = () => {
    if (future.length) {
      history.push(table);
      table = future.pop();
      draw();
      queue();
    }
  };
  $("#table-select").onchange = () =>
    guarded(() => setup(+$("#table-select").value));
  setup(0);
}

export function splitDialog({
  S,
  modal,
  closeModal,
  esc,
  commit,
  setCleanup,
  toast,
  writeFile,
}) {
  if (!S.nodes.length) {
    toast("当前文档没有书签");
    return;
  }
  let rules = [{ pattern: ".+", template: "$0" }],
    result = null,
    timer,
    timeout,
    worker,
    rev = 0,
    closed = false,
    composing = false,
    bound,
    previewPage = 0;
  const $ = (q) => document.querySelector(q);
  modal(
    "正则拆分书签",
    `
    <div class="split-scope-bar">
      <label>处理范围<select id="split-scope"><option value="selected" ${S.selected.size ? "" : "disabled"}>所选书签（${S.selected.size} 条，不自动含子项）</option><option value="all">全部书签（${S.nodes.length} 条）</option></select></label>
      <label>生成关系<select id="split-mode"><option value="siblings">同级多条（每条规则一项）</option><option value="hierarchy">父子层级（每条规则一级，可分支）</option></select></label>
    </div>
    <p class="split-guidance">所有规则独立读取同一个完整原题。父规则只决定输出位置；新书签继承原跳转目标。</p>
    <nav class="split-tabs" aria-label="拆分工作区"><button id="split-tab-rules" aria-pressed="true">编辑规则</button><button id="split-tab-preview" aria-pressed="false">结果预览</button></nav>
    <div class="split-workspace" data-pane="rules">
      <section class="split-editor" aria-label="拆分规则">
        <label>处理方式<select id="split-method"><option value="extract">独立正则 → 替换文本</option><option value="separator">按一个正则分隔原题</option></select></label>
        <label id="split-output-label">标题生成方式<select id="split-output"><option value="replace">查找替换：保留未匹配的原文</option><option value="template">捕获模板：仅输出替换文本</option></select></label>
        <label id="split-separator-label" hidden>分隔正则<input id="split-separator" value="[；;]"></label>
        <div id="split-rules"></div><button id="split-add">＋ 添加独立规则</button>
        <details class="split-advanced"><summary>高级：原书签、子项及多匹配</summary>
          <label class="check"><input type="checkbox" id="split-retain">保留原书签，在其子树之后插入结果</label>
          <label>替换时原有子项<select id="split-children"><option value="block">含子项时保留原项并提示</option><option value="first">整体迁移至首个生成节点</option><option value="last">整体迁移至最后生成节点</option></select></label>
          <label>多个父项关联<select id="split-pairing"><option value="block">有歧义时停止</option><option value="index">按匹配序号一一配对</option></select></label>
          <p>全部规则均未命中的原项自动保留；仅部分规则命中时整条原项保留并提示。选中祖先与后代时也各自只读取一次原题。</p>
        </details>
        <div class="split-rule-files"><button id="split-save">保存规则</button><button id="split-load">加载上次规则</button><button id="split-export">导出规则</button><label class="split-import">导入规则<input id="split-import" type="file" accept=".json"></label></div>
        <details class="split-help"><summary>捕获组与替换说明</summary><p>$0 或 $&amp; 表示完整匹配，$1、$2…表示捕获组，$&lt;名称&gt; 表示命名组，$$ 表示美元符号。括号中的反向引用不会增加捕获组。</p><p>“查找替换”保留匹配前后的原文；只想生成捕获组内容时用“捕获模板”。高级的“每个匹配生成一条”始终以完整原题分别求值。</p></details>
      </section>
      <section class="split-results" aria-label="拆分结果预览">
        <div class="split-preview-head"><strong>结果预览</strong><label class="check"><input id="split-auto" type="checkbox" checked>自动更新</label><button id="split-refresh">刷新预览</button></div>
        <p id="split-summary" role="status" aria-live="polite">正在准备预览…</p>
        <label class="split-filter-label">显示<select id="split-filter"><option value="changes">将修改的书签</option><option value="issues">需处理的问题</option><option value="skipped">未改变的书签</option></select></label>
        <div id="split-preview" tabindex="0" aria-label="原题与拆分结果"></div>
        <div class="split-preview-pages"><button id="split-prev">上一批</button><span id="split-page"></span><button id="split-next">下一批</button><button id="split-export-preview">导出完整预览</button></div>
        <label class="check split-partial"><input type="checkbox" id="split-valid">有问题时，仅应用预览中的有效来源</label>
      </section>
    </div>`,
    [
      { text: "取消", run: closeModal },
      {
        text: "预览结果",
        id: "split-preview-action",
        run: () => {
          pane("preview");
          queue(true);
        },
      },
      {
        text: "应用拆分",
        id: "split-apply",
        primary: true,
        run: () => {
          if (!result || !isCurrent()) {
            queue(true);
            toast("来源或范围已变化，已重新预览，请核对后应用");
            return;
          }
          if (result.issues.length && !$("#split-valid").checked)
            throw Error("请先处理问题，或明确选择仅应用有效来源");
          if (!result.changes.length) return;
          commit(result.nodes);
          closeModal();
          toast(
            `已拆分 ${result.changes.length} 条，可整批撤销；保存后写入 PDF`,
          );
        },
      },
    ],
  );
  $("#modal").classList.add("split-dialog");
  $("#split-scope").value = S.selected.size ? "selected" : "all";
  function pane(name) {
    $(".split-workspace").dataset.pane = name;
    $("#split-tab-rules").setAttribute(
      "aria-pressed",
      String(name === "rules"),
    );
    $("#split-tab-preview").setAttribute(
      "aria-pressed",
      String(name === "preview"),
    );
  }
  const config = () => ({
    mode: $("#split-mode").value,
    method:
      $("#split-mode").value === "hierarchy"
        ? "extract"
        : $("#split-method").value,
    outputMode: $("#split-output").value,
    separator: $("#split-separator").value,
    rules: structuredClone(rules),
    retain: $("#split-retain").checked,
    children: $("#split-children").value,
    pairing: $("#split-pairing").value,
  });
  const liveIDs = () =>
    $("#split-scope").value === "all"
      ? S.nodes.map((n) => n.id)
      : [...S.selected];
  const isCurrent = () =>
    bound &&
    bound.source === JSON.stringify(S.nodes) &&
    bound.ids === JSON.stringify(liveIDs()) &&
    bound.config === JSON.stringify(config());
  function render() {
    $("#split-rules").innerHTML = rules
      .map(
        (r, i) => `<div class="split-rule" data-rule="${i}">
      <div class="split-rule-heading"><strong>规则 ${i + 1}</strong><label class="check"><input data-key="enabled" type="checkbox" ${r.enabled !== false ? "checked" : ""}>启用</label><button data-remove="${i}" ${rules.length === 1 ? "disabled" : ""} aria-label="移除规则 ${i + 1}">移除</button></div>
      <label class="split-wide">查找正则<input data-key="pattern" value="${esc(r.pattern ?? "")}" spellcheck="false"></label>
      <label class="split-wide">替换文本<input data-key="template" value="${esc(r.template ?? "$0")}" spellcheck="false"></label>
      <label class="split-parent-label">生成节点的父级<select data-key="parentRule"><option value="auto">前一条启用规则（首条为根级）</option><option value="-1">根级：与原书签同级</option>${rules
        .slice(0, i)
        .map((_, j) => `<option value="${j}">规则 ${j + 1} 的输出</option>`)
        .join("")}</select></label>
      <details class="split-rule-extra"><summary>匹配选项</summary><label>正则标志<input data-key="flags" value="${esc(r.flags ?? "u")}" placeholder="imu"></label><label class="check"><input type="checkbox" data-key="all" ${r.all ? "checked" : ""}>每个匹配生成一条</label></details>
    </div>`,
      )
      .join("");
    $("#split-rules")
      .querySelectorAll('[data-key="parentRule"]')
      .forEach((e, i) => (e.value = String(rules[i].parentRule ?? "auto")));
    sync();
  }
  function sync() {
    const c = config(),
      extract = c.method === "extract",
      hierarchical = c.mode === "hierarchy";
    $("#split-method").value = c.method;
    $("#split-method").disabled = hierarchical;
    $("#split-rules").hidden = !extract;
    $("#split-add").hidden = !extract;
    $("#split-output-label").hidden = !extract;
    $("#split-separator-label").hidden = extract;
    $("#split-rules")
      .querySelectorAll(".split-parent-label")
      .forEach((e) => (e.hidden = !hierarchical));
    $("#split-add").textContent = hierarchical
      ? "＋ 添加规则 / 层级"
      : "＋ 添加同级规则";
    queue();
  }
  function stop() {
    clearTimeout(timer);
    clearTimeout(timeout);
    worker?.terminate();
    worker = null;
  }
  function applyState() {
    $("#split-apply").disabled =
      !result ||
      !isCurrent() ||
      !result.changes.length ||
      (result.issues.length > 0 && !$("#split-valid").checked);
    $("#split-apply").textContent = result?.changes.length
      ? `应用拆分（${result.changes.length} 条来源）`
      : "应用拆分";
  }
  function drawPreview() {
    const kind = $("#split-filter").value,
      entries = result?.[kind] || [],
      pages = Math.max(1, Math.ceil(entries.length / 20));
    previewPage = Math.min(previewPage, pages - 1);
    $("#split-page").textContent =
      `${previewPage + 1} / ${pages} 批 · ${entries.length} 条来源`;
    $("#split-prev").disabled = previewPage === 0;
    $("#split-next").disabled = previewPage + 1 >= pages;
    $("#split-export-preview").disabled = !result;
    $("#split-preview").innerHTML =
      entries
        .slice(previewPage * 20, previewPage * 20 + 20)
        .map((c) => {
          if (!c.made)
            return `<section class="change-card"><strong>${esc(c.title)}</strong><p>${esc(c.reason)}</p></section>`;
          const depths = new Map();
          return `<section class="change-card"><div class="split-original"><small>原书签 → ${c.retained ? "保留并新增" : "替换为"} ${c.made.length} 条</small><strong>${esc(c.title)}</strong></div>${c.made
            .slice(0, 100)
            .map((n) => {
              const depth = depths.has(n.parent) ? depths.get(n.parent) + 1 : 0;
              depths.set(n.id, depth);
              const e = c.evidence?.find((e) => e.id === n.id);
              const target =
                n.target?.kind === "dest"
                  ? `第 ${n.target.page} 页 · 继承原目标`
                  : "继承原始跳转动作";
              return `<div class="split-output-node" style="margin-left:${Math.min(depth, 12) * 14}px"><small>${config().mode === "hierarchy" ? `第 ${depth + 1} 级` : "同级"}${e ? ` · 规则 ${e.rule}` : ""}</small><strong>${esc(n.title)}</strong><small>${esc(target)}</small>${e ? `<details><summary>查看匹配与捕获组</summary><p>匹配：${esc(e.match)}</p>${e.captures.map((v, i) => `<p>$${i + 1} = ${esc(v ?? "（未匹配）")}</p>`).join("")}</details>` : ""}</div>`;
            })
            .join(
              "",
            )}${c.made.length > 100 ? "<p>本条展示前 100 个输出；可导出完整预览查看全部。</p>" : ""}</section>`;
        })
        .join("") ||
      `<p class="split-empty">${result ? "此分类没有结果。未匹配的书签会保留原样。" : "调整规则后自动预览，或点击“刷新预览”。"}</p>`;
  }
  function queue(force = false) {
    stop();
    result = null;
    bound = null;
    const v = ++rev;
    applyState();
    $("#split-preview").setAttribute("aria-busy", "true");
    $("#split-summary").textContent = composing
      ? "正在输入…"
      : !force && !$("#split-auto").checked
        ? "规则或范围已改变，请刷新预览。"
        : "正在计算完整范围预览…";
    $("#split-preview").replaceChildren();
    $("#split-export-preview").disabled = true;
    if (composing || (!force && !$("#split-auto").checked)) {
      $("#split-preview").setAttribute("aria-busy", "false");
      return;
    }
    timer = setTimeout(
      () => {
        const source = structuredClone(S.nodes),
          ids = liveIDs(),
          c = config();
        bound = {
          source: JSON.stringify(source),
          ids: JSON.stringify(ids),
          config: JSON.stringify(c),
        };
        if (!ids.length) {
          $("#split-summary").textContent = "没有选中书签，请改选“全部书签”。";
          $("#split-preview").setAttribute("aria-busy", "false");
          return;
        }
        worker = new Worker(new URL("./split-worker.mjs", import.meta.url), {
          type: "module",
        });
        const active = worker;
        const fail = (message) => {
          active.terminate();
          clearTimeout(timeout);
          if (closed || v !== rev) return;
          result = null;
          $("#split-summary").textContent = message;
          $("#split-preview").setAttribute("aria-busy", "false");
          applyState();
        };
        timeout = setTimeout(
          () => fail("计算超时，请简化正则或缩小范围。"),
          4000,
        );
        active.onerror = (e) => fail(`预览失败：${e.message}`);
        active.onmessage = (e) => {
          active.terminate();
          clearTimeout(timeout);
          if (closed || v !== rev) return;
          if (e.data.error) {
            fail(e.data.error);
            return;
          }
          if (!isCurrent()) {
            fail("来源已变化，请刷新预览。");
            return;
          }
          result = e.data;
          previewPage = 0;
          const count = result.changes.reduce((s, c) => s + c.made.length, 0);
          $("#split-summary").textContent =
            `${$("#split-scope").value === "all" ? "全部" : "所选"} ${ids.length} 条 → 修改 ${result.changes.length} 条，生成 ${count} 条；保留 ${result.skipped.length} 条，问题 ${result.issues.length} 条。`;
          $("#split-preview").setAttribute("aria-busy", "false");
          if (!result.changes.length)
            $("#split-filter").value = result.issues.length
              ? "issues"
              : "skipped";
          else $("#split-filter").value = "changes";
          drawPreview();
          applyState();
        };
        active.postMessage({
          nodes: source,
          ids,
          pageCount: S.info.pageCount,
          ...c,
        });
      },
      force ? 0 : 280,
    );
  }
  $("#split-rules").oninput = (e) => {
    const card = e.target.closest("[data-rule]"),
      key = e.target.dataset.key;
    if (!card || !key) return;
    const r = rules[+card.dataset.rule];
    if (key === "parentRule" && e.target.value === "auto") delete r.parentRule;
    else
      r[key] = ["enabled", "all"].includes(key)
        ? e.target.checked
        : key === "parentRule"
          ? +e.target.value
          : e.target.value;
    queue();
  };
  $("#split-rules").onclick = (e) => {
    const button = e.target.closest("[data-remove]");
    if (!button) return;
    const index = +button.dataset.remove;
    rules.splice(index, 1);
    rules.forEach((r) => {
      if (r.parentRule === index) delete r.parentRule;
      else if (r.parentRule > index) r.parentRule--;
    });
    render();
  };
  $("#split-rules").oncompositionstart = () => {
    composing = true;
    queue();
  };
  $("#split-rules").oncompositionend = () => {
    composing = false;
    queue();
  };
  $("#split-add").onclick = () => {
    if (rules.length >= 100) {
      toast("最多 100 条规则");
      return;
    }
    rules.push({ pattern: ".+", template: "$0" });
    render();
    $("#split-rules").lastElementChild.scrollIntoView({ block: "nearest" });
  };
  for (const id of [
    "scope",
    "mode",
    "method",
    "output",
    "separator",
    "retain",
    "children",
    "pairing",
    "auto",
  ])
    $("#split-" + id).addEventListener("input", sync);
  $("#split-valid").onchange = applyState;
  $("#split-refresh").onclick = () => queue(true);
  $("#split-tab-rules").onclick = () => pane("rules");
  $("#split-tab-preview").onclick = () => pane("preview");
  $("#split-filter").onchange = () => {
    previewPage = 0;
    drawPreview();
  };
  $("#split-prev").onclick = () => {
    previewPage--;
    drawPreview();
  };
  $("#split-next").onclick = () => {
    previewPage++;
    drawPreview();
  };
  const saveJSON = (name, data) =>
    writeFile?.(
      name,
      new TextEncoder().encode(JSON.stringify(data, null, 2)),
      "json",
    );
  $("#split-export-preview").onclick = () => {
    if (result && isCurrent())
      saveJSON("Folio-bookmark-split-preview.json", {
        scope: $("#split-scope").value,
        config: config(),
        ...result,
      });
  };
  $("#split-save").onclick = () => {
    localStorage.setItem(
      "folio-split-rules",
      JSON.stringify({ format: "folio-bookmark-split/1", ...config() }),
    );
    toast("拆分规则已保存");
  };
  function restore(c) {
    if (!c || (c.format && c.format !== "folio-bookmark-split/1"))
      throw Error("这不是有效的书签拆分规则文件");
    if (
      !Array.isArray(c.rules) ||
      !c.rules.length ||
      c.rules.length > 100 ||
      c.rules.some((r) => !r || typeof r.pattern !== "string")
    )
      throw Error("规则内容或数量无效");
    rules = structuredClone(c.rules);
    $("#split-mode").value = c.mode === "hierarchy" ? "hierarchy" : "siblings";
    $("#split-method").value =
      c.method === "separator" ? "separator" : "extract";
    $("#split-output").value =
      c.outputMode === "replace" ? "replace" : "template";
    $("#split-separator").value = c.separator ?? "[；;]";
    $("#split-retain").checked = !!c.retain;
    $("#split-children").value = ["first", "last"].includes(c.children)
      ? c.children
      : "block";
    $("#split-pairing").value = c.pairing === "index" ? "index" : "block";
    render();
  }
  $("#split-load").onclick = () => {
    try {
      restore(JSON.parse(localStorage.getItem("folio-split-rules")));
    } catch (e) {
      toast(e.message);
    }
  };
  $("#split-export").onclick = () =>
    saveJSON("Folio-bookmark-split-rules.json", {
      format: "folio-bookmark-split/1",
      ...config(),
    });
  $("#split-import").onchange = async () => {
    try {
      const f = $("#split-import").files[0];
      if (!f) return;
      if (f.size > 1024 * 1024) throw Error("规则文件过大");
      restore(JSON.parse(await f.text()));
    } catch (e) {
      toast(e.message);
    }
  };
  setCleanup(() => {
    closed = true;
    stop();
    $("#modal").classList.remove("split-dialog");
  });
  render();
  drawPreview();
}

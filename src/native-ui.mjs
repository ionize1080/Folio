import { nativeRequest, releaseSource } from "./native-source.mjs";
import { bindUnit } from "./units.mjs";
import { installFlowUI } from "./flow-ui.mjs";
import { ocrPage } from "./ocr-data.mjs";
import { ocrDialogV4 } from "./ocr-ui.mjs";
import { adjustWhitespace, describeChanges } from "./changes.mjs";
export function installNativeUI(ctx) {
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
      pageRange,
      clone,
      descendants,
      writeFile,
    } = ctx,
    $ = (s) => document.querySelector(s);
  let showOCR = false;
  const native = async (command, options = {}) => {
    if (!window.desktop?.native)
      throw Error("此功能需要完整 Windows 桌面运行包");
    return nativeRequest({
      command,
      bytes: command === "ocr" ? await S.pdf.getData() : S.bytes,
      ...options,
    });
  };
  const diffTable = (changes) =>
    changes
      .map(
        (c) =>
          `<details class="change-card" open><summary>${esc(c.title)} <small>${c.fields.length} 个字段变化</small></summary><table class="diff-table"><thead><tr><th>字段</th><th>原值</th><th>操作 / 换算</th><th>结果</th></tr></thead><tbody>${c.fields.map((f) => `<tr><td>${esc(f.name)}</td><td>${esc(JSON.stringify(f.before))}</td><td>${esc(f.operation)}</td><td>${esc(JSON.stringify(f.after))}</td></tr>`).join("")}</tbody></table><details><summary>完整跳转目标</summary><pre>${esc(JSON.stringify({ before: c.before, after: c.after }, null, 2))}</pre></details></details>`,
      )
      .join("");
  function whitespaceDialog() {
    if (!S.pdf) return;
    let preview,
      changes = [],
      task,
      revision = 0;
    modal(
      "调整书签跳转留白",
      `<p>正值增加标题上方的视觉留白，负值减少留白。按每页旋转方向换算，保持页码和缩放不变。</p><div class="form-grid three"><label>范围<select id="space-scope"><option value="selected">所选书签</option><option value="descendants">所选及子项</option><option value="all">全部书签</option></select></label><label>增加顶部留白<input id="space-amount" type="number" step="0.5" value="5"></label><label>单位<select id="space-unit"><option>mm</option><option>pt</option></select></label></div><div class="rule-toolbar">${[3, 5, 10, -3].map((v) => `<button data-space="${v}">${v > 0 ? "+" : ""}${v} mm</button>`).join("")}</div><label class="check"><input id="space-convert" type="checkbox">允许将原始本地动作 / 命名目标转换为直接目标（不修改共享目标）</label><p class="hint">null 缺少绝对锚点；整页适合模式没有顶部定位，均列出跳过原因。</p><p id="space-summary" class="callout"></p><div class="form-grid"><select id="space-item"></select><div><button id="space-before">修改前</button><button id="space-after">修改后</button></div></div><canvas id="space-preview" hidden></canvas><div id="space-diffs" class="preview-list"></div><details><summary>跳过详情</summary><div id="space-skipped"></div></details>`,
      [
        { text: "关闭", run: closeModal },
        {
          text: "导出全部报告",
          run: () =>
            writeFile(
              "Folio-whitespace-report.json",
              new TextEncoder().encode(
                JSON.stringify({ changes, skipped: preview?.skipped }, null, 2),
              ),
              "json",
            ),
        },
        {
          text: "应用修改",
          id: "space-apply",
          primary: true,
          run: () => {
            if (!preview || !changes.length) return;
            commit(preview.nodes);
            closeModal();
            toast(`已修改 ${changes.length} 个书签，可整批撤销`);
          },
        },
      ],
    );
    bindUnit($("#space-unit"), [$("#space-amount")], "mm");
    $("#space-scope").value = S.selected.size ? "selected" : "all";
    function update() {
      revision++;
      const scope = $("#space-scope").value,
        ids =
          scope === "all"
            ? new Set(S.nodes.map((n) => n.id))
            : scope === "descendants"
              ? descendants(S.nodes, S.selected)
              : S.selected;
      try {
        preview = adjustWhitespace(
          S.nodes,
          ids,
          {
            amount: $("#space-amount").value,
            unit: $("#space-unit").value,
            convert: $("#space-convert").checked,
            rotations: S.rotation,
          },
          S.info.pages,
        );
        changes = describeChanges(S.nodes, preview.nodes, {
          op: "whitespace",
          description: `${$("#space-amount").value} ${$("#space-unit").value} = ${preview.delta.toFixed(4)} pt，按视觉方向偏移`,
        });
        $("#space-summary").textContent =
          `范围 ${ids.size} 项 · 修改 ${changes.length} 项 · 跳过 ${preview.skipped.length} 项 · 显示前 100 项`;
        $("#space-diffs").innerHTML = diffTable(changes.slice(0, 100));
        $("#space-item").innerHTML = changes
          .map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`)
          .join("");
        $("#space-skipped").innerHTML = preview.skipped
          .map((n) => `<p>${esc(n.title)}：${esc(n.reason)}</p>`)
          .join("");
        $("#space-apply").disabled = !changes.length;
      } catch (e) {
        preview = null;
        $("#space-summary").textContent = e.message;
        $("#space-apply").disabled = true;
      }
    }
    async function draw(after) {
      task?.cancel();
      const rev = revision,
        n = (after ? preview?.nodes : S.nodes)?.find(
          (n) => n.id === $("#space-item").value,
        );
      if (!n) return;
      const p = await S.pdf.getPage(n.target.page),
        v = p.getViewport({
          scale: 1.2,
          rotation: S.rotation[n.target.page] ?? p.rotate,
        }),
        a = n.target.args,
        pt = v.convertToViewportPoint(
          n.target.mode === "XYZ" ? (a[0] ?? p.view[0]) : p.view[0],
          n.target.mode === "XYZ" ? a[1] : a[0],
        ),
        c = document.createElement("canvas");
      c.width = 800;
      c.height = 230;
      const x = Math.max(0, pt[0] - 30),
        y = Math.max(0, pt[1] - 24);
      task = p.render({
        canvasContext: c.getContext("2d"),
        viewport: v,
        transform: [1, 0, 0, 1, -x, -y],
        background: "white",
      });
      await task.promise;
      if (rev !== revision) return;
      const d = $("#space-preview");
      d.hidden = false;
      d.width = 800;
      d.height = 230;
      const g = d.getContext("2d");
      g.drawImage(c, 0, 0);
      g.strokeStyle = after ? "#5367df" : "#d49431";
      g.beginPath();
      g.moveTo(0, pt[1] - y);
      g.lineTo(800, pt[1] - y);
      g.stroke();
    }
    $("#modal-body").addEventListener("input", update);
    const labelSteps = () =>
      document
        .querySelectorAll("[data-space]")
        .forEach(
          (b) =>
            (b.textContent = `${Number(b.dataset.space) > 0 ? "+" : ""}${b.dataset.space} ${$("#space-unit").value}`),
        );
    labelSteps();
    $("#space-unit").addEventListener("change", labelSteps);
    document.querySelectorAll("[data-space]").forEach(
      (b) =>
        (b.onclick = () => {
          $("#space-amount").value = b.dataset.space;
          update();
        }),
    );
    $("#space-before").onclick = () => guarded(() => draw(false));
    $("#space-after").onclick = () => guarded(() => draw(true));
    setCleanup(() => {
      revision++;
      task?.cancel();
      $("#modal-body").removeEventListener("input", update);
    });
    update();
  }
  function overlay() {
    for (const e of surface.entries.values()) {
      e.shell.querySelector(".ocr-live")?.remove();
      if (!showOCR || !e.viewport) continue;
      const layer = document.createElement("div");
      layer.className = "ocr-live";
      for (const b of ocrPage(S.ocr, e.b.page)) {
        if (b.excluded) continue;
        const q = b.quad.map((p) => e.viewport.convertToViewportPoint(...p)),
          w = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]),
          h = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]),
          el = document.createElement("span");
        el.textContent = b.text;
        el.title = b.text;
        el.style.cssText = `left:${q[0][0]}px;top:${q[0][1]}px;width:${w}px;height:${h}px;font-size:${h * 0.85}px;transform:rotate(${Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0])}rad)`;
        layer.append(el);
      }
      e.shell.append(layer);
    }
  }
  async function objectDialog() {
    if (!S.pdf) return;
    toast("正在读取当前页内容对象…");
    const p = S.page,
      result = await native("inspect", { page: p }),
      objects = result.objects;
    let chosen = null,
      task,
      viewport,
      closed = false,
      applying = false;
    modal(
      "编辑页面内容对象",
      `<p class="callout">直接修改文字、图片和矢量路径。修改文字时使用 Noto Sans SC 衍生字体；复杂裁剪、嵌套与特殊绘制模式只读。坐标为 PDF 原生单位。</p><div class="native-workspace"><div class="native-preview"><canvas id="object-canvas"></canvas><div id="object-boxes"></div></div><div class="native-properties"><label>内容对象<select id="object-select" disabled><option value="">请选择或点击左侧对象</option>${objects.map((o) => `<option value="${o.index}">#${o.index} ${o.type} ${esc((o.text || "").slice(0, 35))}${o.editable ? "" : " · 只读"}</option>`).join("")}</select></label><div class="menu-grid"><button id="object-new-text">新增文字</button><button id="object-new-path">新增矩形路径</button></div><div id="object-fields">选择对象后编辑属性。</div></div></div>`,
      [
        { text: "关闭", run: closeModal },
        {
          text: "应用到文档",
          primary: true,
          id: "object-apply",
          run: async () => {
            if (!chosen || applying) return;
            applying = true;
            try {
              const edit = read();
              let edits = clone(S.nativeEdits || []);
              if (edit.index !== null)
                edits = edits.filter(
                  (e) => e.page !== p || e.index !== edit.index,
                );
              edits.push(edit);
              await refreshNative(edits, S.ocr || []);
              commit(clone(S.nodes), { nativeEdits: edits });
              closeModal();
              toast("已修改实际 PDF 内容，可撤销");
            } finally {
              applying = false;
            }
          },
        },
      ],
    );
    $("#modal").classList.add("native-dialog");
    setCleanup(() => {
      closed = true;
      task?.cancel();
      $("#modal").classList.remove("native-dialog");
    });
    const page = await S.pdf.getPage(p);
    if (closed) return;
    viewport = page.getViewport({
      scale: Math.min(620 / (page.view[2] - page.view[0]), 1.2),
      rotation: surface.rotation(p),
    });
    const c = $("#object-canvas"),
      ratio = Math.min(devicePixelRatio || 1, 2);
    c.width = Math.ceil(viewport.width * ratio);
    c.height = Math.ceil(viewport.height * ratio);
    c.style.width = viewport.width + "px";
    c.style.height = viewport.height + "px";
    task = page.render({
      canvasContext: c.getContext("2d"),
      viewport,
      transform: [ratio, 0, 0, ratio, 0, 0],
    });
    await task.promise;
    if (closed) return;
    function fields(o) {
      const prior = (S.nativeEdits || []).find(
        (e) => o.index !== null && e.page === p && e.index === o.index,
      );
      o = { ...o, ...prior };
      chosen = o;
      $("#object-apply").disabled = !o.editable;
      const hex = (v) =>
        "#" +
        v
          .slice(0, 3)
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("");
      $("#object-fields").innerHTML =
        `${o.editable ? "" : `<p class="callout">${esc(o.reason)}</p>`}<fieldset ${o.editable ? "" : "disabled"}>${o.type === "text" ? `<label>文字<textarea id="obj-text" rows="3">${esc(o.text)}</textarea></label><label>字号（pt）<input id="obj-size" type="number" min="1" max="1000" value="${o.size}"></label><small>使用内置字体，保留未修改内容。复杂文字组保持只读。</small><details><summary>文本框自动换行</summary><label>宽度（pt，0 表示不自动换行）<input id="obj-box-width" type="number" min="0" value="${o.boxWidth || 0}"></label><label>最大高度（pt）<input id="obj-box-height" type="number" min="1" value="${o.boxHeight || 300}"></label><label>行高倍数<input id="obj-line-height" type="number" min="1" max="3" step="0.1" value="${o.lineHeight || 1.4}"></label></details>` : ""}<label>变换矩阵 [a,b,c,d,e,f]<input id="obj-matrix" value="${esc(JSON.stringify(o.matrix))}"></label><div class="form-grid"><label>填充<input id="obj-fill" type="color" value="${hex(o.fill)}"></label><label>描边<input id="obj-stroke" type="color" value="${hex(o.stroke)}"></label></div>${o.type === "path" ? `<label>线宽<input id="obj-width" type="number" min="0" step="0.1" value="${o.width}"></label><label>填充规则<select id="obj-fill-mode"><option value="0">不填充</option><option value="1">奇偶规则</option><option value="2">非零规则</option></select></label><label class="check"><input id="obj-stroked" type="checkbox" ${o.stroked ? "checked" : ""}>绘制描边</label><details><summary>路径节点 JSON（0=直线，1=贝塞尔，2=移动）</summary><textarea id="obj-segments" rows="10">${esc(JSON.stringify(o.segments, null, 2))}</textarea></details>` : ""}<label class="check"><input id="obj-delete" type="checkbox">删除此对象</label></fieldset>`;
      if (o.type === "image") {
        $("#obj-fill").closest(".form-grid").hidden = true;
        const fieldset = $("#object-fields fieldset");
        fieldset.insertAdjacentHTML(
          "afterbegin",
          `<label>替换图片<input id="obj-image-file" type="file" accept="image/png,image/jpeg,image/webp"></label><label>适配<select id="obj-image-fit"><option value="contain">完整显示 · 留边</option><option value="cover">铺满 · 裁边</option><option value="stretch">拉伸</option></select></label><details open><summary>可恢复裁切（百分比）</summary><div class="form-grid">${["左", "上", "右", "下"].map((name, i) => `<label>${name}<input data-image-crop="${i}" type="number" min="0" max="98" value="${o.crop?.[i] || 0}"></label>`).join("")}</div><button id="obj-reset-crop">恢复完整图片</button><p class="hint">仅裁切选中实例的显示区域，工程保留原图。替换默认沿用位置尺寸。</p></details>`,
        );
        $("#obj-image-fit").value = o.imageFit || "contain";
        $("#obj-image-file").onchange = () =>
          guarded(async () => {
            const f = $("#obj-image-file").files[0];
            if (!f) return;
            if (f.size > 32 * 1024 * 1024) throw Error("替换图片限 32 MB");
            const bytes = new Uint8Array(await f.arrayBuffer());
            let raw = "";
            for (let i = 0; i < bytes.length; i += 32768)
              raw += String.fromCharCode(...bytes.subarray(i, i + 32768));
            chosen.imageData = btoa(raw);
          });
        $("#obj-reset-crop").onclick = () =>
          document
            .querySelectorAll("[data-image-crop]")
            .forEach((el) => (el.value = 0));
      }
      if ($("#obj-fill-mode")) $("#obj-fill-mode").value = o.fillMode;
      document
        .querySelectorAll(".object-hit")
        .forEach((el) =>
          el.classList.toggle("selected", +el.dataset.index === chosen.index),
        );
    }
    function read() {
      const rgb = (id, alpha) => {
        const h = $(id).value;
        return [1, 3, 5]
          .map((i) => parseInt(h.slice(i, i + 2), 16))
          .concat(alpha);
      };
      const e = {
        page: p,
        id: chosen.id || crypto.randomUUID(),
        index: chosen.index,
        signature: chosen.signature,
        type: chosen.type,
        matrix: JSON.parse($("#obj-matrix").value),
        fill: rgb("#obj-fill", chosen.fill[3]),
        stroke: rgb("#obj-stroke", chosen.stroke[3]),
        delete: $("#obj-delete").checked,
      };
      if (e.type === "text")
        Object.assign(e, {
          text: $("#obj-text").value,
          size: +$("#obj-size").value,
          boxWidth: +$("#obj-box-width").value,
          boxHeight: +$("#obj-box-height").value,
          lineHeight: +$("#obj-line-height").value,
        });
      if (e.type === "path")
        Object.assign(e, {
          segments: JSON.parse($("#obj-segments").value),
          width: +$("#obj-width").value,
          fillMode: +$("#obj-fill-mode").value,
          stroked: $("#obj-stroked").checked,
        });
      if (e.type === "image")
        Object.assign(e, {
          imageData: chosen.imageData || null,
          imageFit: $("#obj-image-fit").value,
          crop: [...document.querySelectorAll("[data-image-crop]")].map(
            (el) => +el.value,
          ),
        });
      return e;
    }
    for (const o of objects) {
      const [a, b, c, d] = viewport.convertToViewportRectangle(o.bounds),
        el = document.createElement("button");
      el.className = "object-hit";
      el.dataset.index = o.index;
      el.title = `#${o.index} ${o.type} ${o.text || ""}`;
      el.style.cssText = `left:${Math.min(a, c)}px;top:${Math.min(b, d)}px;width:${Math.max(3, Math.abs(c - a))}px;height:${Math.max(3, Math.abs(d - b))}px`;
      el.onclick = () => {
        $("#object-select").value = o.index;
        fields(o);
      };
      $("#object-boxes").append(el);
    }
    $("#object-select").onchange = () => {
      const o = objects.find(
        (x) => String(x.index) === $("#object-select").value,
      );
      if (o) fields(o);
    };
    $("#object-select").disabled = false;
    $("#object-new-text").onclick = () =>
      fields({
        index: null,
        type: "text",
        editable: true,
        id: crypto.randomUUID(),
        text: "新文字",
        size: 14,
        matrix: [
          1,
          0,
          0,
          1,
          72,
          result.size[1] -
            100 -
            (S.nativeEdits || []).filter(
              (e) => e.page === p && e.index === null,
            ).length *
              28,
        ],
        fill: [0, 0, 0, 255],
        stroke: [0, 0, 0, 255],
      });
    $("#object-new-path").onclick = () =>
      fields({
        index: null,
        type: "path",
        editable: true,
        matrix: [1, 0, 0, 1, 0, 0],
        fill: [100, 110, 220, 255],
        stroke: [60, 70, 130, 255],
        width: 1,
        stroked: true,
        fillMode: 0,
        segments: [
          { type: 2, x: 72, y: 100 },
          { type: 0, x: 250, y: 100 },
          { type: 0, x: 250, y: 200 },
          { type: 0, x: 72, y: 200, close: true },
        ],
      });
  }
  const ocrDialog = () => ocrDialogV4(ctx);
  return {
    diffTable,
    whitespaceDialog,
    objectDialog,
    flowDialog: installFlowUI(ctx),
    ocrDialog,
    overlay,
    toggleOCR() {
      showOCR = !showOCR;
      overlay();
      toast(showOCR ? "OCR 原位预览已开启" : "OCR 原位预览已关闭");
    },
  };
}

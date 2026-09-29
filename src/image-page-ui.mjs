import * as pdfjs from "./vendor/pdf.mjs";
import { installImageAdjustments } from "./image-adjustments-ui.mjs";
import { nativeRequest } from "./native-source.mjs";
export function installPageImages(ctx) {
  const { S, surface, guarded, toast, commit, refreshNative, clone } = ctx;
  let active = null,
    opening = false;
  const call = (command, options) =>
    nativeRequest({ command, bytes: S.bytes, ...options });
  async function start() {
    if (active) {
      await active.finish(true);
      return;
    }
    if (opening || !S.pdf) return;
    await S.flowEdit?.finish(true);
    opening = true;
    const source = S.bytes,
      page = S.page;
    try {
      toast("正在读取当前页图片…");
      const result = await call("inspect", { page });
      if (source !== S.bytes) return;
      const objects = result.objects
        .filter((o) => o.type === "image")
        .map((o) => ({
          ...o,
          bounds: o.bounds.map((v, i) => v + (result.pageOrigin?.[i % 2] || 0)),
          matrix: o.matrix.map(
            (v, i) => v + (i >= 4 ? result.pageOrigin?.[i - 4] || 0 : 0),
          ),
        }));
      if (!objects.length) {
        toast("当前页未发现可选择的图片对象");
        return;
      }
      active = create(page, objects, source);
      S.imageEdit = active;
      active.overlay();
    } finally {
      opening = false;
    }
  }
  function create(page, objects, source) {
    let chosen = null,
      editor = null,
      closed = false,
      changed = false,
      applying = false,
      serial = 0,
      renderTask = null,
      previewDoc = null,
      showOriginal = false;
    const bar = document.createElement("aside");
    bar.className = "image-page-panel";
    bar.innerHTML =
      '<header><strong>编辑图像</strong><button id="image-done">完成</button></header><p class="hint">点击页面中的图片，调整结果直接显示在原位置。</p><div class="adjust-tools"><button id="image-apply" disabled>应用调整</button><button id="image-cancel">取消本次调整</button></div><p id="image-selection"></p><div id="image-properties"></div>';
    document.body.append(bar);
    document.body.classList.add("image-edit-mode");
    const layer = document.createElement("div");
    layer.className = "image-page-layer";
    const preview = document.createElement("canvas");
    preview.className = "image-page-composite";
    preview.hidden = true;
    const hits = document.createElement("div");
    hits.className = "image-page-hits";
    layer.append(preview, hits);
    const q = (s) => bar.querySelector(s);
    const check = () => !closed && S.bytes === source;
    const dirty = () => window.desktop?.setDirty?.(S.dirty || changed);
    function edit() {
      return {
        page,
        id: chosen.id || crypto.randomUUID(),
        index: chosen.index,
        signature: chosen.signature,
        type: "image",
        matrix: chosen.matrix,
        fill: chosen.fill,
        stroke: chosen.stroke,
        imageData: chosen.imageData || null,
        imageFit: chosen.imageFit || "contain",
        crop: chosen.crop || [0, 0, 0, 0],
        adjustments: chosen.adjustments || null,
      };
    }
    function edits() {
      return [
        ...clone(S.nativeEdits || []).filter(
          (e) => e.page !== page || e.index !== chosen.index,
        ),
        edit(),
      ];
    }
    async function composite() {
      if (!chosen || !check()) return;
      const rev = ++serial;
      const r = await call("flow-background", {
        page,
        edits: edits(),
        ocr: S.ocr || [],
        ocrReference: S.ocrReference,
      });
      if (!check() || rev !== serial) return;
      const doc = await pdfjs.getDocument({
        data: Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0)),
        isEvalSupported: false,
      }).promise;
      try {
        const p = await doc.getPage(1),
          entry = surface.entries.get(page);
        if (!entry?.viewport || !check() || rev !== serial) return;
        const v = p.getViewport({
            scale: entry.viewport.scale,
            rotation: surface.rotation(page),
          }),
          ratio = Math.min(devicePixelRatio || 1, 2),
          canvas = document.createElement("canvas");
        canvas.width = Math.ceil(v.width * ratio);
        canvas.height = Math.ceil(v.height * ratio);
        renderTask = p.render({
          canvasContext: canvas.getContext("2d"),
          viewport: v,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await renderTask.promise;
        if (!check() || rev !== serial) return;
        preview.width = canvas.width;
        preview.height = canvas.height;
        preview.getContext("2d").drawImage(canvas, 0, 0);
        preview.hidden = showOriginal;
        await previewDoc?.destroy();
        previewDoc = null;
      } finally {
        await doc.destroy();
      }
    }
    async function select(o) {
      if (applying || !check()) return;
      if (chosen?.index === o.index) return;
      if (changed) await apply();
      editor?.dispose();
      serial++;
      preview.hidden = true;
      chosen = {
        ...clone(o),
        ...clone(
          (S.nativeEdits || []).find(
            (e) => e.page === page && e.index === o.index,
          ) || {},
        ),
      };
      q("#image-selection").textContent =
        `第 ${page} 页 · 图片 #${o.index}${o.editable ? "" : " · " + o.reason}`;
      const host = q("#image-properties");
      host.replaceChildren();
      q("#image-apply").disabled = true;
      if (!o.editable) {
        overlay();
        return;
      }
      const crops = document.createElement("details");
      crops.className = "adjust-group";
      crops.innerHTML =
        "<summary>裁剪 / 替换图片</summary>" +
        ["左", "上", "右", "下"]
          .map(
            (name, i) =>
              `<label>${name}（%）<input data-image-crop="${i}" type="number" min="0" max="98" value="${chosen.crop?.[i] || 0}"></label>`,
          )
          .join("") +
        '<button data-crop-reset>恢复裁剪</button><label>替换图片<input data-replace type="file" accept="image/png,image/jpeg,image/webp"></label><label>适配<select data-fit><option value="contain">完整显示</option><option value="cover">铺满裁边</option><option value="stretch">拉伸</option></select></label>';
      host.append(crops);
      function mark() {
        serial++;
        changed = true;
        q("#image-apply").disabled = true;
        dirty();
      }
      editor = installImageAdjustments({
        host,
        chosen,
        request: call,
        page,
        alive: check,
        onChange: mark,
        onCompare: (value) => {
          showOriginal = value;
          preview.hidden = value;
        },
        onPreview: async () => {
          await composite();
          if (check()) q("#image-apply").disabled = !changed;
        },
      });
      crops.querySelectorAll("[data-image-crop]").forEach(
        (e) =>
          (e.oninput = () => {
            chosen.crop = [...crops.querySelectorAll("[data-image-crop]")].map(
              (e) => +e.value,
            );
            mark();
            editor.refresh();
          }),
      );
      crops.querySelector("[data-crop-reset]").onclick = () => {
        crops
          .querySelectorAll("[data-image-crop]")
          .forEach((e) => (e.value = 0));
        chosen.crop = [0, 0, 0, 0];
        mark();
        editor.refresh();
      };
      crops.querySelector("[data-fit]").value = chosen.imageFit || "contain";
      crops.querySelector("[data-fit]").onchange = (e) => {
        chosen.imageFit = e.target.value;
        mark();
        editor.refresh();
      };
      crops.querySelector("[data-replace]").onchange = (e) =>
        guarded(async () => {
          const f = e.target.files[0];
          if (!f) return;
          if (f.size > 32 * 1024 ** 2) throw Error("替换图片限 32 MB");
          const b = new Uint8Array(await f.arrayBuffer());
          let s = "";
          for (let i = 0; i < b.length; i += 32768)
            s += String.fromCharCode(...b.subarray(i, i + 32768));
          chosen.imageData = btoa(s);
          mark();
          editor.refresh();
        });
      overlay();
    }
    function overlay() {
      if (!check()) return;
      const entry = surface.entries.get(page);
      if (!entry?.viewport) return;
      if (layer.parentElement !== entry.shell) entry.shell.append(layer);
      hits.replaceChildren();
      for (const o of objects) {
        const prior = (S.nativeEdits || []).find(
          (e) => e.page === page && e.index === o.index,
        );
        if (prior?.delete) continue;
        const rect = entry.viewport.convertToViewportRectangle(o.bounds),
          button = document.createElement("button");
        button.className =
          "image-page-hit" + (chosen?.index === o.index ? " selected" : "");
        button.dataset.index = o.index;
        button.title = `图片 #${o.index}${o.editable ? "" : " · " + o.reason}`;
        button.setAttribute("aria-label", button.title);
        button.style.cssText = `left:${Math.min(rect[0], rect[2])}px;top:${Math.min(rect[1], rect[3])}px;width:${Math.abs(rect[2] - rect[0])}px;height:${Math.abs(rect[3] - rect[1])}px`;
        button.onclick = () => guarded(() => select(o));
        hits.append(button);
      }
    }
    async function apply() {
      if (!changed || !chosen || applying) return;
      applying = true;
      q("#image-apply").disabled = true;
      try {
        await editor.flush();
        const values = edits();
        await refreshNative(values, S.ocr || []);
        commit(clone(S.nodes), { nativeEdits: values });
        changed = false;
        dirty();
        preview.hidden = true;
        toast("图片调整已应用，可撤销");
      } finally {
        applying = false;
        q("#image-apply").disabled = !changed;
      }
    }
    function destroy() {
      if (closed) return;
      closed = true;
      serial++;
      editor?.dispose();
      renderTask?.cancel();
      previewDoc?.destroy();
      bar.remove();
      layer.remove();
      document.body.classList.remove("image-edit-mode");
      S.imageEdit = null;
      active = null;
      dirty();
    }
    async function finish(save) {
      if (save) await apply();
      changed = false;
      destroy();
    }
    q("#image-apply").onclick = () => guarded(apply);
    q("#image-done").onclick = () => guarded(() => finish(true));
    q("#image-cancel").onclick = () => guarded(() => finish(false));
    return {
      overlay,
      finish,
      flush: apply,
      destroy,
      get editing() {
        return changed;
      },
    };
  }
  return { start, overlay: () => active?.overlay() };
}

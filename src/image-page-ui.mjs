import { transformedBounds } from "./object-selection-model.mjs";
import * as pdfjs from "./vendor/pdf.mjs";
import { installImageAdjustments } from "./image-adjustments-ui.mjs";
import { installCropTools } from "./image-crop-ui.mjs";
import { nativeRequest } from "./native-source.mjs";
export function installPageImages(ctx) {
  const { S, surface, guarded, toast, commit, refreshNative, clone } = ctx;
  let active = null,
    opening = false;
  const call = (command, options) =>
    nativeRequest({ command, bytes: S.bytes, ...options });
  async function start(options = {}) {
    S.objectSelection?.destroy();
    document
      .querySelectorAll(".more-tools[open]")
      .forEach((e) => (e.open = false));
    if (active) {
      await active.finish(true);
      return;
    }
    if (opening || !S.pdf) return;
    await S.flowEdit?.finish(true);
    opening = true;
    const source = S.bytes,
      page = options.page || S.page;
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
      active = create(page, objects, source, options.indices || []);
      S.imageEdit = active;
      active.overlay();
      await active.selectInitial();
    } finally {
      opening = false;
    }
  }
  function create(page, objects, source, indices) {
    let batch = objects.filter((o) => indices.includes(o.index) && o.editable);
    let chosen = null,
      editor = null,
      cropEditor = null,
      closed = false,
      changed = false,
      applying = null,
      serial = 0,
      renderTask = null,
      previewDoc = null,
      showOriginal = false,
      picker = null,
      sample = null,
      sampleSource = null,
      adjustedPreview = null;
    const bar = document.createElement("aside");
    bar.className = "image-page-panel";
    bar.innerHTML =
      '<header><strong>编辑图像</strong><button id="image-done">完成</button></header><div class="image-panel-scroll"><p class="hint">点击页面中的图片，调整结果直接显示在原位置。</p><div class="adjust-tools"><button id="image-apply" disabled>应用调整</button><button id="image-cancel">取消本次调整</button></div><p id="image-selection"></p><div id="image-properties"></div></div><footer class="task-status" role="status"><progress hidden></progress><span id="image-progress">请选择页面中的图片</span></footer>';
    document.body.append(bar);
    document.body.classList.add("image-edit-mode");
    const layer = document.createElement("div");
    layer.className = "image-page-layer";
    const preview = document.createElement("canvas");
    // Owned by the editing session, never by a virtualized PDF page shell.
    const lastFrame = document.createElement("canvas");
    lastFrame.width = lastFrame.height = 0;
    preview.className = "image-page-composite";
    preview.hidden = true;
    const hits = document.createElement("div");
    hits.className = "image-page-hits";
    layer.append(preview, hits);
    const q = (s) => bar.querySelector(s);
    const check = () => !closed && S.bytes === source;
    const dirty = () =>
      window.desktop?.setDirty?.(S.dirty || changed || !!cropEditor?.active);
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
        perspective: chosen.perspective || null,
        adjustments: chosen.adjustments || null,
      };
    }
    function edits() {
      const group = batch.length ? batch : [chosen];
      const values = group.map((o) => {
        if (o.index === chosen.index) return edit();
        const prior = clone(
          (S.nativeEdits || []).find(
            (e) => e.page === page && e.index === o.index,
          ) || {},
        );
        return {
          page,
          id: prior.id || crypto.randomUUID(),
          index: o.index,
          signature: o.signature,
          type: "image",
          matrix: o.matrix,
          ...prior,
          adjustments: clone(chosen.adjustments || null),
        };
      });
      return [
        ...clone(S.nativeEdits || []).filter(
          (e) => e.page !== page || !group.some((o) => o.index === e.index),
        ),
        ...values,
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
        imagePreviews: adjustedPreview
          ? { [chosen.index]: adjustedPreview }
          : {},
      });
      if (!check() || rev !== serial) return;
      const doc = await pdfjs.getDocument({
        data: Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0)),
        isEvalSupported: false,
        cMapUrl: new URL("./vendor/cmaps/", import.meta.url).href,
        cMapPacked: true,
        standardFontDataUrl: new URL(
          "./vendor/standard_fonts/",
          import.meta.url,
        ).href,
        wasmUrl: new URL("./vendor/wasm/", import.meta.url).href,
      }).promise;
      try {
        const p = await doc.getPage(1),
          entry = surface.entries.get(page);
        if (!entry?.viewport || !check() || rev !== serial) return;
        const v = p.getViewport({
            scale: entry.viewport.scale,
            rotation: surface.rotation(page),
          }),
          ratio = Math.min(
            devicePixelRatio || 1,
            2,
            3000 / Math.max(v.width, v.height),
          ),
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
        lastFrame.width = canvas.width;
        lastFrame.height = canvas.height;
        lastFrame.getContext("2d").drawImage(canvas, 0, 0);
        preview.hidden = showOriginal;
        await previewDoc?.destroy();
        previewDoc = null;
      } finally {
        await doc.destroy();
      }
    }
    async function select(o, keepBatch = false) {
      if (applying || !check()) return;
      if (chosen?.index === o.index) return;
      if (changed) await apply();
      if (!keepBatch) batch = [];
      editor?.dispose();
      cropEditor?.dispose();
      serial++;
      preview.hidden = true;
      picker = null;
      sample = null;
      sampleSource = null;
      adjustedPreview = null;
      lastFrame.width = lastFrame.height = 0;
      showOriginal = false;
      chosen = {
        ...clone(o),
        ...clone(
          (S.nativeEdits || []).find(
            (e) => e.page === page && e.index === o.index,
          ) || {},
        ),
      };
      q("#image-selection").textContent =
        `第 ${page} 页 · ${batch.length > 1 ? "批量调整 " + batch.length + " 张图片 · 参考" : ""}图片 #${o.index}${o.editable ? "" : " · " + o.reason}`;
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
      crops.hidden = batch.length > 1;
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
        onStatus: (message, busy) => {
          if (applying) return;
          q("#image-progress").textContent = message;
          q("footer progress").hidden = !busy;
        },
        onPick: (mode, callback) => {
          picker = { mode, callback };
          layer.classList.add("picking");
          toast("点击当前图片取样：" + mode);
        },
        onCompare: (value) => {
          showOriginal = value;
          preview.hidden = value;
        },
        onPreview: async (r) => {
          if (sampleSource !== r.original) {
            const image = new Image();
            image.src = "data:image/png;base64," + r.original;
            await image.decode();
            sample = document.createElement("canvas");
            sample.width = image.width;
            sample.height = image.height;
            sample.getContext("2d").drawImage(image, 0, 0);
            sampleSource = r.original;
          }
          adjustedPreview = r.preview;
          await composite();
          if (check()) q("#image-apply").disabled = !changed;
        },
      });
      if (batch.length <= 1)
        cropEditor = installCropTools({
          host: crops,
          layer,
          chosen,
          viewport: () => surface.entries.get(page)?.viewport,
          changed: mark,
          onActiveChange: dirty,
          refresh: () => editor.refresh(),
          toast,
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
        chosen.perspective = null;
        cropEditor?.draw();
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
    function sampleAt(event, entry) {
      const rect = entry.shell.getBoundingClientRect(),
        [px, py] = entry.viewport.convertToPdfPoint(
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      const [a, b, c, d, e, f] = chosen.matrix,
        det = a * d - b * c;
      if (Math.abs(det) < 1e-12) throw Error("图片变换不可逆");
      let u = (d * (px - e) - c * (py - f)) / det,
        v = 1 - (-b * (px - e) + a * (py - f)) / det;
      if (chosen.imageData && chosen.imageFit !== "stretch") {
        const w = Math.hypot(a, b),
          h = Math.hypot(c, d),
          scale = (chosen.imageFit === "cover" ? Math.max : Math.min)(
            w / sample.width,
            h / sample.height,
          ),
          sx = (sample.width * scale) / w,
          sy = (sample.height * scale) / h;
        u = (u - (1 - sx) / 2) / sx;
        v = (v - (1 - sy) / 2) / sy;
      }
      if (u < 0 || u > 1 || v < 0 || v > 1)
        throw Error("请点击图片有效像素区域");
      const rgb = sample
        .getContext("2d")
        .getImageData(
          Math.min(sample.width - 1, Math.floor(u * sample.width)),
          Math.min(sample.height - 1, Math.floor(v * sample.height)),
          1,
          1,
        ).data;
      if (rgb[3] < 128) throw Error("请在不透明区域取样");
      return Array.from(rgb).slice(0, 3);
    }
    function overlay() {
      if (!check()) return;
      const entry = surface.entries.get(page);
      if (!entry?.viewport) return;
      if (layer.parentElement !== entry.shell) {
        entry.shell.append(layer);
        if (lastFrame.width && chosen) {
          preview.width = lastFrame.width;
          preview.height = lastFrame.height;
          preview.getContext("2d").drawImage(lastFrame, 0, 0);
          preview.hidden = showOriginal;
        }
      }
      hits.replaceChildren();
      for (const o of objects) {
        const prior = (S.nativeEdits || []).find(
          (e) => e.page === page && e.index === o.index,
        );
        if (prior?.delete) continue;
        const rect = entry.viewport.convertToViewportRectangle(
            transformedBounds(o, prior),
          ),
          button = document.createElement("button");
        button.className =
          "image-page-hit" +
          (chosen?.index === o.index || batch.some((x) => x.index === o.index)
            ? " selected"
            : "");
        button.dataset.index = o.index;
        button.title = `图片 #${o.index}${o.editable ? "" : " · " + o.reason}`;
        button.setAttribute("aria-label", button.title);
        button.style.cssText = `left:${Math.min(rect[0], rect[2])}px;top:${Math.min(rect[1], rect[3])}px;width:${Math.abs(rect[2] - rect[0])}px;height:${Math.abs(rect[3] - rect[1])}px`;
        let targetDrag = null,
          targetClick = false;
        button.onpointerdown = (event) => {
          if (picker?.mode !== "curve" || !sample || chosen?.index !== o.index)
            return;
          guarded(async () => {
            const rgb = sampleAt(event, entry);
            targetDrag = { rgb, callback: picker.callback, y: event.clientY };
            targetClick = true;
            targetDrag.callback(rgb, 0);
            button.setPointerCapture(event.pointerId);
          });
        };
        button.onpointermove = (event) => {
          if (!targetDrag) return;
          const delta = Math.round(targetDrag.y - event.clientY);
          if (delta) {
            targetDrag.callback(targetDrag.rgb, delta);
            targetDrag.y = event.clientY;
          }
        };
        button.onpointerup = button.onpointercancel = (event) => {
          if (!targetDrag) return;
          targetDrag = null;
          picker = null;
          layer.classList.remove("picking");
          if (button.hasPointerCapture(event.pointerId))
            button.releasePointerCapture(event.pointerId);
        };
        button.onclick = (event) =>
          guarded(async () => {
            if (targetClick) {
              targetClick = false;
              return;
            }
            if (picker && sample && chosen?.index === o.index) {
              const rgb = sampleAt(event, entry);
              const callback = picker.callback;
              picker = null;
              layer.classList.remove("picking");
              callback(rgb);
            } else await select(o);
          });
        hits.append(button);
      }
      cropEditor?.draw();
    }
    async function apply() {
      if (applying) return applying;
      if (cropEditor?.active) cropEditor.confirm();
      if (!changed || !chosen) return;
      q("#image-apply").disabled = true;
      q("#image-done").disabled = true;
      q("#image-cancel").disabled = true;
      q("#image-properties").inert = true;
      q("#image-progress").textContent =
        `正在应用 ${batch.length || 1} 张图片的调整…`;
      q("footer progress").hidden = false;
      applying = (async () => {
        try {
          await editor.flush();
          const values = edits();
          await refreshNative(values, S.ocr || []);
          commit(clone(S.nodes), { nativeEdits: values });
          changed = false;
          dirty();
          preview.hidden = true;
          lastFrame.width = lastFrame.height = 0;
          q("#image-progress").textContent =
            `已完成 ${batch.length || 1} 张图片 · 可整批撤销`;
          toast("图片调整已应用，可撤销");
        } catch (e) {
          q("#image-progress").textContent = "应用失败：" + e.message;
          throw e;
        } finally {
          applying = null;
          q("footer progress").hidden = true;
          if (!closed) {
            q("#image-apply").disabled = !changed;
            q("#image-done").disabled = false;
            q("#image-cancel").disabled = false;
            q("#image-properties").inert = false;
          }
        }
      })();
      return applying;
    }
    function destroy() {
      if (closed) return;
      closed = true;
      serial++;
      editor?.dispose();
      cropEditor?.dispose();
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
      selectInitial: () =>
        batch.length ? select(batch[0], true) : Promise.resolve(),
      finish,
      flush: apply,
      destroy,
      get editing() {
        return changed || !!cropEditor?.active;
      },
    };
  }
  return { start, overlay: () => active?.overlay() };
}

// Source pixels remain in the native worker; the UI only receives a bounded preview.
export function installImageAdjustments({
  host,
  chosen,
  request,
  page,
  alive,
}) {
  const defaults = {
    brightness: 0,
    contrast: 0,
    black: 0,
    white: 255,
    gamma: 1,
    blur: 0,
    sharpen: 0,
    preset: "none",
    curves: [
      [0, 0],
      [255, 255],
    ],
  };
  let state = structuredClone(chosen.adjustments || defaults),
    timer,
    revision = 0,
    disposed = false,
    running = false,
    pending = false,
    selected = 0,
    histogram = [],
    original = "";
  const root = document.createElement("section");
  root.className = "image-adjustments";
  root.innerHTML = `<h3>图像调整</h3><label>扫描增强<select data-preset><option value="none">自定义 / 原图</option><option value="scan-color">扫描件 · 保留颜色</option><option value="scan-gray">扫描件 · 灰度清晰</option></select></label><div class="image-preview-wrap"><img class="image-adjusted-preview" alt="图像调整预览"></div><label class="check"><input type="checkbox" data-original>显示原图对照</label><p class="hint" data-status role="status"></p><div class="form-grid">${[
    ["brightness", "亮度", -100, 100, 1],
    ["contrast", "对比度", -100, 100, 1],
    ["black", "黑场", 0, 254, 1],
    ["white", "白场", 1, 255, 1],
    ["gamma", "中间调", 0.1, 10, 0.05],
    ["blur", "高斯模糊（像素）", 0, 30, 0.1],
    ["sharpen", "锐化（%）", 0, 300, 5],
  ]
    .map(
      ([key, label, min, max, step]) =>
        `<label>${label}<input data-adjust="${key}" aria-label="${label}" type="number" min="${min}" max="${max}" step="${step}"></label>`,
    )
    .join(
      "",
    )}</div><strong>直方图与 RGB 曲线</strong><canvas data-curve width="256" height="180" tabindex="0" aria-label="RGB 曲线，点击添加或拖动控制点"></canvas><div class="form-grid"><label>输入<input data-curve-x type="number" min="0" max="255" step="1"></label><label>输出<input data-curve-y type="number" min="0" max="255" step="1"></label></div><button data-remove-point>删除控制点</button><button data-reset>恢复原图参数</button><p class="hint">曲线控制点之间线性插值。调整预览使用原始像素计算；应用后可撤销。扫描增强不做二值化，请检查小数点、负号与细表线。</p>`;
  host.prepend(root);
  const $ = (s) => root.querySelector(s),
    canvas = $("[data-curve]"),
    g = canvas.getContext("2d"),
    status = $("[data-status]"),
    img = $("img");
  let latest = "";
  function renderImage() {
    img.src =
      "data:image/png;base64," +
      ($("[data-original]").checked ? original : latest);
    const crop = [...host.querySelectorAll("[data-image-crop]")].map(
      (e) => +e.value || 0,
    );
    img.style.clipPath =
      crop.length === 4
        ? `inset(${crop[1]}% ${crop[2]}% ${crop[3]}% ${crop[0]}%)`
        : "";
  }
  host
    .querySelectorAll("[data-image-crop]")
    .forEach((e) => e.addEventListener("input", renderImage));
  function draw() {
    g.clearRect(0, 0, 256, 180);
    g.fillStyle = getComputedStyle(root).getPropertyValue("--panel") || "#fff";
    g.fillRect(0, 0, 256, 180);
    const max = Math.max(1, ...histogram);
    g.fillStyle = "#7d8fa366";
    histogram.forEach((n, i) =>
      g.fillRect(i, 180 - (n / max) * 170, 1, (n / max) * 170),
    );
    g.strokeStyle = "#8694a3";
    g.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      g.beginPath();
      g.moveTo(i * 64, 0);
      g.lineTo(i * 64, 180);
      g.moveTo(0, i * 45);
      g.lineTo(256, i * 45);
      g.stroke();
    }
    g.strokeStyle =
      getComputedStyle(root).getPropertyValue("--accent") || "#5267db";
    g.lineWidth = 2;
    g.beginPath();
    state.curves.forEach(([x, y], i) =>
      g[i ? "lineTo" : "moveTo"](x, 180 - (y / 255) * 180),
    );
    g.stroke();
    state.curves.forEach(([x, y], i) => {
      g.beginPath();
      g.arc(x, 180 - (y / 255) * 180, i === selected ? 5 : 3, 0, Math.PI * 2);
      g.fillStyle = i === selected ? "#da8620" : g.strokeStyle;
      g.fill();
    });
    $("[data-curve-x]").value = state.curves[selected][0];
    $("[data-curve-y]").value = state.curves[selected][1];
    $("[data-curve-x]").disabled =
      selected === 0 || selected === state.curves.length - 1;
    $("[data-remove-point]").disabled = $("[data-curve-x]").disabled;
  }
  function fields() {
    root
      .querySelectorAll("[data-adjust]")
      .forEach((e) => (e.value = state[e.dataset.adjust]));
    $("[data-preset]").value = state.preset;
    draw();
  }
  async function preview() {
    if (disposed || !alive()) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    pending = false;
    const rev = revision;
    status.textContent = "正在计算图像预览…";
    try {
      const r = await request("image-preview", {
        page,
        index: chosen.index,
        imageData: chosen.imageData || null,
        adjustments: structuredClone(state),
      });
      if (disposed || !alive() || rev !== revision) return;
      original = r.original;
      latest = r.preview;
      histogram = r.histogram;
      renderImage();
      draw();
      status.textContent = `${r.width} × ${r.height} 像素 · 预览已更新`;
    } catch (e) {
      if (!disposed && alive() && rev === revision)
        status.textContent = e.message;
    } finally {
      running = false;
      if (pending && !disposed) preview();
    }
  }
  function changed() {
    chosen.adjustments = structuredClone(state);
    revision++;
    clearTimeout(timer);
    timer = setTimeout(preview, 220);
  }
  root.querySelectorAll("[data-adjust]").forEach(
    (e) =>
      (e.oninput = () => {
        state[e.dataset.adjust] = Number(e.value);
        changed();
      }),
  );
  $("[data-preset]").onchange = (e) => {
    state.preset = e.target.value;
    changed();
  };
  $("[data-original]").onchange = renderImage;
  $("[data-reset]").onclick = () => {
    state = structuredClone(defaults);
    selected = 0;
    chosen.adjustments = null;
    fields();
    revision++;
    clearTimeout(timer);
    timer = setTimeout(preview, 0);
  };
  $("[data-remove-point]").onclick = () => {
    if (selected > 0 && selected < state.curves.length - 1) {
      state.curves.splice(selected, 1);
      selected = 0;
      draw();
      changed();
    }
  };
  function updatePoint(x, y) {
    const end = state.curves.length - 1;
    state.curves[selected] = [
      selected === 0
        ? 0
        : selected === end
          ? 255
          : Math.max(
              state.curves[selected - 1][0] + 1,
              Math.min(state.curves[selected + 1][0] - 1, Math.round(x)),
            ),
      Math.max(0, Math.min(255, Math.round(y))),
    ];
    draw();
    changed();
  }
  $("[data-curve-x]").onchange = () =>
    updatePoint(+$("[data-curve-x]").value, state.curves[selected][1]);
  $("[data-curve-y]").onchange = () =>
    updatePoint(state.curves[selected][0], +$("[data-curve-y]").value);
  function point(e) {
    const r = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(255, ((e.clientX - r.left) / r.width) * 255)),
      Math.max(0, Math.min(255, 255 - ((e.clientY - r.top) / r.height) * 255)),
    ];
  }
  canvas.onpointerdown = (e) => {
    const [x, y] = point(e);
    selected = state.curves.findIndex(
      (p) => Math.hypot(p[0] - x, p[1] - y) < 16,
    );
    if (selected < 0) {
      if (state.curves.length >= 16) return;
      const xx = Math.max(1, Math.min(254, Math.round(x)));
      if (state.curves.some((p) => p[0] === xx)) return;
      state.curves.push([xx, Math.round(y)]);
      state.curves.sort((a, b) => a[0] - b[0]);
      selected = state.curves.findIndex((p) => p[0] === xx);
      changed();
    }
    canvas.setPointerCapture(e.pointerId);
    canvas.focus();
    draw();
  };
  canvas.onpointermove = (e) => {
    if (canvas.hasPointerCapture(e.pointerId)) updatePoint(...point(e));
  };
  canvas.onpointerup = canvas.onpointercancel = (e) => {
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
  };
  canvas.onkeydown = (e) => {
    const n = e.shiftKey ? 10 : 1;
    const d = {
      ArrowLeft: [-n, 0],
      ArrowRight: [n, 0],
      ArrowUp: [0, n],
      ArrowDown: [0, -n],
    }[e.key];
    if (d) {
      e.preventDefault();
      const p = state.curves[selected];
      updatePoint(p[0] + d[0], p[1] + d[1]);
    }
  };
  fields();
  preview();
  return {
    dispose() {
      disposed = true;
      revision++;
      clearTimeout(timer);
    },
    refresh: changed,
  };
}

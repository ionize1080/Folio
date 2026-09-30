import { installLevelsHandles } from "./levels-handles.mjs";
import { installVisualSliders } from "./adjustment-sliders.mjs";
import {
  IDENTITY,
  curveLUT,
  parseCube,
  controls,
} from "./image-color-model.mjs";
// Source pixels remain in the native worker; the UI only receives a bounded preview.
export function installImageAdjustments({
  host,
  chosen,
  request,
  page,
  alive,
  onPreview,
  onPick,
  onChange = () => {},
  onStatus = () => {},
  onCompare = () => {},
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
    interpolation: "smooth",
    channelCurves: {},
    curveTables: {},
    levels: {},
    curves: [
      [0, 0],
      [255, 255],
    ],
  };
  let state = {
      ...structuredClone(defaults),
      ...structuredClone(chosen.adjustments || {}),
    },
    timer,
    revision = 0,
    renderedRevision = -1,
    disposed = false,
    running = false,
    pending = false,
    selected = 0,
    histogram = [],
    original = "",
    histograms = {},
    channel = "rgb",
    curveMode = "point",
    pencilLast = null,
    gridDivisions = 4;
  const root = document.createElement("section");
  root.className = "image-adjustments";
  const numeric = ([key, label, min, max, step, value]) =>
    `<label class="adjust-row"><span>${label}</span><input data-slider="${key}" aria-label="${label}滑块" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><input data-adjust="${key}" aria-label="${label}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
  const group = (id, label, html, open = false) =>
    `<details class="adjust-group" id="adj-${id}" ${open ? "open" : ""}><summary>${label}</summary>${html}</details>`;
  const channels = `<option value="rgb">RGB</option><option value="r">红</option><option value="g">绿</option><option value="b">蓝</option>`;
  root.innerHTML = `<h3>图像调整</h3><label>预设<select data-preset><option value="none">自定义 / 原图</option><option value="scan-color">扫描件 · 保留颜色</option><option value="scan-gray">扫描件 · 灰度清晰</option></select></label><div class="image-preview-wrap" ${onPreview ? "hidden" : ""}><img class="image-adjusted-preview" alt="图像调整预览"></div><label class="check"><input type="checkbox" data-original>显示调整前对照</label><p class="hint" data-status role="status"></p><label>调整项目<select data-jump><option value="">选择调整工具…</option></select></label>`;
  root.innerHTML += group(
    "curves",
    "曲线",
    `<div class="adjust-tools"><select data-channel aria-label="曲线通道">${channels}</select><select data-interpolation aria-label="曲线插值"><option value="smooth">平滑曲线</option><option value="linear">线性</option></select><button data-auto>自动</button></div><div class="adjust-tools"><select data-curve-mode aria-label="曲线模式"><option value="point">点曲线</option><option value="pencil">铅笔绘制</option></select><button data-curve-smooth>平滑</button><button data-curve-grid>细网格</button><button data-curve-target>图上调整</button></div><canvas data-curve width="512" height="512" tabindex="0" aria-label="RGB 曲线，点击添加或拖动控制点"></canvas><div class="form-grid"><label>输入<input data-curve-x type="number" min="0" max="255" step="1"></label><label>输出<input data-curve-y type="number" min="0" max="255" step="1"></label></div><div class="adjust-tools"><button data-remove-point>删除控制点</button><button data-curve-reset>重置此通道</button></div>`,
    true,
  );
  root.innerHTML += group(
    "levels",
    "色阶",
    `<select data-level-channel aria-label="色阶通道">${channels}</select><canvas data-histogram width="512" height="220" aria-label="输入直方图"></canvas>${[
      ["black", "输入黑场", 0, 254, 1, 0],
      ["gamma", "输入中间调", 0.1, 10, 0.05, 1],
      ["white", "输入白场", 1, 255, 1, 255],
      ["outputBlack", "输出黑场", 0, 255, 1, 0],
      ["outputWhite", "输出白场", 0, 255, 1, 255],
    ]
      .map(numeric)
      .join("")}<button data-level-auto>自动色阶</button>`,
  );
  for (const [id, label, fields] of controls)
    root.innerHTML += group(
      id,
      label,
      fields.map(numeric).join(""),
      id === "light",
    );
  root.innerHTML += group(
    "balance",
    "色彩平衡",
    `<select data-balance-tone><option value="shadows">阴影</option><option value="midtones" selected>中间调</option><option value="highlights">高光</option></select>${["青 ↔ 红", "洋红 ↔ 绿", "黄 ↔ 蓝"].map((x, i) => `<label>${x}<input data-balance="${i}" type="number" min="-100" max="100" value="0"></label>`).join("")}`,
  );
  root.innerHTML += group(
    "bw",
    "黑白",
    `<label class="check"><input data-flag="blackWhite" type="checkbox">启用黑白</label>${["红", "黄", "绿", "青", "蓝", "洋红"].map((x, i) => `<label>${x}<input data-bw="${i}" type="number" min="-200" max="300" value="${[40, 60, 40, 60, 20, 80][i]}"></label>`).join("")}`,
  );
  root.innerHTML += group(
    "mixer",
    "通道混合器",
    `<select data-mixer-channel><option value="0">输出红</option><option value="1">输出绿</option><option value="2">输出蓝</option></select>${["红（%）", "绿（%）", "蓝（%）", "常数（%）"].map((x, i) => `<label>${x}<input data-mixer="${i}" type="number" min="-200" max="200" value="${i === 0 ? 100 : 0}"></label>`).join("")}<label class="check"><input data-flag="monochrome" type="checkbox">单色（使用输出红通道）</label>`,
  );
  root.innerHTML += group(
    "lookup",
    "颜色查找",
    `<select data-lookup><option value="none">无</option><option value="warm">暖色</option><option value="cool">冷色</option><option value="cinema">电影色调</option><option value="cube">自定义 3D LUT</option></select><label>导入 .cube<input data-cube type="file" accept=".cube"></label>${numeric(["lutAmount", "强度（%）", 0, 100, 1, 100])}`,
  );
  root.innerHTML += group(
    "selective",
    "可选颜色",
    `<select data-selective-tone>${["reds", "yellows", "greens", "cyans", "blues", "magentas", "whites", "neutrals", "blacks"].map((v, i) => `<option value="${v}">${["红", "黄", "绿", "青", "蓝", "洋红", "白", "中性色", "黑"][i]}</option>`).join("")}</select>${["青", "洋红", "黄", "黑"].map((x, i) => `<label>${x}（%）<input data-selective="${i}" type="number" min="-100" max="100" value="0"></label>`).join("")}<label class="check"><input data-flag="selectiveAbsolute" type="checkbox">绝对（默认相对）</label>`,
  );
  root.innerHTML += group(
    "invert",
    "反相",
    `<label class="check"><input data-flag="invert" type="checkbox">启用反相</label>`,
  );
  root.innerHTML += group(
    "gradient",
    "渐变映射",
    `<label class="check"><input data-flag="gradientEnabled" type="checkbox">启用渐变映射</label><div data-stops></div><button data-add-stop>添加色标</button>`,
  );
  root.innerHTML += `<div class="adjust-tools"><button data-reset>恢复原图参数</button><button data-save-preset>保存预设</button><label class="button">载入预设<input data-load-preset type="file" accept="application/json,.json"></label></div><p class="hint">源像素计算，应用后可撤销。RGB 调整会转换为 8 位 RGB；算法为 Folio 实现。扫描增强请检查小数点、负号与细表线。</p>`;
  host.prepend(root);
  const $ = (s) => root.querySelector(s),
    canvas = $("[data-curve]"),
    g = canvas.getContext("2d"),
    status = $("[data-status]"),
    img = $("img");
  let latest = "",
    visualSliders,
    levelHandles;
  const statusObserver = new MutationObserver(() =>
    onStatus(status.textContent, /正在|等待/.test(status.textContent)),
  );
  statusObserver.observe(status, {
    childList: true,
    characterData: true,
    subtree: true,
  });
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
  function points() {
    return channel === "rgb"
      ? state.curves
      : (state.channelCurves[channel] ||= structuredClone(IDENTITY));
  }
  function draw() {
    const width = Math.max(256, canvas.getBoundingClientRect().width),
      ratio = devicePixelRatio || 1;
    canvas.width = Math.ceil(width * ratio);
    canvas.height = canvas.width;
    g.setTransform(canvas.width / 256, 0, 0, canvas.height / 256, 0, 0);
    const histogram =
      channel === "rgb" ? histograms.rgb || [] : histograms[channel] || [];
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = getComputedStyle(root).getPropertyValue("--panel") || "#fff";
    g.fillRect(0, 0, 256, 256);
    const max = Math.max(1, ...histogram);
    g.fillStyle = "#7d8fa366";
    histogram.forEach((n, i) =>
      g.fillRect(i, 256 - (n / max) * 246, 1, (n / max) * 246),
    );
    g.strokeStyle = "#8694a3";
    g.lineWidth = 0.5;
    for (let i = 0; i <= gridDivisions; i++) {
      g.beginPath();
      g.moveTo((i * 256) / gridDivisions, 0);
      g.lineTo((i * 256) / gridDivisions, 256);
      g.moveTo(0, (i * 256) / gridDivisions);
      g.lineTo(256, (i * 256) / gridDivisions);
      g.stroke();
    }
    g.strokeStyle = "#8995a6";
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(0, 256);
    g.lineTo(256, 0);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle =
      { r: "#e86065", g: "#5bb87a", b: "#699bed" }[channel] ||
      getComputedStyle(root).getPropertyValue("--accent") ||
      "#5267db";
    g.lineWidth = 2;
    g.beginPath();
    (
      state.curveTables[channel] ||
      curveLUT(points(), state.interpolation === "smooth")
    ).forEach((y, x) => g[x ? "lineTo" : "moveTo"](x, 256 - (y / 255) * 256));
    g.stroke();
    if (!state.curveTables[channel])
      points().forEach(([x, y], i) => {
        g.beginPath();
        g.arc(x, 256 - (y / 255) * 256, i === selected ? 5 : 3, 0, Math.PI * 2);
        g.fillStyle = i === selected ? "#da8620" : g.strokeStyle;
        g.fill();
      });
    $("[data-curve-x]").value = points()[selected][0];
    $("[data-curve-y]").value = points()[selected][1];
    $("[data-curve-x]").disabled = $("[data-curve-y]").disabled =
      !!state.curveTables[channel];
    $("[data-remove-point]").disabled =
      !!state.curveTables[channel] ||
      selected === 0 ||
      selected === points().length - 1;
    $("[data-curve-mode]").value = curveMode;
    root.querySelectorAll("[data-curve-endpoint]").forEach((b) => {
      const value =
        points()[+b.dataset.curveEndpoint ? points().length - 1 : 0][0];
      b.style.left = (value / 255) * 100 + "%";
      b.title = "输入：" + value;
    });
  }
  function fields() {
    root.querySelectorAll("[data-adjust]").forEach((e) => {
      const key = e.dataset.adjust;
      e.value = state[key] ?? e.defaultValue;
      const slider = root.querySelector(`[data-slider="${key}"]`);
      if (slider) slider.value = e.value;
    });
    $("[data-preset]").value = state.preset;
    extraFields();
    draw();
    visualSliders?.sync();
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
      histograms = { rgb: r.histogram, ...r.histograms };
      if (onPreview) await onPreview(r, structuredClone(state), rev);
      if (disposed || !alive() || rev !== revision) return;
      renderImage();
      draw();
      drawHistogram();
      renderedRevision = rev;
      status.textContent = `${r.width} × ${r.height} 像素 · 预览已更新${r.proxy ? "（快速预览，应用保留原分辨率）" : ""}`;
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
    status.textContent = "等待更新预览…";
    onChange();
    clearTimeout(timer);
    timer = setTimeout(preview, 180);
  }
  root.querySelectorAll("[data-adjust]").forEach(
    (e) =>
      (e.oninput = () => {
        const key = e.dataset.adjust;
        if (
          levelKeys.includes(key) &&
          $("[data-level-channel]").value !== "rgb"
        ) {
          const c = $("[data-level-channel]").value;
          (state.levels[c] ||= [0, 1, 255, 0, 255])[levelKeys.indexOf(key)] =
            Number(e.value);
        } else state[key] = Number(e.value);
        const slider = root.querySelector(`[data-slider="${key}"]`);
        if (slider) slider.value = e.value;
        if (levelKeys.includes(key)) levelHandles?.sync();
        changed();
      }),
  );
  $("[data-preset]").onchange = (e) => {
    state.preset = e.target.value;
    changed();
  };
  $("[data-original]").onchange = () => {
    renderImage();
    onCompare($("[data-original]").checked);
  };
  $("[data-reset]").onclick = () => {
    state = structuredClone(defaults);
    selected = 0;
    channel = "rgb";
    $("[data-channel]").value = "rgb";
    chosen.adjustments = null;
    onChange();
    fields();
    revision++;
    clearTimeout(timer);
    timer = setTimeout(preview, 0);
  };
  $("[data-remove-point]").onclick = () => {
    if (selected > 0 && selected < points().length - 1) {
      points().splice(selected, 1);
      selected = 0;
      draw();
      changed();
    }
  };
  function updatePoint(x, y) {
    const end = points().length - 1;
    points()[selected] = [
      Math.max(
        selected ? points()[selected - 1][0] + 1 : 0,
        Math.min(
          selected < end ? points()[selected + 1][0] - 1 : 255,
          Math.round(x),
        ),
      ),
      Math.max(0, Math.min(255, Math.round(y))),
    ];
    draw();
    changed();
  }
  $("[data-curve-x]").onchange = () =>
    updatePoint(+$("[data-curve-x]").value, points()[selected][1]);
  $("[data-curve-y]").onchange = () =>
    updatePoint(points()[selected][0], +$("[data-curve-y]").value);
  function point(e) {
    const r = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(255, ((e.clientX - r.left) / r.width) * 255)),
      Math.max(0, Math.min(255, 255 - ((e.clientY - r.top) / r.height) * 255)),
    ];
  }
  function pencil(x, y) {
    const table = (state.curveTables[channel] ||= curveLUT(
      points(),
      state.interpolation === "smooth",
    ).map(Math.round));
    x = Math.round(x);
    y = Math.round(y);
    const [lx, ly] = pencilLast || [x, y];
    for (let i = Math.min(lx, x); i <= Math.max(lx, x); i++)
      table[i] = Math.round(
        lx === x ? y : ly + ((y - ly) * (i - lx)) / (x - lx),
      );
    pencilLast = [x, y];
    draw();
    changed();
  }
  canvas.onpointerdown = (e) => {
    e.preventDefault();
    const [x, y] = point(e);
    if (curveMode === "pencil") {
      pencilLast = null;
      pencil(x, y);
      canvas.setPointerCapture(e.pointerId);
      canvas.focus();
      return;
    }
    selected = points().findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < 16);
    if (
      selected > 0 &&
      selected < points().length - 1 &&
      (e.ctrlKey || e.metaKey)
    ) {
      $("[data-remove-point]").click();
      return;
    }
    if (selected < 0) {
      if (points().length >= 16) {
        selected = points().reduce(
          (best, p, i) =>
            Math.hypot(p[0] - x, p[1] - y) <
            Math.hypot(points()[best][0] - x, points()[best][1] - y)
              ? i
              : best,
          0,
        );
        draw();
        return;
      }
      const xx = Math.max(1, Math.min(254, Math.round(x)));
      if (points().some((p) => p[0] === xx)) return;
      points().push([xx, Math.round(y)]);
      points().sort((a, b) => a[0] - b[0]);
      selected = points().findIndex((p) => p[0] === xx);
      changed();
    }
    canvas.setPointerCapture(e.pointerId);
    canvas.focus();
    draw();
  };
  canvas.onpointermove = (e) => {
    if (canvas.hasPointerCapture(e.pointerId)) {
      if (curveMode === "pencil") pencil(...point(e));
      else updatePoint(...point(e));
    }
  };
  canvas.onpointerup = canvas.onpointercancel = (e) => {
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
  };
  canvas.onkeydown = (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      $("[data-remove-point]").click();
      return;
    }
    if (["+", "=", "-"].includes(e.key)) {
      e.preventDefault();
      selected =
        (selected + (e.key === "-" ? points().length - 1 : 1)) %
        points().length;
      draw();
      return;
    }
    if (curveMode === "pencil") return;
    const n = e.shiftKey ? 10 : 1;
    const d = {
      ArrowLeft: [-n, 0],
      ArrowRight: [n, 0],
      ArrowUp: [0, n],
      ArrowDown: [0, -n],
    }[e.key];
    if (d) {
      e.preventDefault();
      const p = points()[selected];
      updatePoint(p[0] + d[0], p[1] + d[1]);
    }
  };
  const levelKeys = ["black", "gamma", "white", "outputBlack", "outputWhite"];
  function drawHistogram() {
    const c = $("[data-histogram]"),
      w = Math.max(256, c.getBoundingClientRect().width),
      d = devicePixelRatio || 1;
    c.width = w * d;
    c.height = 110 * d;
    const g = c.getContext("2d");
    g.scale((w * d) / 256, d);
    const ch = $("[data-level-channel]").value,
      h = histograms[ch] || [],
      max = Math.max(1, ...h);
    g.fillStyle = "#8394a6";
    h.forEach((v, i) => g.fillRect(i, 100 - (v / max) * 95, 1, (v / max) * 95));
    const grad = g.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, "#000");
    grad.addColorStop(1, "#fff");
    g.fillStyle = grad;
    g.fillRect(0, 102, 256, 8);
  }
  function levelFields() {
    const ch = $("[data-level-channel]").value,
      values =
        ch === "rgb"
          ? levelKeys.map((k, i) => state[k] ?? [0, 1, 255, 0, 255][i])
          : state.levels[ch] || [0, 1, 255, 0, 255];
    levelKeys.forEach((k, i) => {
      $(`[data-adjust="${k}"]`).value = values[i];
      $(`[data-slider="${k}"]`).value = values[i];
    });
    drawHistogram();
    levelHandles?.sync();
  }
  function extraFields() {
    $("[data-interpolation]").value = state.interpolation;
    root
      .querySelectorAll("[data-flag]")
      .forEach(
        (e) =>
          (e.checked =
            state[e.dataset.flag] ?? e.dataset.flag === "photoLuminosity"),
      );
    $("[data-lookup]").value = state.lookup || "none";
    const rgb = state.photoColor || [255, 160, 70];
    $("[data-photo-color]").value =
      "#" +
      rgb.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
    root
      .querySelectorAll("[data-bw]")
      .forEach(
        (e) =>
          (e.value = (state.bwMix || [40, 60, 40, 60, 20, 80])[+e.dataset.bw]),
      );
    toneFields();
    mixerFields();
    selectiveFields();
    levelFields();
    stopsFields();
  }
  function toneFields() {
    root
      .querySelectorAll("[data-balance]")
      .forEach(
        (e) =>
          (e.value = (state.balance?.[$("[data-balance-tone]").value] || [
            0, 0, 0,
          ])[+e.dataset.balance]),
      );
  }
  function mixerFields() {
    root.querySelectorAll("[data-mixer]").forEach(
      (e) =>
        (e.value = (state.mixer || [
          [100, 0, 0, 0],
          [0, 100, 0, 0],
          [0, 0, 100, 0],
        ])[+$("[data-mixer-channel]").value][+e.dataset.mixer]),
    );
  }
  function selectiveFields() {
    root
      .querySelectorAll("[data-selective]")
      .forEach(
        (e) =>
          (e.value = (state.selective?.[$("[data-selective-tone]").value] || [
            0, 0, 0, 0,
          ])[+e.dataset.selective]),
      );
  }
  function stopsFields() {
    const stops = state.gradient || [
        [0, 0, 0, 0],
        [255, 255, 255, 255],
      ],
      host = $("[data-stops]");
    host.replaceChildren();
    stops.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "adjust-tools";
      const pos = document.createElement("input");
      pos.type = "number";
      pos.min = i ? stops[i - 1][0] + 1 : 0;
      pos.max = i < stops.length - 1 ? stops[i + 1][0] - 1 : 255;
      pos.value = s[0];
      pos.disabled = i === 0 || i === stops.length - 1;
      pos.setAttribute("aria-label", `色标 ${i + 1} 位置`);
      const color = document.createElement("input");
      color.type = "color";
      color.value =
        "#" +
        s
          .slice(1)
          .map((v) => Math.round(v).toString(16).padStart(2, "0"))
          .join("");
      color.setAttribute("aria-label", `色标 ${i + 1} 颜色`);
      const remove = document.createElement("button");
      remove.textContent = "删除";
      remove.disabled = pos.disabled;
      const change = () => {
        if (!pos.checkValidity()) return;
        state.gradient = structuredClone(stops);
        state.gradient[i] = [
          +pos.value,
          ...[1, 3, 5].map((n) => parseInt(color.value.slice(n, n + 2), 16)),
        ];
        changed();
      };
      pos.onchange = () => {
        change();
        stopsFields();
      };
      color.oninput = change;
      remove.onclick = () => {
        state.gradient = structuredClone(stops);
        state.gradient.splice(i, 1);
        stopsFields();
        changed();
      };
      row.append(pos, color, remove);
      host.append(row);
    });
  }
  function autoRange(ch) {
    const h = histograms[ch] || [];
    const cut = h.reduce((a, b) => a + b, 0) * 0.0015;
    let lo = 0,
      hi = 255,
      sum = 0;
    while (lo < 254 && sum + h[lo] <= cut) sum += h[lo++];
    sum = 0;
    while (hi > lo + 1 && sum + h[hi] <= cut) sum += h[hi--];
    return [lo, hi];
  }
  function installExtra() {
    if (onPick) {
      const tools = document.createElement("div");
      tools.className = "adjust-tools";
      for (const [mode, label] of [
        ["black", "黑场取样"],
        ["gray", "灰场取样"],
        ["white", "白场取样"],
      ]) {
        const button = document.createElement("button");
        button.textContent = label;
        button.dataset.pick = mode;
        button.onclick = () => {
          status.textContent = "请在页面图片上点击取样";
          onPick(mode, (rgb) => {
            for (let i = 0; i < 3; i++) {
              const k = ["r", "g", "b"][i],
                v = (state.levels[k] ||= [0, 1, 255, 0, 255]),
                n = rgb[i];
              if (mode === "black") {
                v[0] = Math.min(254, n);
                v[2] = Math.max(v[2], v[0] + 1);
              }
              if (mode === "white") {
                v[2] = Math.max(1, n);
                v[0] = Math.min(v[0], v[2] - 1);
              }
              if (mode === "gray")
                v[1] = Math.max(
                  0.1,
                  Math.min(
                    10,
                    Math.log(
                      Math.max(
                        0.001,
                        Math.min(0.999, (n - v[0]) / (v[2] - v[0])),
                      ),
                    ) / Math.log(0.5),
                  ),
                );
            }
            levelFields();
            changed();
          });
        };
        tools.append(button);
      }
      $("#adj-levels").append(tools);
    }

    $("#adj-photo").insertAdjacentHTML(
      "beforeend",
      '<label>滤镜颜色<input data-photo-color type="color" value="#ffa046"></label><label class="check"><input data-flag="photoLuminosity" type="checkbox" checked>保留明度</label>',
    );
    $("#adj-threshold").insertAdjacentHTML(
      "afterbegin",
      '<label class="check"><input data-flag="thresholdEnabled" type="checkbox">启用阈值</label>',
    );
    root.querySelectorAll(".adjust-group").forEach((e) => {
      const option = document.createElement("option");
      option.value = e.id;
      option.textContent = e.querySelector("summary").textContent;
      $("[data-jump]").append(option);
    });
    $("[data-jump]").onchange = (e) => {
      const target = root.querySelector("#" + e.target.value);
      if (target) {
        target.open = true;
        target.scrollIntoView({ block: "start" });
      }
    };
    root.querySelectorAll("[data-slider]").forEach(
      (e) =>
        (e.oninput = () => {
          const n = $(`[data-adjust="${e.dataset.slider}"]`);
          n.value = e.value;
          n.dispatchEvent(new Event("input"));
        }),
    );
    $("[data-channel]").onchange = (e) => {
      channel = e.target.value;
      curveMode = state.curveTables[channel] ? "pencil" : "point";
      selected = 0;
      draw();
    };
    $("[data-interpolation]").onchange = (e) => {
      state.interpolation = e.target.value;
      draw();
      changed();
    };
    $("[data-curve-mode]").onchange = (e) => {
      curveMode = e.target.value;
      if (curveMode === "pencil")
        state.curveTables[channel] ||= curveLUT(
          points(),
          state.interpolation === "smooth",
        ).map(Math.round);
      else if (state.curveTables[channel]) {
        const table = state.curveTables[channel];
        const p = Array.from({ length: 16 }, (_, i) => [i * 17, table[i * 17]]);
        if (channel === "rgb") state.curves = p;
        else state.channelCurves[channel] = p;
        delete state.curveTables[channel];
        selected = 0;
      }
      draw();
      changed();
    };
    $("[data-curve-smooth]").onclick = () => {
      const table = state.curveTables[channel];
      if (table)
        state.curveTables[channel] = table.map((_, i) =>
          Math.round(
            (table[Math.max(0, i - 2)] +
              2 * table[Math.max(0, i - 1)] +
              3 * table[i] +
              2 * table[Math.min(255, i + 1)] +
              table[Math.min(255, i + 2)]) /
              9,
          ),
        );
      else state.interpolation = "smooth";
      $("[data-interpolation]").value = state.interpolation;
      draw();
      changed();
    };
    $("[data-curve-grid]").onclick = (e) => {
      gridDivisions = gridDivisions === 4 ? 10 : 4;
      e.target.textContent = gridDivisions === 4 ? "细网格" : "粗网格";
      draw();
    };
    $("[data-curve-target]").disabled = !onPick;
    $("[data-curve-target]").onclick = () => {
      status.textContent = "在页面图片上点击取样，然后上下拖动调整明暗";
      onPick("curve", (rgb, delta = 0) => {
        const x = Math.round(
          channel === "rgb"
            ? rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
            : rgb[{ r: 0, g: 1, b: 2 }[channel]],
        );
        delete state.curveTables[channel];
        curveMode = "point";
        selected = points().findIndex((p) => Math.abs(p[0] - x) < 2);
        if (selected < 0 && points().length < 16) {
          const y = Math.round(
            curveLUT(points(), state.interpolation === "smooth")[x],
          );
          points().push([x, y]);
          points().sort((a, b) => a[0] - b[0]);
          selected = points().findIndex((p) => p[0] === x);
        }
        if (selected < 0)
          selected = points().reduce(
            (best, p, i) =>
              Math.abs(p[0] - x) < Math.abs(points()[best][0] - x) ? i : best,
            0,
          );
        if (selected >= 0)
          updatePoint(points()[selected][0], points()[selected][1] + delta);
      });
    };
    $("[data-curve-reset]").onclick = () => {
      delete state.curveTables[channel];
      curveMode = "point";
      if (channel === "rgb") state.curves = structuredClone(IDENTITY);
      else state.channelCurves[channel] = structuredClone(IDENTITY);
      selected = 0;
      draw();
      changed();
    };
    $("[data-auto]").onclick = () => {
      delete state.curveTables[channel];
      curveMode = "point";
      const [lo, hi] = autoRange(channel);
      const p = [
        [0, 0],
        ...(lo > 0 ? [[lo, 0]] : []),
        ...(hi < 255 ? [[hi, 255]] : []),
        [255, 255],
      ];
      if (channel === "rgb") state.curves = p;
      else state.channelCurves[channel] = p;
      selected = 0;
      draw();
      changed();
    };
    $("[data-level-channel]").onchange = levelFields;
    $("[data-level-auto]").onclick = () => {
      const ch = $("[data-level-channel]").value,
        [lo, hi] = autoRange(ch);
      if (ch === "rgb") {
        state.black = lo;
        state.white = hi;
        state.gamma = 1;
      } else state.levels[ch] = [lo, 1, hi, 0, 255];
      levelFields();
      changed();
    };
    $("[data-balance-tone]").onchange = toneFields;
    root.querySelectorAll("[data-balance]").forEach(
      (e) =>
        (e.oninput = () => {
          ((state.balance ||= {})[$("[data-balance-tone]").value] ||= [
            0, 0, 0,
          ])[+e.dataset.balance] = +e.value;
          changed();
        }),
    );
    root.querySelectorAll("[data-bw]").forEach(
      (e) =>
        (e.oninput = () => {
          (state.bwMix ||= [40, 60, 40, 60, 20, 80])[+e.dataset.bw] = +e.value;
          changed();
        }),
    );
    $("[data-mixer-channel]").onchange = mixerFields;
    root.querySelectorAll("[data-mixer]").forEach(
      (e) =>
        (e.oninput = () => {
          (state.mixer ||= [
            [100, 0, 0, 0],
            [0, 100, 0, 0],
            [0, 0, 100, 0],
          ])[+$("[data-mixer-channel]").value][+e.dataset.mixer] = +e.value;
          changed();
        }),
    );
    $("[data-selective-tone]").onchange = selectiveFields;
    root.querySelectorAll("[data-selective]").forEach(
      (e) =>
        (e.oninput = () => {
          ((state.selective ||= {})[$("[data-selective-tone]").value] ||= [
            0, 0, 0, 0,
          ])[+e.dataset.selective] = +e.value;
          changed();
        }),
    );
    root.querySelectorAll("[data-flag]").forEach(
      (e) =>
        (e.onchange = () => {
          state[e.dataset.flag] = e.checked;
          changed();
        }),
    );
    $("[data-photo-color]").oninput = (e) => {
      state.photoColor = [1, 3, 5].map((i) =>
        parseInt(e.target.value.slice(i, i + 2), 16),
      );
      changed();
    };
    $("[data-lookup]").onchange = (e) => {
      state.lookup = e.target.value;
      changed();
    };
    $("[data-cube]").onchange = async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) throw Error("LUT 文件限 4 MB");
        state.cube = parseCube(await file.text());
        state.lookup = "cube";
        $("[data-lookup]").value = "cube";
        changed();
      } catch (e) {
        status.textContent = e.message;
      }
    };
    $("[data-add-stop]").onclick = () => {
      const stops = structuredClone(
        state.gradient || [
          [0, 0, 0, 0],
          [255, 255, 255, 255],
        ],
      );
      if (stops.length >= 16) return;
      let i = 0;
      for (let j = 1; j < stops.length - 1; j++)
        if (stops[j + 1][0] - stops[j][0] > stops[i + 1][0] - stops[i][0])
          i = j;
      stops.splice(
        i + 1,
        0,
        stops[i].map((v, k) => Math.round((v + stops[i + 1][k]) / 2)),
      );
      state.gradient = stops;
      stopsFields();
      changed();
    };
    $("[data-save-preset]").onclick = () => {
      const url = URL.createObjectURL(
          new Blob(
            [
              JSON.stringify(
                { format: "Folio-image-v1", adjustments: state },
                null,
                2,
              ),
            ],
            { type: "application/json" },
          ),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = "Folio-image-preset.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    $("[data-load-preset]").onchange = async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) throw Error("预设文件过大");
        const v = JSON.parse(await file.text());
        if (
          v.format !== "Folio-image-v1" ||
          !v.adjustments ||
          typeof v.adjustments !== "object"
        )
          throw Error("预设格式无效");
        await request("image-preview", {
          page,
          index: chosen.index,
          imageData: chosen.imageData || null,
          adjustments: v.adjustments,
        });
        state = { ...structuredClone(defaults), ...v.adjustments };
        channel = "rgb";
        selected = 0;
        $("[data-channel]").value = "rgb";
        fields();
        changed();
      } catch (e) {
        status.textContent = e.message;
      }
    };
  }

  function installCurveEndpoints() {
    const track = document.createElement("div");
    track.className = "levels-track levels-output curve-endpoints";
    canvas.after(track);
    for (const end of [0, 1]) {
      const button = document.createElement("button");
      button.className = "levels-handle " + (end ? "white" : "black");
      button.dataset.curveEndpoint = end;
      button.setAttribute("aria-label", end ? "曲线输入白场" : "曲线输入黑场");
      track.append(button);
      const set = (x) => {
        delete state.curveTables[channel];
        curveMode = "point";
        selected = end ? points().length - 1 : 0;
        updatePoint(x, points()[selected][1]);
      };
      const move = (e) => {
        const r = track.getBoundingClientRect();
        set(((e.clientX - r.left) / r.width) * 255);
      };
      button.onpointerdown = (e) => {
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        move(e);
      };
      button.onpointermove = (e) => {
        if (button.hasPointerCapture(e.pointerId)) move(e);
      };
      button.onpointerup = (e) => {
        if (button.hasPointerCapture(e.pointerId))
          button.releasePointerCapture(e.pointerId);
      };
      button.onkeydown = (e) => {
        if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          set(
            points()[end ? points().length - 1 : 0][0] +
              (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1),
          );
        }
      };
    }
  }
  installCurveEndpoints();
  installExtra();
  levelHandles = installLevelsHandles(
    root,
    () => {
      const ch = $("[data-level-channel]").value;
      return ch === "rgb"
        ? levelKeys.map((k, i) => state[k] ?? [0, 1, 255, 0, 255][i])
        : [...(state.levels[ch] || [0, 1, 255, 0, 255])];
    },
    (values) => {
      const ch = $("[data-level-channel]").value;
      if (ch === "rgb") levelKeys.forEach((k, i) => (state[k] = values[i]));
      else state.levels[ch] = values;
      levelFields();
      changed();
    },
  );
  visualSliders = installVisualSliders(root);
  const observer = new ResizeObserver(() => {
    draw();
    drawHistogram();
  });
  observer.observe(canvas);
  fields();
  preview();
  return {
    dispose() {
      disposed = true;
      observer.disconnect();
      statusObserver.disconnect();
      root.remove();
      revision++;
      clearTimeout(timer);
    },
    refresh: changed,
    getState: () => structuredClone(state),
    async flush() {
      clearTimeout(timer);
      while (running) await new Promise((r) => setTimeout(r, 30));
      if (renderedRevision !== revision) await preview();
      if (renderedRevision !== revision) throw Error(status.textContent);
    },
  };
}

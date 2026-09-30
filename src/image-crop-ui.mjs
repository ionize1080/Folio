// Crop geometry stays in image coordinates; page zoom/rotation only affects display.
export function installCropTools({
  host,
  layer,
  chosen,
  viewport,
  changed,
  onActiveChange = () => {},
  refresh,
  toast,
}) {
  const NS = "http://www.w3.org/2000/svg";
  const controls = document.createElement("div");
  controls.className = "crop-tools";
  controls.innerHTML = `<div class="adjust-tools"><button data-crop-start>在页面裁剪</button><button data-crop-straighten>拉直</button><button data-crop-perspective>透视裁剪</button></div><label>比例<select data-crop-ratio><option value="0">自由比例</option><option value="original">原始比例</option><option value="1">1 : 1</option><option value="1.333333333">4 : 3</option><option value="1.5">3 : 2</option><option value="1.777777778">16 : 9</option><option value="custom">自定义比例</option></select></label><div class="form-grid"><label>宽<input data-crop-width type="number" min="1" max="10000" value="4"></label><label>高<input data-crop-height type="number" min="1" max="10000" value="3"></label></div><div class="adjust-tools"><button data-crop-swap>交换宽高</button><button data-crop-rotate>旋转 90°</button></div><label>辅助线<select data-crop-grid><option value="thirds">三等分</option><option value="grid">网格</option><option value="golden">黄金比例</option><option value="none">无</option></select></label><div class="adjust-tools" data-crop-actions hidden><button data-crop-confirm>确认裁剪 ↵</button><button data-crop-cancel>取消 Esc</button></div><p class="hint">拖动角点或边缘裁剪，框内移动，框外圆点旋转。Enter 确认，Esc 取消。保留源像素，可恢复裁剪；不改变 PDF 页大小。</p>`;
  host.prepend(controls);
  const svg = document.createElementNS(NS, "svg");
  svg.classList.add("image-crop-overlay");
  svg.setAttribute("aria-label", "页面图像裁剪框");
  svg.setAttribute("tabindex", "0");
  layer.append(svg);
  const $ = (s) => controls.querySelector(s);
  let mode = null,
    snapshot = null,
    drag = null,
    points = null,
    straight = null;
  const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));
  function position(u, v) {
    const [a, b, c, d, e, f] = chosen.matrix;
    return viewport().convertToViewportPoint(
      a * u + c * (1 - v) + e,
      b * u + d * (1 - v) + f,
    );
  }
  function local(event) {
    const r = svg.getBoundingClientRect(),
      vp = viewport();
    const [x, y] = vp.convertToPdfPoint(
      event.clientX - r.left,
      event.clientY - r.top,
    );
    const [a, b, c, d, e, f] = chosen.matrix,
      det = a * d - b * c;
    return [
      (d * (x - e) - c * (y - f)) / det,
      1 - (-b * (x - e) + a * (y - f)) / det,
    ];
  }
  function element(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.append(e);
    return e;
  }
  function rect() {
    const [l, t, r, b] = chosen.crop || [0, 0, 0, 0];
    return [l / 100, t / 100, 1 - r / 100, 1 - b / 100];
  }
  function setRect([l, t, r, b]) {
    chosen.crop = [l * 100, t * 100, (1 - r) * 100, (1 - b) * 100].map(
      (v) => Math.round(v * 100) / 100,
    );
    host
      .querySelectorAll("[data-image-crop]")
      .forEach((e, i) => (e.value = chosen.crop[i]));
  }
  function physicalRatio() {
    const select = $("[data-crop-ratio]").value;
    const m = chosen.matrix,
      w = Math.hypot(m[0], m[1]),
      h = Math.hypot(m[2], m[3]);
    const r =
      select === "original"
        ? w / h
        : select === "custom"
          ? +$("[data-crop-width]").value / +$("[data-crop-height]").value
          : +select;
    return r > 0 && Number.isFinite(r) ? (r * h) / w : 0;
  }
  function draw() {
    svg.replaceChildren();
    svg.toggleAttribute("hidden", !mode);
    const vp = viewport();
    if (!mode || !vp) return;
    svg.setAttribute("viewBox", `0 0 ${vp.width} ${vp.height}`);
    svg.style.width = vp.width + "px";
    svg.style.height = vp.height + "px";
    const [l, t, r, b] = rect(),
      corners =
        mode === "perspective"
          ? points
          : [
              [l, t],
              [r, t],
              [r, b],
              [l, b],
            ];
    const coords = corners.map((p) => position(...p));
    const outline = (ps) => "M" + ps.map((p) => p.join(",")).join("L") + "Z";
    element("path", {
      d:
        outline(
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ].map((p) => position(...p)),
        ) + outline(coords),
      "fill-rule": "evenodd",
      fill: "#0009",
      "pointer-events": "none",
    });
    element("polygon", {
      points: coords.map((p) => p.join(",")).join(" "),
      class: "crop-frame",
      "data-crop-handle": "move",
    });
    const guide = $("[data-crop-grid]").value;
    const divisions =
      guide === "thirds"
        ? [1 / 3, 2 / 3]
        : guide === "golden"
          ? [0.382, 0.618]
          : guide === "grid"
            ? [0.2, 0.4, 0.6, 0.8]
            : [];
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    for (const f of divisions) {
      for (const [a, b] of [
        [mix(coords[0], coords[3], f), mix(coords[1], coords[2], f)],
        [mix(coords[0], coords[1], f), mix(coords[3], coords[2], f)],
      ])
        element("line", {
          x1: a[0],
          y1: a[1],
          x2: b[0],
          y2: b[1],
          class: "crop-guide",
        });
    }
    const handle = (point, id) =>
      element("rect", {
        x: point[0] - 5,
        y: point[1] - 5,
        width: 10,
        height: 10,
        class: "crop-handle",
        "data-crop-handle": id,
      });
    coords.forEach((p, i) =>
      handle(p, mode === "perspective" ? "p" + i : ["nw", "ne", "se", "sw"][i]),
    );
    if (mode !== "perspective") {
      [
        [(l + r) / 2, t, "n"],
        [r, (t + b) / 2, "e"],
        [(l + r) / 2, b, "s"],
        [l, (t + b) / 2, "w"],
      ].forEach(([u, v, id]) => handle(position(u, v), id));
      const mid = position((l + r) / 2, t),
        center = position((l + r) / 2, (t + b) / 2),
        length = Math.hypot(mid[0] - center[0], mid[1] - center[1]) || 1;
      const rotate = mid.map((v, i) => v + ((v - center[i]) / length) * 28);
      element("line", {
        x1: mid[0],
        y1: mid[1],
        x2: rotate[0],
        y2: rotate[1],
        class: "crop-guide",
      });
      element("circle", {
        cx: rotate[0],
        cy: rotate[1],
        r: 7,
        class: "crop-rotate",
        "data-crop-handle": "rotate",
      });
    }
    if (straight)
      element("line", {
        x1: straight[0][0],
        y1: straight[0][1],
        x2: straight[1][0],
        y2: straight[1][1],
        class: "crop-straight",
      });
  }
  function start(next = "crop") {
    if (!snapshot)
      snapshot = structuredClone({
        crop: chosen.crop || [0, 0, 0, 0],
        matrix: chosen.matrix,
        perspective: chosen.perspective || null,
      });
    mode = next;
    points = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    onActiveChange();
    $("[data-crop-actions]").hidden = false;
    layer.classList.add("cropping");
    draw();
    if (next === "straighten") toast("沿图片中的水平线拖动，松开后自动拉直");
    if (next === "perspective")
      toast("拖动四个角点包围平面内容，再按 Enter 校正透视");
  }
  function end(save) {
    if (!mode) return;
    if (!save) {
      Object.assign(chosen, snapshot);
      setRect(rect());
    } else if (mode === "perspective") {
      // Reject crossed/concave quadrilaterals before saving an irreversible warp.
      const cross = points.map((a, i) => {
        const b = points[(i + 1) % 4],
          c = points[(i + 2) % 4];
        return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      });
      if (cross.some((x) => x <= 0.0001)) {
        toast("透视裁剪四边形不能交叉或过窄");
        return;
      }
      chosen.perspective = points.map((p) => p.map((v) => +v.toFixed(6)));
      setRect([0, 0, 1, 1]);
    }
    mode = null;
    snapshot = null;
    straight = null;
    drag = null;
    svg.hidden = true;
    layer.classList.remove("cropping");
    $("[data-crop-actions]").hidden = true;
    onActiveChange();
    if (save) {
      changed();
    }
    refresh(save);
    draw();
  }
  function rotate(matrix, angle) {
    const [a, b, c, d, e, f] = matrix,
      co = Math.cos(angle),
      si = Math.sin(angle),
      x = e + (a + c) / 2,
      y = f + (b + d) / 2;
    const A = co * a - si * b,
      B = si * a + co * b,
      C = co * c - si * d,
      D = si * c + co * d;
    chosen.matrix = [A, B, C, D, x - (A + C) / 2, y - (B + D) / 2];
  }
  svg.onpointerdown = (e) => {
    if (!mode) return;
    const id = e.target.dataset.cropHandle;
    if (!id && mode !== "straighten") return;
    e.preventDefault();
    e.stopPropagation();
    svg.focus({ preventScroll: true });
    svg.setPointerCapture(e.pointerId);
    const box = svg.getBoundingClientRect(),
      screen = [e.clientX - box.left, e.clientY - box.top];
    drag = {
      id,
      point: local(e),
      rect: rect(),
      matrix: [...chosen.matrix],
      screen,
    };
    if (mode === "straighten") straight = [screen, screen];
  };
  svg.onpointermove = (e) => {
    if (!drag) return;
    e.preventDefault();
    const box = svg.getBoundingClientRect(),
      screen = [e.clientX - box.left, e.clientY - box.top];
    if (mode === "straighten") {
      straight[1] = screen;
      draw();
      return;
    }
    if (drag.id === "rotate") {
      const vp = viewport(),
        m = drag.matrix,
        center = vp.convertToViewportPoint(
          m[4] + (m[0] + m[2]) / 2,
          m[5] + (m[1] + m[3]) / 2,
        );
      let angle =
        Math.atan2(screen[1] - center[1], screen[0] - center[0]) -
        Math.atan2(drag.screen[1] - center[1], drag.screen[0] - center[0]);
      if (e.shiftKey)
        angle = (Math.round(angle / (Math.PI / 12)) * Math.PI) / 12;
      rotate(drag.matrix, -angle);
      draw();
      return;
    }
    const [u, v] = local(e);
    if (drag.id.startsWith("p")) {
      points[+drag.id.slice(1)] = [clamp(u), clamp(v)];
      draw();
      return;
    }
    let [l, t, r, b] = drag.rect;
    const id = drag.id,
      minimum = 0.015;
    if (id === "move") {
      const dx = clamp(u - drag.point[0], -l, 1 - r),
        dy = clamp(v - drag.point[1], -t, 1 - b);
      l += dx;
      r += dx;
      t += dy;
      b += dy;
    } else {
      if (id.includes("w")) l = clamp(u, 0, r - minimum);
      if (id.includes("e")) r = clamp(u, l + minimum, 1);
      if (id.includes("n")) t = clamp(v, 0, b - minimum);
      if (id.includes("s")) b = clamp(v, t + minimum, 1);
      let ratio = physicalRatio();
      if (e.shiftKey && !ratio)
        ratio = (drag.rect[2] - drag.rect[0]) / (drag.rect[3] - drag.rect[1]);
      if (ratio) {
        if (id === "n" || id === "s") {
          let width = Math.min(1, (b - t) * ratio),
            center = (l + r) / 2;
          l = clamp(center - width / 2, 0, 1 - width);
          r = l + width;
          if (id === "n") t = b - width / ratio;
          else b = t + width / ratio;
        } else {
          let height = (r - l) / ratio;
          const available = id.includes("n") ? b : 1 - t;
          height = Math.min(height, available);
          if (id.includes("w")) l = r - height * ratio;
          else r = l + height * ratio;
          if (id.includes("n")) t = b - height;
          else b = t + height;
        }
      }
    }
    setRect([l, t, r, b]);
    draw();
  };
  svg.onpointerup = (e) => {
    if (!drag) return;
    if (
      mode === "straighten" &&
      Math.hypot(
        straight[1][0] - straight[0][0],
        straight[1][1] - straight[0][1],
      ) > 10
    ) {
      let angle = Math.atan2(
        straight[1][1] - straight[0][1],
        straight[1][0] - straight[0][0],
      );
      while (angle > Math.PI / 2) angle -= Math.PI;
      while (angle < -Math.PI / 2) angle += Math.PI;
      rotate(drag.matrix, angle);
      mode = "crop";
      straight = null;
    }
    drag = null;
    if (svg.hasPointerCapture(e.pointerId))
      svg.releasePointerCapture(e.pointerId);
    draw();
  };
  svg.onpointercancel = () => {
    drag = null;
    straight = null;
    draw();
  };
  $("[data-crop-start]").onclick = () => start();
  $("[data-crop-straighten]").onclick = () => start("straighten");
  $("[data-crop-perspective]").onclick = () => start("perspective");
  $("[data-crop-confirm]").onclick = () => end(true);
  $("[data-crop-cancel]").onclick = () => end(false);
  $("[data-crop-grid]").onchange = draw;
  $("[data-crop-ratio]").onchange = () => {
    if (!mode) start();
    draw();
  };
  $("[data-crop-swap]").onclick = () => {
    const w = $("[data-crop-width]"),
      h = $("[data-crop-height]");
    [w.value, h.value] = [h.value, w.value];
    $("[data-crop-ratio]").value = "custom";
    if (!mode) start();
  };
  $("[data-crop-rotate]").onclick = () => {
    if (!mode) start();
    rotate(chosen.matrix, -Math.PI / 2);
    draw();
  };
  const keyboard = (e) => {
    if (!mode || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      end(e.key === "Enter");
    }
  };
  document.addEventListener("keydown", keyboard, true);
  return {
    draw,
    confirm: () => end(true),
    get active() {
      return !!mode;
    },
    dispose() {
      document.removeEventListener("keydown", keyboard, true);
      svg.remove();
      controls.remove();
    },
  };
}

// Map a point in the rectified unit square back into its source quadrilateral.
export function perspectiveSourcePoint(p, u, v) {
  const dx1 = p[1][0] - p[2][0],
    dx2 = p[3][0] - p[2][0],
    dx3 = p[0][0] - p[1][0] + p[2][0] - p[3][0];
  const dy1 = p[1][1] - p[2][1],
    dy2 = p[3][1] - p[2][1],
    dy3 = p[0][1] - p[1][1] + p[2][1] - p[3][1];
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-10) throw Error("透视裁剪不可逆");
  const g = (dx3 * dy2 - dx2 * dy3) / det,
    h = (dx1 * dy3 - dx3 * dy1) / det;
  return [0, 1].map(
    (i) =>
      ((p[1][i] - p[0][i] + g * p[1][i]) * u +
        (p[3][i] - p[0][i] + h * p[3][i]) * v +
        p[0][i]) /
      (g * u + h * v + 1),
  );
}

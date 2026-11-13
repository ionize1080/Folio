// Folio colour picker.
//
// Every <input type="color"> in the app (present or created later) opens this
// popover instead of the native Windows dialog. The input stays the single
// source of truth: we write `.value` and dispatch the usual `input` / `change`
// events, so no caller needs to change.
//
// The popover has: a saturation/lightness field + hue strip (the "colour
// wheel" you could always click), a hex field, the EyeDropper (screen pick),
// perceptually even presets generated in OKLCH, and recently used colours.

const RECENT_KEY = "folio-recent-colors";
const HEX = /^#[0-9a-f]{6}$/i;

/* ───────────── colour maths ───────────── */
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const toHex = ([r, g, b]) =>
  "#" + [r, g, b].map(v => Math.round(clamp(v) * 255).toString(16).padStart(2, "0")).join("");
const fromHex = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
export function normalizeHex(text) {
  let t = String(text ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(t)) t = [...t].map(c => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(t) ? "#" + t.toLowerCase() : null;
}
export function rgbToHsv([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}
export function hsvToRgb([h, s, v]) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
const lin = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(lin);
}
// Reduce chroma until the colour fits sRGB, so every swatch is the most vivid
// version of its hue at that lightness (no clipped, muddy corners).
export function oklchHex(L, C, h) {
  for (let c = C; c >= 0; c -= 0.004) {
    const rgb = oklchToRgb(L, c, h);
    if (rgb.every(v => v >= -0.0005 && v <= 1.0005)) return toHex(rgb);
  }
  return toHex(oklchToRgb(L, 0, h));
}

const HUES = [27, 52, 82, 125, 158, 195, 240, 268, 305, 352];
const HUE_NAMES = ["红", "橙", "琥珀", "黄绿", "绿", "青", "蓝", "靛", "紫", "粉"];
export const PRESET_ROWS = [
  { id: "vivid", label: "鲜明", colors: HUES.map(h => oklchHex(0.64, 0.19, h)) },
  { id: "deep", label: "深邃", colors: HUES.map(h => oklchHex(0.42, 0.13, h)) },
  { id: "soft", label: "柔和", colors: HUES.map(h => oklchHex(0.84, 0.095, h)) },
  { id: "tint", label: "淡彩", colors: HUES.map(h => oklchHex(0.94, 0.04, h)) },
  // Warm-leaning neutral ramp: pure greys look cold next to paper white.
  { id: "ink", label: "墨与纸", colors: [0.16, 0.28, 0.42, 0.56, 0.68, 0.79, 0.88, 0.94, 0.975, 1].map(L => oklchHex(L, L > 0.98 ? 0 : 0.012, 75)) },
];

/* ───────────── recent colours ───────────── */
function recents() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list.filter(c => HEX.test(c)).slice(0, 10) : [];
  } catch { return []; }
}
function remember(hex) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([hex, ...recents().filter(c => c !== hex)].slice(0, 10)));
  } catch { /* storage full or blocked: recents are optional */ }
}

/* ───────────── popover ───────────── */
let open = null;

function closePicker(commit = true) {
  if (!open) return;
  const { root, input, start, cleanup } = open;
  open = null;
  cleanup();
  root.remove();
  if (commit && input.value !== start) {
    remember(input.value);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  input.setAttribute("aria-expanded", "false");
  input.focus({ preventScroll: true });
}

const swatchButton = (hex, label) =>
  `<button type="button" class="cp-swatch" data-hex="${hex}" style="--c:${hex}" title="${label ? label + " " : ""}${hex}" aria-label="${hex}"></button>`;

function openPicker(input) {
  if (open?.input === input) return closePicker();
  closePicker();
  const start = input.value || "#000000";
  let hsv = rgbToHsv(fromHex(HEX.test(start) ? start : "#000000"));
  const root = document.createElement("div");
  root.className = "cp-pop";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "选择颜色");
  const recent = recents();
  root.innerHTML = `
    <div class="cp-area" tabindex="0" role="slider" aria-label="饱和度与明度"><i class="cp-knob"></i></div>
    <div class="cp-hue" tabindex="0" role="slider" aria-label="色相" aria-valuemin="0" aria-valuemax="360"><i class="cp-knob"></i></div>
    <div class="cp-row">
      <span class="cp-now" aria-hidden="true"></span>
      <input class="cp-hex" spellcheck="false" maxlength="7" aria-label="十六进制颜色" />
      ${"EyeDropper" in window ? `<button type="button" class="cp-eye" title="从屏幕取色" aria-label="从屏幕取色"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5 4 4M4 20l1-4 9.5-9.5a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L9 20l-5 0Z"/><path d="m17 3.5 3.5 3.5"/></svg></button>` : ""}
    </div>
    ${PRESET_ROWS.map(row => `<div class="cp-grid" role="group" aria-label="${row.label}">${row.colors.map((c, i) => swatchButton(c, row.id === "ink" ? "" : HUE_NAMES[i] + " · " + row.label)).join("")}</div>`).join("")}
    ${recent.length ? `<div class="cp-label">最近使用</div><div class="cp-grid cp-recent">${recent.map(c => swatchButton(c, "")).join("")}</div>` : ""}`;
  const host = input.closest("dialog[open]") || document.body;
  host.append(root);

  const area = root.querySelector(".cp-area"), hue = root.querySelector(".cp-hue");
  const hexField = root.querySelector(".cp-hex"), now = root.querySelector(".cp-now");
  const areaKnob = area.firstElementChild, hueKnob = hue.firstElementChild;

  const paint = (fromField = false) => {
    const hex = toHex(hsvToRgb(hsv));
    area.style.setProperty("--hue", `hsl(${hsv[0]} 100% 50%)`);
    areaKnob.style.cssText = `left:${hsv[1] * 100}%;top:${(1 - hsv[2]) * 100}%`;
    hueKnob.style.left = `${(hsv[0] / 360) * 100}%`;
    now.style.background = hex;
    if (!fromField) hexField.value = hex;
    area.setAttribute("aria-valuetext", `${Math.round(hsv[1] * 100)}% / ${Math.round(hsv[2] * 100)}%`);
    hue.setAttribute("aria-valuenow", Math.round(hsv[0]));
    return hex;
  };
  let frame = 0;
  const publish = (hex, fromField = false) => {
    paint(fromField);
    if (input.value !== hex) {
      input.value = hex;
      // One event per animation frame keeps live previews (page colour, text
      // colour) smooth while dragging.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => input.dispatchEvent(new Event("input", { bubbles: true })));
    }
  };
  const setHex = hex => {
    hsv = rgbToHsv(fromHex(hex));
    // Greys have no hue: keep the previous hue so the strip doesn't jump.
    if (!hsv[1]) hsv[0] = rgbToHsv(fromHex(input.value || hex))[0] || hsv[0];
    publish(hex);
  };

  const drag = (el, apply) => {
    el.addEventListener("pointerdown", e => {
      if (e.button) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.focus({ preventScroll: true });
      const move = ev => {
        const r = el.getBoundingClientRect();
        apply(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height));
      };
      move(e);
      el.onpointermove = move;
      el.onpointerup = el.onpointercancel = () => { el.onpointermove = el.onpointerup = el.onpointercancel = null; };
    });
  };
  drag(area, (x, y) => { hsv = [hsv[0], x, 1 - y]; publish(toHex(hsvToRgb(hsv))); });
  drag(hue, x => { hsv = [x * 360, hsv[1] || 0.6, hsv[2] || 0.8]; publish(toHex(hsvToRgb(hsv))); });
  area.addEventListener("keydown", e => {
    const step = e.shiftKey ? 0.1 : 0.02, k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!k) return;
    e.preventDefault();
    hsv = [hsv[0], clamp(hsv[1] + k[0] * step), clamp(hsv[2] + k[1] * step)];
    publish(toHex(hsvToRgb(hsv)));
  });
  hue.addEventListener("keydown", e => {
    const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    hsv = [(hsv[0] + d * (e.shiftKey ? 15 : 3) + 360) % 360, hsv[1] || 0.6, hsv[2] || 0.8];
    publish(toHex(hsvToRgb(hsv)));
  });
  hexField.addEventListener("input", () => {
    const hex = normalizeHex(hexField.value);
    hexField.classList.toggle("bad", !hex && hexField.value.length > 0);
    if (hex) { hsv = rgbToHsv(fromHex(hex)); publish(hex, true); }
  });
  hexField.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); closePicker(); }
  });
  hexField.addEventListener("blur", () => { hexField.value = toHex(hsvToRgb(hsv)); hexField.classList.remove("bad"); });
  root.addEventListener("click", e => {
    const sw = e.target.closest(".cp-swatch");
    if (sw) { setHex(sw.dataset.hex); closePicker(); return; }
    if (e.target.closest(".cp-eye")) {
      new window.EyeDropper().open().then(r => { setHex(normalizeHex(r.sRGBHex) || input.value); }).catch(() => {});
    }
  });

  // Place under the input; flip above and clamp inside the host (dialog or window).
  // The popover's containing block may be offset (dialog transforms), so measure the origin.
  const place = () => {
    root.style.left = "0px"; root.style.top = "0px";
    const origin = root.getBoundingClientRect(), a = input.getBoundingClientRect(), w = root.offsetWidth, h = root.offsetHeight;
    const bounds = host === document.body ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : host.getBoundingClientRect();
    const minX = Math.max(8, bounds.left + 8), maxX = Math.min(innerWidth, bounds.right) - w - 8;
    let x = Math.min(a.left, maxX); x = Math.max(minX, x);
    let y = a.bottom + 6;
    if (y + h > Math.min(innerHeight, bounds.bottom) - 8) y = Math.max(8, a.top - h - 6);
    root.style.left = x - origin.left + "px";
    root.style.top = y - origin.top + "px";
  };
  paint();
  place();
  input.setAttribute("aria-expanded", "true");
  area.focus({ preventScroll: true });

  const onDown = e => { if (!root.contains(e.target) && e.target !== input) closePicker(); };
  const onKey = e => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); input.value = start; input.dispatchEvent(new Event("input", { bubbles: true })); closePicker(false); }
  };
  const onMove = () => place();
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  addEventListener("resize", onMove);
  open = { root, input, start, cleanup: () => {
    cancelAnimationFrame(frame);
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    removeEventListener("resize", onMove);
  } };
}

/* ───────────── wiring ───────────── */
export function installColorPicker(doc = document) {
  if (doc.__folioColorPicker) return;
  doc.__folioColorPicker = true;
  const isColor = el => el instanceof HTMLInputElement && el.type === "color" && !el.disabled && !el.readOnly && !el.dataset.nativeColor;
  // Capture phase + preventDefault stops Chromium's native colour dialog.
  doc.addEventListener("click", e => {
    const el = e.target.closest?.("input[type=color]");
    if (!isColor(el)) return;
    e.preventDefault();
    openPicker(el);
  }, true);
  doc.addEventListener("keydown", e => {
    const el = e.target;
    if (isColor(el) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openPicker(el); }
  }, true);
  doc.addEventListener("input", e => {
    // Programmatic or fallback native changes still update the label colour.
    if (isColor(e.target)) e.target.style.setProperty("--c", e.target.value);
  });
  new MutationObserver(records => {
    for (const r of records) for (const n of r.removedNodes) if (open && n.contains?.(open.input)) closePicker(false);
  }).observe(doc.body, { childList: true, subtree: true });
}

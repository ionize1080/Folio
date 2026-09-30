// Shared visual tracks for numeric controls: native range keyboard/accessibility retained.
const ramp = (...colors) => `linear-gradient(90deg, ${colors.join(", ")})`;
const spectrum = ramp(
  "#f34b53",
  "#edd23b",
  "#4bc766",
  "#3bd2d4",
  "#4771ef",
  "#c554e7",
  "#f34b53",
);
export function installVisualSliders(root) {
  const colors = [
    "#e65454",
    "#e1c83e",
    "#58b76a",
    "#44bfc8",
    "#547be0",
    "#c862cc",
  ];
  const gradients = {
    hue: spectrum,
    saturation: ramp("#888", "#df5b56"),
    lightness: ramp("#000", "#888", "#fff"),
    temperature: ramp("#428af0", "#aaa", "#ffc45f"),
    tint: ramp("#64ce83", "#aaa", "#d874d7"),
    vibrance: ramp("#8b9991", "#88c079", "#ec713f"),
    brightness: ramp("#111", "#999", "#fff"),
    contrast: ramp("#929292", "#fff", "#111"),
    exposure: ramp("#111", "#888", "#fff"),
    offset: ramp("#111", "#777", "#fff"),
    photoDensity: ramp("#b6b6b6", "#ffa046"),
  };
  const extras = [];
  for (const kind of ["balance", "bw", "mixer", "selective"]) {
    root.querySelectorAll(`[data-${kind}]`).forEach((number) => {
      const row = number.closest("label"),
        name = row.childNodes[0].textContent.trim(),
        i = +number.dataset[kind];
      row.className = "adjust-row";
      row.childNodes[0].remove();
      const label = document.createElement("span");
      label.textContent = name;
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = number.min;
      slider.max = number.max;
      slider.step = number.step || "1";
      slider.value = number.value;
      slider.dataset.visualSlider = `${kind}-${i}`;
      slider.setAttribute("aria-label", name + "滑块");
      const gradient =
        kind === "balance"
          ? [
              ramp("#35c5d5", "#999", "#e95b50"),
              ramp("#d967d3", "#999", "#61c974"),
              ramp("#edcd53", "#999", "#5687e7"),
            ][i]
          : kind === "bw"
            ? ramp("#191919", colors[i], "#fff")
            : kind === "mixer"
              ? ramp("#222", colors[[0, 2, 4, 0][i]], "#fff")
              : [
                  ramp("#ff9999", "#22c5d8"),
                  ramp("#7aca84", "#d86bcf"),
                  ramp("#8396ef", "#ead556"),
                  ramp("#fff", "#000"),
                ][i];
      slider.style.setProperty("--track", gradient);
      row.prepend(label, slider);
      extras.push([number, slider]);
      slider.oninput = () => {
        number.value = slider.value;
        number.dispatchEvent(new Event("input", { bubbles: true }));
      };
      number.addEventListener("input", () => (slider.value = number.value));
    });
  }
  for (const slider of root.querySelectorAll("[data-slider]"))
    slider.style.setProperty(
      "--track",
      gradients[slider.dataset.slider] || ramp("#202630", "#7e8996", "#f2f4f8"),
    );
  const gradient = root.querySelector("#adj-gradient");
  const strip = document.createElement("div");
  strip.className = "gradient-ramp";
  strip.setAttribute("aria-label", "渐变映射颜色预览");
  gradient.insertBefore(strip, gradient.querySelector("[data-stops]"));
  function sync() {
    extras.forEach(([n, s]) => (s.value = n.value));
    const photo = root.querySelector("[data-photo-color]");
    if (photo)
      root
        .querySelector('[data-slider="photoDensity"]')
        .style.setProperty("--track", ramp("#b6b6b6", photo.value));
    const stops = [...root.querySelectorAll("[data-stops] .adjust-tools")].map(
      (row) =>
        `${row.querySelector("[type=color]").value} ${(+row.querySelector("[type=number]").value / 255) * 100}%`,
    );
    if (stops.length)
      strip.style.background = `linear-gradient(90deg,${stops.join(",")})`;
  }
  root.addEventListener("input", sync);
  root.addEventListener("change", sync);
  root.addEventListener("click", sync);
  sync();
  return { sync };
}

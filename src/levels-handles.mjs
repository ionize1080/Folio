// Histogram input endpoints / gamma and output endpoints share the numeric model.
export function installLevelsHandles(root, read, write, clipping = () => {}) {
  const input = document.createElement("div"),
    output = document.createElement("div");
  input.className = "levels-track levels-input";
  output.className = "levels-track levels-output";
  input.setAttribute("aria-label", "输入色阶");
  output.setAttribute("aria-label", "输出色阶");
  root.querySelector("[data-histogram]").after(input);
  root
    .querySelector('[data-adjust="outputBlack"]')
    .closest("label")
    .before(output);
  const names = ["输入黑场", "输入中间调", "输入白场", "输出黑场", "输出白场"];
  const buttons = names.map((name, i) => {
    const b = document.createElement("button");
    b.className =
      "levels-handle " +
      ([0, 3].includes(i) ? "black" : i === 1 ? "gray" : "white");
    b.dataset.levelHandle = i;
    b.type = "button";
    b.setAttribute("role", "slider");
    b.setAttribute("aria-label", name);
    (i < 3 ? input : output).append(b);
    let original = null,
      pointer = null;
    function set(value) {
      const v = read();
      v[i] =
        i === 0
          ? Math.max(0, Math.min(v[2] - 1, value))
          : i === 2
            ? Math.max(v[0] + 1, Math.min(255, value))
            : i === 1
              ? Math.max(0.1, Math.min(10, value))
              : Math.max(0, Math.min(255, value));
      v[i] = i === 1 ? Math.round(v[i] * 100) / 100 : Math.round(v[i]);
      write(v);
      sync();
    }
    function move(e) {
      clipping(
        e.altKey && [0, 2].includes(i) ? (i === 0 ? "black" : "white") : null,
      );
      const box = b.parentElement.getBoundingClientRect(),
        v = read();
      const x = Math.max(
        0,
        Math.min(255, ((e.clientX - box.left) / box.width) * 255),
      );
      set(
        i === 1
          ? Math.log(
              Math.max(0.001, Math.min(0.999, (x - v[0]) / (v[2] - v[0]))),
            ) / Math.log(0.5)
          : x,
      );
    }
    b.onpointerdown = (e) => {
      e.preventDefault();
      original = [...read()];
      pointer = e.pointerId;
      b.focus();
      b.setPointerCapture(e.pointerId);
      move(e);
    };
    b.onpointermove = (e) => {
      if (b.hasPointerCapture(e.pointerId)) move(e);
    };
    b.onpointerup = b.onpointercancel = (e) => {
      original = null;
      pointer = null;
      clipping(null);
      if (b.hasPointerCapture(e.pointerId))
        b.releasePointerCapture(e.pointerId);
    };
    b.onkeydown = (e) => {
      if (e.key === "Escape" && original) {
        e.preventDefault();
        e.stopPropagation();
        write(original);
        original = null;
        if (pointer !== null && b.hasPointerCapture(pointer))
          b.releasePointerCapture(pointer);
        pointer = null;
        clipping(null);
        sync();
        return;
      }
      const direction = ["ArrowLeft", "ArrowDown"].includes(e.key)
        ? -1
        : ["ArrowRight", "ArrowUp"].includes(e.key)
          ? 1
          : 0;
      if (direction) {
        e.preventDefault();
        set(
          read()[i] + direction * (i === 1 ? 0.01 : 1) * (e.shiftKey ? 10 : 1),
        );
      }
    };
    return b;
  });
  function sync() {
    const v = read(),
      mid = v[0] + (v[2] - v[0]) * Math.pow(0.5, v[1]);
    buttons.forEach((b, i) => {
      b.style.left = ((i === 1 ? mid : v[i]) / 255) * 100 + "%";
      b.setAttribute("aria-valuemin", i === 1 ? ".1" : "0");
      b.setAttribute("aria-valuemax", i === 1 ? "10" : "255");
      b.setAttribute("aria-valuenow", v[i]);
      b.title = names[i] + "：" + v[i];
    });
  }
  return { sync };
}

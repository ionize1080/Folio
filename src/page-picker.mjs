import { pageRange } from "./generation.mjs";
export function compactPages(pages) {
  const a = [...new Set(pages)].sort((a, b) => a - b),
    s = [];
  for (let i = 0; i < a.length; i++) {
    const start = a[i];
    while (i + 1 < a.length && a[i + 1] === a[i] + 1) i++;
    s.push(start === a[i] ? String(start) : `${start}-${a[i]}`);
  }
  return s.join(",");
}
export function installPagePicker(input, { S, surface, onChange = () => {} }) {
  const count = S.info.pageCount,
    box = document.createElement("div");
  box.className = "page-picker";
  // Keep advanced syntax available; do not silently reset a caller's existing scope.
  input.closest("label")?.classList.add("page-range-label");
  input.before(box);
  box.append(input);
  input.classList.add("page-range-advanced");
  input.setAttribute("aria-label", "自定义 PDF 页码范围");
  box.insertAdjacentHTML(
    "afterbegin",
    `<div class="page-presets"><button type="button" data-mode="all">全部</button><button type="button" data-mode="current">当前页</button><button type="button" data-mode="selected">所选页</button><button type="button" data-mode="tail">当前页至末尾</button><button type="button" data-mode="marks">已标记范围</button></div><div class="page-ends"><input type="number" class="range-start" min="1" max="${count}" aria-label="起始 PDF 页"><span>至</span><input type="number" class="range-end" min="1" max="${count}" aria-label="结束 PDF 页"><button type="button" data-mode="range">使用范围</button><select class="range-parity" aria-label="页码子集"><option value="all">全部页</option><option value="odd">奇数页</option><option value="even">偶数页</option></select></div><p class="range-summary" role="status"></p><details class="range-visual"><summary>从缩略图选择页面</summary><div class="page-presets"><button type="button" data-grid="prev">上一组</button><button type="button" data-grid="next">下一组</button><button type="button" data-grid="all">全选</button><button type="button" data-grid="clear">清空</button><button type="button" data-grid="invert">反选</button></div><p>Shift 连选 · Ctrl 加选 · 再次点击取消；PDF 页序 / 页面标签</p><div class="page-grid"></div></details>`,
  );
  const $ = (q) => box.querySelector(q);
  let chosen = new Set(),
    anchor = S.page,
    start = Math.floor((S.page - 1) / 24) * 24,
    epoch = 0,
    tasks = new Set();
  $(".range-start").value = S.page;
  $(".range-end").value = S.page;
  const notify = () => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    onChange();
  };
  function parse() {
    try {
      chosen = new Set(pageRange(input.value, count));
      $(".range-summary").textContent =
        `已选 ${chosen.size} / ${count} 页 · PDF 页序 ${input.value}`;
      input.setCustomValidity("");
    } catch (e) {
      chosen.clear();
      $(".range-summary").textContent = e.message;
      input.setCustomValidity(e.message);
    }
    for (const b of box.querySelectorAll("[data-p]"))
      b.classList.toggle("selected", chosen.has(+b.dataset.p));
  }
  function set(pages) {
    input.value = compactPages(pages);
    S.selectedPages = new Set(pages);
    parse();
    notify();
  }
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    e.preventDefault();
    const mode = b.dataset.mode;
    if (mode) {
      let p;
      if (mode === "all") p = Array.from({ length: count }, (_, i) => i + 1);
      if (mode === "current") p = [S.page];
      if (mode === "selected") p = [...(S.selectedPages || [])];
      if (mode === "tail")
        p = Array.from({ length: count - S.page + 1 }, (_, i) => S.page + i);
      if (mode === "marks")
        p = Array.from(
          {
            length:
              Math.abs((S.rangeEnd || S.page) - (S.rangeStart || S.page)) + 1,
          },
          (_, i) => Math.min(S.rangeStart || S.page, S.rangeEnd || S.page) + i,
        );
      if (mode === "range") {
        try {
          p = pageRange(
            `${$(".range-start").value}-${$(".range-end").value}`,
            count,
          );
        } catch (err) {
          $(".range-summary").textContent = err.message;
          return;
        }
      }
      if (p) {
        const parity = $(".range-parity").value;
        set(
          p.filter(
            (p) => parity === "all" || p % 2 === (parity === "odd" ? 1 : 0),
          ),
        );
      }
    }
    if (b.dataset.grid) {
      const op = b.dataset.grid;
      if (op === "prev" || op === "next") {
        start = Math.max(
          0,
          Math.min(
            Math.floor((count - 1) / 24) * 24,
            start + (op === "prev" ? -24 : 24),
          ),
        );
        draw();
      } else
        set(
          op === "clear"
            ? []
            : Array.from({ length: count }, (_, i) => i + 1).filter(
                (p) => op === "all" || !chosen.has(p),
              ),
        );
    }
    if (b.dataset.p) {
      const p = +b.dataset.p;
      if (e.shiftKey) {
        for (let n = Math.min(anchor, p); n <= Math.max(anchor, p); n++)
          chosen.add(n);
      } else {
        chosen.has(p) ? chosen.delete(p) : chosen.add(p);
        anchor = p;
      }
      set([...chosen]);
    }
  });
  $(".range-parity").onchange = () => {
    const parity = $(".range-parity").value;
    set(
      [...chosen].filter(
        (p) => parity === "all" || p % 2 === (parity === "odd" ? 1 : 0),
      ),
    );
  };
  input.addEventListener("input", parse);
  async function draw() {
    const rev = ++epoch;
    for (const t of tasks) t.cancel();
    tasks.clear();
    const grid = $(".page-grid");
    grid.replaceChildren();
    for (let n = start + 1; n <= Math.min(count, start + 24); n++) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.p = n;
      b.className = "page-tile" + (chosen.has(n) ? " selected" : "");
      const c = document.createElement("canvas"),
        s = document.createElement("span");
      s.textContent = `${n}${S.labels?.[n - 1] ? " · " + S.labels[n - 1] : ""}`;
      b.append(c, s);
      grid.append(b);
    }
    for (const b of grid.children) {
      if (rev !== epoch || !box.isConnected) return;
      try {
        const p = await S.pdf.getPage(+b.dataset.p);
        if (rev !== epoch) return;
        const v = p.getViewport({
            scale:
              100 /
              p.getViewport({
                scale: 1,
                rotation: surface.rotation(+b.dataset.p),
              }).width,
            rotation: surface.rotation(+b.dataset.p),
          }),
          c = b.querySelector("canvas");
        c.width = v.width;
        c.height = v.height;
        const t = p.render({ canvasContext: c.getContext("2d"), viewport: v });
        tasks.add(t);
        await t.promise;
        tasks.delete(t);
      } catch (e) {
        if (e.name !== "RenderingCancelledException")
          $(".range-summary").textContent =
            "部分缩略图无法加载，仍可按页码选择";
      }
    }
  }
  $(".range-visual").ontoggle = () => {
    if ($(".range-visual").open) draw();
    else {
      epoch++;
      for (const t of tasks) t.cancel();
      tasks.clear();
      $(".page-grid").replaceChildren();
    }
  };
  parse();
  return () => {
    epoch++;
    for (const t of tasks) t.cancel();
    tasks.clear();
  };
}
